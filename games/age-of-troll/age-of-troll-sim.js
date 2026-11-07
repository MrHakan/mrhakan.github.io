// ===================================================================
// age of troll — the rules and the bot
//
// No canvas, no dom, no clock. A game is one plain object that step() moves
// on by a twentieth of a second and that survives JSON, which is what makes
// the rest of it easy:
//
//   a bot      is a function that issues the same commands a person does
//   online     the host steps the game and sends it across. a guest applies
//              that and keeps stepping the same rules until the next one, so
//              three snapshots a second over the relays still walks smoothly
//   a save     is JSON.stringify
//   a balance  test is a few hundred games in a for loop
//
// Sides are 0 (left wall) and 1 (right wall). Each side's units are kept front
// first, and nobody walks through anybody, so "who is in front" is always [0].
// ===================================================================
(function (root) {
    'use strict';

    const A = root.AOT;
    const HZ = A.HZ, DT = 1 / HZ;
    const FRONT = A.BASE_FRONT;

    // a small seeded generator that lives inside the state, so two machines
    // holding the same state roll the same numbers
    function rand(s) {
        let x = s.rng | 0;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        s.rng = x | 0;
        return (x >>> 0) / 4294967296;
    }

    function newPlayer() {
        return {
            gold: 130, xp: 0, age: 0, hp: A.AGES[0].hp,
            modem: 0, q: [], trainT: 0,
            tur: [],            // [{k: kind, a: the age it was built in, cd}]
            spCd: 25,           // nobody opens with a special
            buffT: 0,
            oc: 0,              // overclocks bought, once there are no more ages to buy
            hold: 0,            // 1: the army stops at the rally line instead of marching
            baseCd: 0,
            handicap: 1,
            kills: 0, lost: 0, baseDmg: 0, earned: 0, spent: 0
        };
    }

    function newGame(seed) {
        return {
            v: 1, tick: 0, match: 0,
            rng: ((seed | 0) * 2654435761 | 0) || 88172645,
            nextId: 1,
            over: false, winner: null,
            srv: 0,             // -1 is the right side's, 1 is the left side's
            p: [newPlayer(), newPlayer()],
            u: [[], []],
            fire: [],           // burning stretches of lane: [{s, x, w, dps, t}]
            ev: null            // an array when somebody is watching, for the sparks
        };
    }

    const say = (s, e) => { if (s.ev) s.ev.push(e); };
    const seconds = s => s.tick / HZ;

    // -----------------------------------------------------------------
    // what a side earns, per second
    // -----------------------------------------------------------------
    function serverOwner(s) {
        return s.srv >= 1 ? 0 : s.srv <= -1 ? 1 : -1;
    }
    function incomeOf(s, side) {
        const p = s.p[side], age = A.AGES[p.age];
        let mult = 1 + p.modem * A.MODEM_STEP;
        if (serverOwner(s) === side) mult += A.SERVER.income;
        // a wall in trouble pays overtime, so losing is not also going broke
        if (p.hp / age.hp < A.OVERTIME_BELOW) mult += A.OVERTIME;
        return age.income * mult * p.handicap;
    }
    function xpRateOf(s, side) {
        const p = s.p[side], age = A.AGES[p.age];
        const behind = Math.max(0, s.p[1 - side].age - p.age);
        return age.trickle * (1 + behind * A.CATCH_UP_XP) * (serverOwner(s) === side ? 1 + A.SERVER.xp : 1);
    }
    const slotsOf = p => A.AGES[p.age].slots;

    // -----------------------------------------------------------------
    // commands: the only way anything changes, for a person, a bot or a guest
    // on the other end of a wire. Returns why not, or null.
    // -----------------------------------------------------------------
    function canCommand(s, side, c) {
        const p = s.p[side];
        if (s.over) return 'over';
        switch (c && c.c) {
            case 'train': {
                const r = c.r;
                if (r !== 0 && r !== 1 && r !== 2 && r !== 3) return 'bad';
                if (r === 3 && p.age < 4) return 'age';
                if (p.q.length >= A.QUEUE_MAX) return 'queue';
                if (p.gold < A.unitFor(p.age, r).cost) return 'gold';
                return null;
            }
            case 'turret': {
                if (c.k !== 0 && c.k !== 1) return 'bad';
                const cost = A.turretCost(c.k, p.age);
                const refund = turretRefund(p, slotsOf(p));
                if (p.tur.length >= slotsOf(p) && !p.tur.some(t => t.a < p.age || t.k !== c.k)) return 'slots';
                if (p.gold + refund < cost) return 'gold';
                return null;
            }
            case 'sell':
                if (!p.tur.length) return 'none';
                return null;
            case 'modem':
                if (p.modem >= A.MODEM_COST.length) return 'max';
                if (p.gold < A.MODEM_COST[p.modem]) return 'gold';
                return null;
            case 'age': {
                const next = A.AGES[p.age + 1];
                if (!next) return 'max';
                if (p.xp < next.xp) return 'xp';
                if (p.gold < next.gold) return 'gold';
                return null;
            }
            case 'special':
                if (p.spCd > 0) return 'cooling';
                return null;
            case 'stance':
                return c.h === 0 || c.h === 1 ? null : 'bad';
            case 'overclock': {
                if (p.age < A.AGES.length - 1) return 'age';
                if (p.oc >= A.OVERCLOCK.max) return 'max';
                if (p.xp < A.overclockXp(p.oc)) return 'xp';
                if (p.gold < A.overclockGold(p.oc)) return 'gold';
                return null;
            }
            case 'resign':
                return null;
            default:
                return 'bad';
        }
    }
    // a full wall swaps its oldest turret for the new one, and pays back part of it
    function turretRefund(p, slots) {
        if (p.tur.length < slots) return 0;
        const worst = p.tur.reduce((a, b) => (b.a < a.a ? b : a));
        return Math.round(A.turretCost(worst.k, worst.a) * A.TURRET_SELL);
    }

    function command(s, side, c) {
        const why = canCommand(s, side, c);
        if (why) return why;
        const p = s.p[side];
        switch (c.c) {
            case 'train': {
                const u = A.unitFor(p.age, c.r);
                p.gold -= u.cost; p.spent += u.cost;
                if (!p.q.length) p.trainT = u.train;
                p.q.push(u.id);
                break;
            }
            case 'turret': {
                const cost = A.turretCost(c.k, p.age);
                if (p.tur.length >= slotsOf(p)) {
                    const worst = p.tur.reduce((a, b) => (b.a < a.a ? b : a));
                    p.gold += turretRefund(p, slotsOf(p));
                    p.tur.splice(p.tur.indexOf(worst), 1);
                }
                p.gold -= cost; p.spent += cost;
                p.tur.push({ k: c.k, a: p.age, cd: 0 });
                say(s, { e: 'build', s: side });
                break;
            }
            case 'sell': {
                const t = p.tur.pop();
                p.gold += Math.round(A.turretCost(t.k, t.a) * A.TURRET_SELL);
                say(s, { e: 'build', s: side });
                break;
            }
            case 'modem':
                p.gold -= A.MODEM_COST[p.modem];
                p.spent += A.MODEM_COST[p.modem];
                p.modem++;
                say(s, { e: 'modem', s: side });
                break;
            case 'age': {
                const next = A.AGES[p.age + 1];
                p.gold -= next.gold; p.spent += next.gold;
                // the wall grows with the age and keeps the same share of its health
                const share = p.hp / A.AGES[p.age].hp;
                p.age++;
                p.hp = Math.min(A.AGES[p.age].hp, Math.round(A.AGES[p.age].hp * Math.min(1, share + 0.2)));
                say(s, { e: 'age', s: side, a: p.age });
                break;
            }
            case 'special':
                castSpecial(s, side);
                break;
            case 'stance':
                p.hold = c.h;
                break;
            case 'overclock': {
                const cost = A.overclockGold(p.oc);
                p.gold -= cost; p.spent += cost;
                p.oc++;
                say(s, { e: 'overclock', s: side, a: p.oc });
                break;
            }
            case 'resign':
                finish(s, 1 - side, 'resign');
                break;
        }
        // a recorded game writes down what happened and when, which is all a
        // replay needs: the rules do the rest again from the same seed
        if (s.log) s.log.c.push(s.tick, cmdCode(c) * 2 + side);
        return null;
    }

    // -----------------------------------------------------------------
    // specials
    // -----------------------------------------------------------------
    function castSpecial(s, side) {
        const p = s.p[side], sp = A.SPECIALS[p.age], foe = 1 - side;
        const power = A.AGES[p.age].power;
        const enemies = s.u[foe];
        p.spCd = sp.cd;
        // aimed at their front, or at the middle of the lane when they have no one out
        const at = enemies.length ? enemies[0].x : A.MID;
        say(s, { e: 'special', s: side, k: sp.key, x: at });
        if (sp.key === 'popups') {
            for (let i = 0; i < sp.hits; i++) {
                const x = at + (rand(s) - 0.5) * 2 * sp.radius;
                enemies.forEach(u => { if (Math.abs(u.x - x) <= 50) u.pend = (u.pend || 0) + sp.dmg * power; });
            }
        } else if (sp.key === 'ban') {
            if (enemies.length) enemies[0].pend = (enemies[0].pend || 0) + sp.dmg * power;
            enemies.forEach(u => { if (Math.abs(u.x - at) <= sp.radius) u.stun = Math.round(sp.stun * HZ); });
        } else if (sp.key === 'caps') {
            p.buffT = sp.dur;
        } else if (sp.key === 'flame') {
            s.fire.push({ s: side, x: at, w: sp.width, dps: sp.dps * power / 8.8, t: sp.dur });
        } else if (sp.key === 'bsod') {
            enemies.forEach(u => {
                u.pend = (u.pend || 0) + A.UNITS[u.t].hp * sp.frac;
                u.stun = Math.round(sp.stun * HZ);
            });
        }
        pay(s);
    }

    // -----------------------------------------------------------------
    // the tick
    // -----------------------------------------------------------------
    function finish(s, winner, why) {
        if (s.over) return;
        s.over = true;
        s.winner = winner;
        s.endWhy = why || 'base';
        say(s, { e: 'over', w: winner });
    }

    function economy(s, side) {
        const p = s.p[side];
        const inc = incomeOf(s, side) * DT;
        p.gold += inc; p.earned += inc;
        p.xp += xpRateOf(s, side) * DT;
        if (p.spCd > 0) p.spCd = Math.max(0, p.spCd - DT);
        if (p.buffT > 0) p.buffT = Math.max(0, p.buffT - DT);

        // the factory: one unit at a time, and it waits for room at the door
        if (p.q.length) {
            p.trainT -= DT;
            if (p.trainT <= 0) {
                const list = s.u[side];
                const last = list[list.length - 1];
                const dir = side === 0 ? 1 : -1;
                const type = A.UNITS[p.q[0]];
                const door = FRONT[side] + dir * type.r;
                const free = !last || (last.x - door) * dir >= (A.UNITS[last.t].r + type.r) * (p.hold ? A.HOLD_GAP : A.MARCH_GAP);
                if (list.length < A.POP_CAP && free) {
                    list.push({ id: s.nextId++, t: type.id, x: door, hp: type.hp, cd: 0 });
                    p.q.shift();
                    p.trainT = p.q.length ? A.UNITS[p.q[0]].train : 0;
                    say(s, { e: 'spawn', s: side, t: type.id });
                } else {
                    p.trainT = 0;
                }
            }
        }
    }

    function hurtBase(s, side, amount, fromSide) {
        const p = s.p[side];
        p.pendBase = (p.pendBase || 0) + amount;
        if (fromSide !== undefined) {
            const q = s.p[fromSide];
            q.baseDmg += amount;
            q.xp += amount * A.BASE_HIT_XP;
            const g = amount * A.BASE_HIT_GOLD;
            q.gold += g; q.earned += g;
        }
    }

    function turrets(s, side) {
        const p = s.p[side], foe = s.u[1 - side];
        if (p.baseCd > 0) p.baseCd -= DT;
        if (!foe.length) { p.tur.forEach(t => { if (t.cd > 0) t.cd -= DT; }); return; }
        const front = foe[0];
        const dist = Math.abs(front.x - FRONT[side]);
        // every wall has a firewall: free, weak, and it never needs a slot
        if (dist <= A.FIREWALL.range && p.baseCd <= 0) {
            p.baseCd = A.FIREWALL.cd;
            front.pend = (front.pend || 0) + A.FIREWALL.dmg * A.AGES[p.age].power;
            say(s, { e: 'tshot', s: side, i: -1, k: 0, x: front.x });
        }
        for (let i = 0; i < p.tur.length; i++) {
            const t = p.tur[i], kind = A.TURRETS[t.k];
            if (t.cd > 0) { t.cd -= DT; continue; }
            if (dist > kind.range) continue;
            t.cd = kind.cd;
            const dmg = A.turretDmg(t.k, t.a) * (p.buffT > 0 ? A.SPECIALS[2].dmgMul : 1);
            if (kind.radius) {
                for (let j = 0; j < foe.length; j++) {
                    if (Math.abs(foe[j].x - front.x) <= kind.radius) foe[j].pend = (foe[j].pend || 0) + dmg;
                    else break;
                }
            } else {
                front.pend = (front.pend || 0) + dmg;
            }
            say(s, { e: 'tshot', s: side, i, k: t.k, x: front.x });
        }
    }

    function act(s, side) {
        const list = s.u[side], foe = s.u[1 - side], other = 1 - side;
        const dir = side === 0 ? 1 : -1;
        const p = s.p[side];
        const buff = p.buffT > 0;
        const dmgMul = (buff ? A.SPECIALS[2].dmgMul : 1) * (1 + p.oc * A.OVERCLOCK.dmg);
        const speedMul = buff ? A.SPECIALS[2].speedMul : 1;
        const near = foe[0] || null;
        const wall = FRONT[other];
        // where the army stops when told to hold
        const rally = p.hold ? FRONT[side] + dir * A.RALLY : null;
        // waiting in a crowd takes less room than marching in a line, or a held
        // army would back up into the door and the factory would stop
        const spacing = p.hold ? A.HOLD_GAP : A.MARCH_GAP;
        for (let i = 0; i < list.length; i++) {
            const u = list[i], type = A.UNITS[u.t];
            if (u.cd > 0) u.cd--;
            if (u.stun > 0) { u.stun--; continue; }
            const toUnit = near ? Math.abs(near.x - u.x) - A.UNITS[near.t].r : Infinity;
            const toWall = Math.abs(wall - u.x);
            let walk = false;
            if (toUnit <= type.range) {
                if (u.cd <= 0) swing(s, side, u, type, near, foe, dmgMul);
                // melee keeps closing until it touches, so the second rank gets
                // a swing too. a shooter stands where it is
                walk = type.role !== 1 && toUnit > type.r * 0.9;
            } else if (toWall <= type.range) {
                if (u.cd <= 0) {
                    u.cd = Math.round(type.cd * HZ);
                    const amount = type.dmg * dmgMul * A.ROLE_SIEGE[type.role] * (0.9 + rand(s) * 0.2);
                    hurtBase(s, other, amount, side);
                    say(s, { e: 'hit', s: side, x: u.x, role: type.role, id: u.id, base: other });
                }
            } else {
                walk = true;
                if (rally !== null && (u.x - rally) * dir >= 0) walk = false;
            }
            if (walk) {
                let nx = u.x + dir * type.speed * speedMul * DT;
                // nobody walks past the rally line on their way to it
                if (rally !== null && toUnit > type.range && (nx - rally) * dir > 0) nx = rally;
                if (i > 0) {
                    const ahead = list[i - 1];
                    const gap = (A.UNITS[ahead.t].r + type.r) * spacing;
                    if ((ahead.x - nx) * dir < gap) nx = ahead.x - dir * gap;
                }
                // walking only ever goes forward: a unit does not get pushed
                // back because the one ahead of it stopped short
                if ((nx - u.x) * dir > 0) u.x = nx;
            }
        }
    }

    function swing(s, side, u, type, target, foe, dmgMul) {
        u.cd = Math.round(type.cd * HZ);
        const tr = A.UNITS[target.t];
        const roll = 0.9 + rand(s) * 0.2;
        const dmg = type.dmg * dmgMul * roll;
        target.pend = (target.pend || 0) + dmg * A.ROLE_VS[type.role][tr.role];
        // a big swing goes through whoever is standing behind the first one
        for (let c = 1; c <= type.cleave && c < foe.length; c++) {
            const next = foe[c];
            if (Math.abs(next.x - target.x) > 90) break;
            next.pend = (next.pend || 0) + dmg * 0.6 * A.ROLE_VS[type.role][A.UNITS[next.t].role];
        }
        say(s, { e: 'hit', s: side, x: u.x, tx: target.x, role: type.role, id: u.id, tid: target.id });
    }

    // Damage lands after both sides have swung, so nobody gets a free tick for
    // being side 0 and a pair of units can kill each other.
    function pay(s) {
        for (let side = 0; side < 2; side++) {
            const list = s.u[side], other = 1 - side;
            let dead = false;
            for (let i = 0; i < list.length; i++) {
                const u = list[i];
                if (u.pend > 0) {
                    u.hp -= u.pend / (1 + s.p[side].oc * A.OVERCLOCK.armor);
                    u.pend = 0;
                    if (u.hp <= 0) {
                        dead = true;
                        const type = A.UNITS[u.t], killer = s.p[other];
                        const bounty = type.cost * A.BOUNTY;
                        killer.gold += bounty; killer.earned += bounty;
                        killer.xp += type.cost * A.KILL_XP;
                        killer.kills++;
                        s.p[side].lost++;
                        say(s, { e: 'die', s: side, x: u.x, t: u.t, id: u.id, g: Math.round(bounty) });
                    }
                }
            }
            if (dead) s.u[side] = list.filter(u => u.hp > 0);
        }
    }

    function burn(s) {
        for (let i = s.fire.length - 1; i >= 0; i--) {
            const f = s.fire[i];
            f.t -= DT;
            if (f.t <= 0) { s.fire.splice(i, 1); continue; }
            const foe = s.u[1 - f.s];
            for (let j = 0; j < foe.length; j++) {
                if (Math.abs(foe[j].x - f.x) <= f.w / 2) foe[j].pend = (foe[j].pend || 0) + f.dps * DT;
            }
        }
    }

    function server(s) {
        let l = false, r = false;
        for (const u of s.u[0]) { if (Math.abs(u.x - A.MID) <= A.SERVER.radius) { l = true; break; } }
        for (const u of s.u[1]) { if (Math.abs(u.x - A.MID) <= A.SERVER.radius) { r = true; break; } }
        if (l === r) return;
        const before = serverOwner(s);
        s.srv = Math.max(-1, Math.min(1, s.srv + (l ? 1 : -1) * DT / A.SERVER.capture));
        const now = serverOwner(s);
        if (now !== before && now >= 0) say(s, { e: 'server', s: now });
    }

    function diskFull(s) {
        const t = seconds(s) - A.DISK_FULL_AT;
        if (t <= 0) return;
        const rate = A.DISK_FULL_RATE * (1 + t / 60);
        for (let side = 0; side < 2; side++) {
            s.p[side].pendBase = (s.p[side].pendBase || 0) + A.AGES[s.p[side].age].hp * rate * DT;
        }
    }

    function walls(s) {
        const a = s.p[0], b = s.p[1];
        if (a.pendBase > 0) { a.hp -= a.pendBase; a.pendBase = 0; }
        if (b.pendBase > 0) { b.hp -= b.pendBase; b.pendBase = 0; }
        // a guest only ever guesses: the host says when it is over
        if (s.guessing) {
            a.hp = Math.max(1, a.hp); b.hp = Math.max(1, b.hp);
            return;
        }
        if (a.hp <= 0 && b.hp <= 0) {
            const fa = a.hp / A.AGES[a.age].hp, fb = b.hp / A.AGES[b.age].hp;
            a.hp = Math.max(0, a.hp); b.hp = Math.max(0, b.hp);
            // the same tick, which is what two bases sitting out the disk-full clock
            // comes to. Whoever hurt the other one more was playing the game
            const lead = fa !== fb ? fa - fb : a.baseDmg !== b.baseDmg ? a.baseDmg - b.baseDmg : a.kills - b.kills;
            finish(s, lead === 0 ? -1 : lead > 0 ? 0 : 1, 'base');
        } else if (a.hp <= 0) { a.hp = 0; finish(s, 1, 'base'); }
        else if (b.hp <= 0) { b.hp = 0; finish(s, 0, 'base'); }
    }

    function step(s) {
        if (s.over) return;
        s.tick++;
        economy(s, 0); economy(s, 1);
        turrets(s, 0); turrets(s, 1);
        burn(s);
        act(s, 0); act(s, 1);
        pay(s);
        server(s);
        diskFull(s);
        walls(s);
    }

    // -----------------------------------------------------------------
    // the wire. Small on purpose: a unit is five numbers, and over the relays
    // this goes out three times a second for half an hour.
    // -----------------------------------------------------------------
    function packPlayer(p, full) {
        const a = [Math.round(p.gold), Math.round(p.xp), p.age, Math.round(p.hp), p.modem,
            Math.round(p.trainT * 10), p.q,
            p.tur.map(t => [t.k, t.a]),
            Math.round(p.spCd), Math.round(p.buffT * 10), p.kills, p.lost, p.handicap === 1 ? 0 : p.handicap, p.hold, p.oc];
        // only the end screen wants these, so they only travel at the end
        if (full) a.push(Math.round(p.baseDmg), Math.round(p.earned));
        return a;
    }
    function unpackPlayer(p, a) {
        p.gold = a[0]; p.xp = a[1]; p.age = a[2]; p.hp = a[3]; p.modem = a[4];
        p.trainT = a[5] / 10; p.q = a[6];
        const old = p.tur;
        p.tur = a[7].map((t, i) => ({ k: t[0], a: t[1], cd: old[i] ? old[i].cd : 0 }));
        p.spCd = a[8]; p.buffT = a[9] / 10; p.kills = a[10]; p.lost = a[11];
        p.handicap = a[12] || 1;
        p.hold = a[13] || 0;
        p.oc = a[14] || 0;
        if (a.length > 15) { p.baseDmg = a[15]; p.earned = a[16]; }
    }
    function snapshot(s, extra) {
        const units = [];
        for (let side = 0; side < 2; side++) {
            for (const u of s.u[side]) {
                units.push(u.id, u.t + side * 16, Math.round(u.x), Math.round(u.hp), (u.stun || 0));
            }
        }
        return {
            m: s.match, k: s.tick, r: s.rng, n: s.nextId,
            o: s.over ? 1 : 0, w: s.winner, y: s.endWhy || 0,
            c: Math.round(s.srv * 100),
            p: [packPlayer(s.p[0], s.over), packPlayer(s.p[1], s.over)],
            u: units,
            f: s.fire.map(f => [f.s, Math.round(f.x), f.w, Math.round(f.dps), Math.round(f.t * 10)]),
            ...(extra || {})
        };
    }
    function applySnapshot(s, d) {
        s.match = d.m; s.tick = d.k; s.rng = d.r; s.nextId = d.n;
        s.over = !!d.o; s.winner = d.w; s.endWhy = d.y || null;
        s.srv = d.c / 100;
        unpackPlayer(s.p[0], d.p[0]);
        unpackPlayer(s.p[1], d.p[1]);
        const prev = new Map();
        s.u[0].forEach(u => prev.set(u.id, u));
        s.u[1].forEach(u => prev.set(u.id, u));
        s.u = [[], []];
        for (let i = 0; i + 4 < d.u.length; i += 5) {
            const code = d.u[i + 1], side = code >= 16 ? 1 : 0, id = d.u[i];
            const was = prev.get(id);
            s.u[side].push({ id, t: code - side * 16, x: d.u[i + 2], hp: d.u[i + 3], cd: was ? was.cd : 0, stun: d.u[i + 4] });
        }
        s.fire = d.f.map(f => ({ s: f[0], x: f[1], w: f[2], dps: f[3], t: f[4] / 10 }));
    }

    // -----------------------------------------------------------------
    // the bot. It plays through command() like everybody else and reads only
    // what a person can see on the screen. Its difficulty is how often it
    // looks up and how well it answers. Only "troll" gets paid extra, and says so.
    // -----------------------------------------------------------------
    function newBrain(diff, plan, seed) {
        return { diff, plan, rng: (seed | 0) || 12345, next: 0, ready: 0 };
    }
    function brainRand(b) {
        let x = b.rng | 0;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        b.rng = x | 0;
        return (x >>> 0) / 4294967296;
    }
    const worth = list => list.reduce((n, u) => n + A.UNITS[u.t].cost, 0);

    function think(s, side, b) {
        if (s.over) return;
        const now = seconds(s);
        if (now < b.next) return;
        const D = A.DIFFICULTIES[b.diff] || A.DIFFICULTIES.normal;
        const P = A.PLANS[b.plan] || A.PLANS.balanced;
        b.next = now + D.think * (0.8 + brainRand(b) * 0.4);
        const me = s.p[side], foeSide = 1 - side;
        const mine = s.u[side], theirs = s.u[foeSide];
        const wall = FRONT[side];
        const dir = side === 0 ? 1 : -1;

        const myArmy = worth(mine);
        const close = theirs.filter(u => (u.x - wall) * dir < 520);
        const closeWorth = worth(close);
        const danger = closeWorth > myArmy * 0.8 && closeWorth > 0;
        const veryClose = theirs.length && (theirs[0].x - wall) * dir < 280;
        const scale = A.AGES[me.age].cost;

        // a new age first: everything else waits for it unless the door is being kicked in
        const next = A.AGES[me.age + 1];
        let saving = 0;
        if (next && me.xp >= next.xp) {
            b.ready = b.ready || now;
            if (now - b.ready >= D.ageDelay) {
                if (me.gold >= next.gold) { command(s, side, { c: 'age' }); b.ready = 0; }
                else if (!danger) saving = next.gold;
            }
        }

        // no more ages: overclock, as soon as it does not leave the door open
        if (!next && !danger) {
            const cost = A.overclockGold(me.oc);
            if (me.oc < A.OVERCLOCK.max && me.xp >= A.overclockXp(me.oc)) {
                if (me.gold >= cost) command(s, side, { c: 'overclock' });
                else if (D.saves && mine.length >= 5) saving = cost;
            }
        }

        // a bot that fights in waves: wait at the rally line until there are
        // enough, go, and wait again once they are spent. Counting units rather
        // than comparing armies, because a bot that re-decides every second
        // spends the whole game walking to the line and being shot at
        if (P.wave) {
            if (me.hold && mine.length >= P.wave) command(s, side, { c: 'stance', h: 0 });
            else if (!me.hold && mine.length <= 2 && !veryClose) command(s, side, { c: 'stance', h: 1 });
        }

        // a special is wasted on an empty lane
        if (me.spCd <= 0 && brainRand(b) < D.specials) {
            const key = A.SPECIALS[me.age].key;
            const worthIt = key === 'caps' ? (mine.length >= 5 && theirs.length >= 3)
                : key === 'bsod' ? theirs.length >= 6
                    : theirs.length >= 3 && (veryClose || theirs.length >= 6);
            if (worthIt) command(s, side, { c: 'special' });
        }

        const spend = (cost) => me.gold - saving >= cost;

        // turrets: when something is coming, or up front if that is the plan
        const slots = slotsOf(me);
        const wantTurret = P.turretEarly ? true : (danger || now > 240 * (me.tur.length + 1));
        if (P.turretEvery && wantTurret && me.tur.length < slots && brainRand(b) < P.turretEvery) {
            // spam cannons answer a crowd, ping guns reach further
            const k = P.turretEarly && me.tur.length % 2 === 1 ? 1 : (close.length >= 4 ? 1 : 0);
            if (spend(A.turretCost(k, me.age))) command(s, side, { c: 'turret', k });
        } else if (P.turretEvery && !danger && me.tur.length >= slots && me.tur.some(t => t.a < me.age - 1)) {
            // two ages out of date is a decoration
            if (spend(A.turretCost(0, me.age) * 1.6)) command(s, side, { c: 'turret', k: me.tur.reduce((x, t) => (t.a < x.a ? t : x)).k });
        }

        // the modem, once nothing is on fire. It competes with the army, so it
        // has to be saved for on purpose or the money is always gone by then
        if (me.modem < P.modems && !danger && !saving) {
            const cost = A.MODEM_COST[me.modem];
            if (myArmy >= worth(theirs) * P.modemSafety) {
                if (me.gold >= cost) command(s, side, { c: 'modem' });
                else if (D.saves && !me.hold && mine.length >= 3 + me.modem * 2) saving = cost;
            }
        }

        if (P.noUnits) return;

        // units. Keep a queue short so the money is not parked in a factory,
        // and hold some back unless it is an emergency or we are swimming in it
        const rich = me.gold > 260 * scale;
        const maxQueue = rich ? A.QUEUE_MAX : danger ? 4 : 2;
        let guard = 0;
        while (me.q.length < maxQueue && mine.length + me.q.length < A.POP_CAP && guard++ < 3) {
            const r = pickRole(s, side, b, D, P);
            const type = A.unitFor(me.age, r);
            const margin = danger ? 0 : (P.reserve || 0) * me.gold;
            if (!spend(type.cost + margin)) break;
            if (!danger && brainRand(b) > D.spend) break;
            if (command(s, side, { c: 'train', r })) break;
        }
    }

    function pickRole(s, side, b, D, P) {
        const me = s.p[side];
        if (P.mono !== undefined) return P.mono;
        const mine = s.u[side], theirs = s.u[1 - side];

        // the king, when it can be afforded without it being the last thing we do
        if (me.age === 4 && me.gold >= A.UNITS[A.BOSS].cost * 1.15 && !mine.some(u => u.t === A.BOSS)) return 3;

        // what is alive or on its way, by gold
        const have = [0, 0, 0];
        const add = t => { const u = A.UNITS[t]; if (u.role < 3) have[u.role] += u.cost; };
        mine.forEach(u => add(u.t));
        me.q.forEach(add);
        const total = have[0] + have[1] + have[2];

        // somebody has to stand at the front, and a shooter should not be it
        if (D.frontCare > 0 && have[0] + have[2] <= have[1] * 0.25 && brainRand(b) < D.frontCare) {
            return theirs.length && A.UNITS[theirs[0].t].role === 0 && me.gold > A.unitFor(me.age, 2).cost * 1.4 ? 2 : 0;
        }

        // the plan's mix, leaning towards whatever answers what is on the screen:
        // a crowd of shooters wants grunts, tanks want shooters, grunts want tanks
        const want = P.mix.slice();
        if (D.counter > 0 && theirs.length >= 3) {
            const seen = [0, 0, 0];
            let sum = 0;
            theirs.forEach(u => { const t = A.UNITS[u.t]; if (t.role < 3) { seen[t.role] += t.cost; sum += t.cost; } });
            if (sum > 0) {
                want[0] += D.counter * seen[1] / sum;
                want[1] += D.counter * seen[2] / sum;
                want[2] += D.counter * seen[0] / sum;
            }
            const w = want[0] + want[1] + want[2];
            for (let i = 0; i < 3; i++) want[i] /= w;
        }
        let best = 0, gap = -Infinity;
        for (let r = 0; r < 3; r++) {
            if (P.mix[r] <= 0) continue;
            const share = total ? have[r] / total : 0;
            const g = want[r] - share + (brainRand(b) - 0.5) * 0.12;
            if (g > gap) { gap = g; best = r; }
        }
        return best;
    }

    // -----------------------------------------------------------------
    // two brains, no screen: what the balance check runs on
    // -----------------------------------------------------------------
    function playOut(seed, a, b, opts) {
        const s = newGame(seed);
        const left = newBrain(a.diff, a.plan, (seed * 7 + 11) | 0);
        const right = newBrain(b.diff, b.plan, (seed * 13 + 17) | 0);
        s.p[0].handicap = (A.DIFFICULTIES[a.diff] || {}).income || 1;
        s.p[1].handicap = (A.DIFFICULTIES[b.diff] || {}).income || 1;
        const limit = (opts && opts.limit || 3600) * HZ;
        while (!s.over && s.tick < limit) {
            think(s, 0, left);
            think(s, 1, right);
            step(s);
        }
        return s;
    }

    // -----------------------------------------------------------------
    // replays. A match is its seed, its handicaps and every command that went
    // through, each with the tick it landed on. Play those into the same rules
    // and the same match comes out, down to the last bit of the last hit point,
    // on any machine: nothing in here reads a clock, Math.random or a frame, and
    // + - * / and Math.round are the same everywhere JavaScript runs.
    //
    // What a replay cannot survive is the rules changing under it. So it carries
    // a fingerprint of every number the rules read, and the hash of the state it
    // ended on: a replay from older rules is turned away before it starts, and
    // one that still plays out differently is caught before anybody watches it.
    // -----------------------------------------------------------------
    const RULES_REV = 1;              // bump on any change to how step() or command() behave
    const REPLAY_FORMAT = 1;
    const REPLAY_LIMIT = {
        chars: 160000,                // of text. half an hour of a person clicking is two or three thousand
        bytes: 1 << 18,               // once unpacked
        cmds: 60000,
        ticks: 2 * 3600 * HZ,         // the disks fill up long before this
        name: 24                      // bytes of a player's name
    };
    const KEY_EVERY = 20 * HZ;        // a saved state every twenty seconds, for scrubbing back

    const CMD_NAMES = ['train', 'train', 'train', 'train', 'turret', 'turret', 'sell', 'modem', 'age', 'special', 'stance', 'stance', 'overclock', 'resign'];
    function cmdCode(c) {
        switch (c.c) {
            case 'train': return c.r;
            case 'turret': return 4 + c.k;
            case 'sell': return 6;
            case 'modem': return 7;
            case 'age': return 8;
            case 'special': return 9;
            case 'stance': return 10 + c.h;
            case 'overclock': return 12;
            default: return 13;       // resign: canCommand has already turned away anything else
        }
    }
    function codeCmd(n) {
        const c = CMD_NAMES[n];
        if (n < 4) return { c, r: n };
        if (n < 6) return { c, k: n - 4 };
        if (n === 10 || n === 11) return { c, h: n - 10 };
        return { c };
    }
    const WHY = ['base', 'resign', 'gone'];

    // start writing a game down. Only whoever runs the rules does this: the
    // host, or the one player of a game against a bot
    function record(s, seed) {
        s.log = { seed: seed | 0, c: [] };
        return s;
    }

    function fnv(text) {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return h >>> 0;
    }
    // every number the rules read, and none of the names, pictures and words
    // around them, so a renamed troll does not throw away everybody's replays
    const RULE_KEYS = ['HZ', 'LANE', 'BASE_FRONT', 'MID', 'POP_CAP', 'QUEUE_MAX', 'ROLE_VS', 'ROLE_SIEGE', 'AGES', 'UNITS', 'BOSS',
        'BOUNTY', 'KILL_XP', 'BASE_HIT_XP', 'BASE_HIT_GOLD', 'MODEM_STEP', 'MODEM_COST', 'TURRETS', 'TURRET_SELL', 'FIREWALL',
        'OVERTIME_BELOW', 'OVERTIME', 'CATCH_UP_XP', 'RALLY', 'MARCH_GAP', 'HOLD_GAP', 'SERVER', 'SPECIALS', 'OVERCLOCK',
        'DISK_FULL_AT', 'DISK_FULL_RATE'];
    const WORDS = { name: 1, sprite: 1, desc: 1, label: 1, note: 1, looksLeft: 1, size: 1 };
    function rulesPrint() {
        const derived = [];
        for (let n = 0; n <= A.OVERCLOCK.max; n++) derived.push(A.overclockXp(n), A.overclockGold(n));
        for (let a = 0; a < A.AGES.length; a++) for (let k = 0; k < A.TURRETS.length; k++) derived.push(A.turretCost(k, a), A.turretDmg(k, a));
        return fnv(JSON.stringify([RULES_REV, RULE_KEYS.map(k => A[k]), derived], (k, v) => (WORDS[k] ? undefined : v)));
    }
    // what the match came to. Leaves out what is not the rules': the sparks,
    // the log itself, the match number and how the host worded the ending
    const NOT_STATE = { ev: 1, log: 1, endWhy: 1, match: 1, guessing: 1 };
    function stateHash(s) {
        return fnv(JSON.stringify(s, (k, v) => (NOT_STATE[k] ? undefined : v)));
    }

    // a finished, recorded game, as a plain object
    function replayOf(s, meta) {
        if (!s || !s.log || !s.over) return null;
        meta = meta || {};
        return {
            print: rulesPrint(),
            seed: s.log.seed,
            h: [s.p[0].handicap, s.p[1].handicap],
            c: s.log.c.slice(),
            end: s.tick,
            w: s.winner,
            why: Math.max(0, WHY.indexOf(meta.why || s.endWhy || 'base')),
            hash: stateHash(s),
            me: meta.me === 1 ? 1 : 0,
            label: String(meta.label || ''),
            names: [String((meta.names || [])[0] || 'left'), String((meta.names || [])[1] || 'right')]
        };
    }

    // ---- bytes. Varints, because almost every number in here is small ----
    function writer() {
        const b = [];
        const w = {
            bytes: b,
            u8: n => { b.push(n & 255); },
            u32: n => { n >>>= 0; b.push(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); },
            v: n => { n = Math.max(0, Math.floor(n)); while (n >= 128) { b.push((n % 128) | 128); n = Math.floor(n / 128); } b.push(n); },
            str: (t, max) => {
                let u = new TextEncoder().encode(t);
                if (u.length > max) {
                    // cut on a whole character, not through the middle of one
                    let end = max;
                    while (end > 0 && (u[end] & 0xc0) === 0x80) end--;
                    u = u.slice(0, end);
                }
                w.v(u.length);
                for (let i = 0; i < u.length; i++) b.push(u[i]);
            }
        };
        return w;
    }
    function reader(b) {
        let at = 0;
        const need = n => { if (at + n > b.length) throw new Error('short'); };
        const r = {
            left: () => b.length - at,
            u8: () => { need(1); return b[at++]; },
            u32: () => { need(4); const n = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0; at += 4; return n; },
            v: () => {
                let n = 0, mul = 1;
                for (let i = 0; i < 6; i++) {
                    const x = r.u8();
                    n += (x & 127) * mul;
                    if (x < 128) return n;
                    mul *= 128;
                }
                throw new Error('varint');
            },
            str: max => {
                const n = r.v();
                if (n > max) throw new Error('name');
                need(n);
                const t = new TextDecoder().decode(b.subarray(at, at + n));
                at += n;
                return t;
            }
        };
        return r;
    }

    function packReplay(rp) {
        const w = writer();
        w.u8(REPLAY_FORMAT);
        w.u32(rp.print);
        w.u32(rp.seed);
        w.v(Math.round(rp.h[0] * 100)); w.v(Math.round(rp.h[1] * 100));
        w.v(rp.end);
        w.u8(rp.w + 1);
        w.u8(rp.why);
        w.u32(rp.hash);
        w.u8(rp.me);
        w.str(rp.label, 16);
        w.str(rp.names[0], REPLAY_LIMIT.name);
        w.str(rp.names[1], REPLAY_LIMIT.name);
        const c = rp.c;
        w.v(c.length / 2);
        let last = 0;
        for (let i = 0; i < c.length; i += 2) { w.v(c[i] - last); w.u8(c[i + 1]); last = c[i]; }
        return new Uint8Array(w.bytes);
    }

    // throws on anything that is not a replay this version can play
    function unpackReplay(bytes) {
        const r = reader(bytes);
        const format = r.u8();
        if (format !== REPLAY_FORMAT) throw tagged('old');
        const print = r.u32();
        if (print !== rulesPrint()) throw tagged('old');
        const rp = { print, seed: r.u32() | 0 };
        rp.h = [r.v() / 100, r.v() / 100];
        if (rp.h.some(h => !(h >= 0.5 && h <= 2))) throw new Error('handicap');
        rp.end = r.v();
        if (rp.end > REPLAY_LIMIT.ticks) throw tagged('big');
        rp.w = r.u8() - 1;
        if (rp.w < -1 || rp.w > 1) throw new Error('winner');
        rp.why = r.u8();
        if (rp.why >= WHY.length) throw new Error('why');
        rp.hash = r.u32();
        rp.me = r.u8();
        if (rp.me > 1) throw new Error('side');
        rp.label = r.str(16);
        rp.names = [r.str(REPLAY_LIMIT.name), r.str(REPLAY_LIMIT.name)];
        const n = r.v();
        if (n > REPLAY_LIMIT.cmds) throw tagged('big');
        // two bytes is the least a command takes, so a count that the rest of
        // the bytes cannot hold is a lie, and is not allowed to allocate
        if (n * 2 > r.left()) throw new Error('count');
        const c = new Array(n * 2);
        let t = 0;
        for (let i = 0; i < n; i++) {
            t += r.v();
            const code = r.u8();
            if (t > rp.end || code >= CMD_NAMES.length * 2) throw new Error('command');
            c[i * 2] = t; c[i * 2 + 1] = code;
        }
        if (r.left()) throw new Error('trailing');
        rp.c = c;
        return rp;
    }
    function tagged(why) { const e = new Error(why); e.why = why; return e; }

    // ---- text: deflated where the browser can, then base64url ----
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    function toB64(b) {
        let out = '';
        for (let i = 0; i < b.length; i += 3) {
            const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
            out += B64[n >> 18] + B64[(n >> 12) & 63];
            if (i + 1 < b.length) out += B64[(n >> 6) & 63];
            if (i + 2 < b.length) out += B64[n & 63];
        }
        return out;
    }
    function fromB64(t) {
        if (t.length % 4 === 1) throw new Error('b64');
        const out = new Uint8Array(Math.floor(t.length * 3 / 4));
        let o = 0, acc = 0, bits = 0;
        for (let i = 0; i < t.length; i++) {
            const v = B64.indexOf(t[i]);
            if (v < 0) throw new Error('b64');
            acc = ((acc << 6) | v) & 0xffffff; bits += 6;
            if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
        }
        return out.subarray(0, o);
    }
    async function squeeze(bytes, inflate, limit) {
        const st = inflate ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw');
        const w = st.writable.getWriter();
        w.write(bytes).catch(() => { });
        w.close().catch(() => { });
        const rd = st.readable.getReader();
        const parts = [];
        let n = 0;
        for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            n += value.length;
            // a small link that unpacks into something huge is not a replay
            if (n > limit) { rd.cancel().catch(() => { }); throw tagged('big'); }
            parts.push(value);
        }
        const out = new Uint8Array(n);
        let o = 0;
        parts.forEach(p => { out.set(p, o); o += p.length; });
        return out;
    }
    const canSqueeze = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

    async function encodeReplay(rp) {
        const raw = packReplay(rp);
        let out = new Uint8Array(raw.length + 1);
        out.set(raw, 1);
        if (canSqueeze()) {
            try {
                const z = await squeeze(raw, false, REPLAY_LIMIT.bytes);
                // deflated, its length goes first: some engines stop at the end of
                // a deflate stream and ignore whatever was stuck on after it, and
                // a replay should not be read differently in different browsers
                const w = writer();
                w.u8(1); w.v(z.length);
                if (w.bytes.length + z.length < out.length) {
                    out = new Uint8Array(w.bytes.length + z.length);
                    out.set(w.bytes, 0); out.set(z, w.bytes.length);
                }
            } catch (e) { /* the plain bytes are still a replay */ }
        }
        return toB64(out);
    }

    // a link's replay, or why not: 'broken', 'big', 'old' or 'browser'.
    // Never throws, whatever is pasted into it
    async function decodeReplay(text) {
        try {
            if (typeof text !== 'string' || !text) return { why: 'broken' };
            text = text.trim();
            if (text.length > REPLAY_LIMIT.chars) return { why: 'big' };
            const bytes = fromB64(text);
            if (!bytes.length) return { why: 'broken' };
            let raw;
            if (bytes[0] === 0) raw = bytes.subarray(1);
            else if (bytes[0] === 1) {
                const r = reader(bytes);
                r.u8();
                const n = r.v();
                if (n !== r.left()) return { why: 'broken' };
                if (!canSqueeze()) return { why: 'browser' };
                raw = await squeeze(bytes.subarray(bytes.length - n), true, REPLAY_LIMIT.bytes);
            } else return { why: 'broken' };
            if (raw.length > REPLAY_LIMIT.bytes) return { why: 'big' };
            return { rp: unpackReplay(raw) };
        } catch (e) {
            return { why: (e && e.why) || 'broken' };
        }
    }

    // the start of a replay's match, before anything has happened
    function replayStart(rp) {
        const s = newGame(rp.seed);
        s.p[0].handicap = rp.h[0];
        s.p[1].handicap = rp.h[1];
        return s;
    }
    // one tick of a replay: the commands that landed on it, then the rules.
    // Returns false when a command the original took is turned away now, which
    // only happens when the rules are not the ones it was made with
    function replayTick(s, rp, cur) {
        const c = rp.c;
        while (cur.i < c.length && c[cur.i] === s.tick) {
            const code = c[cur.i + 1];
            cur.i += 2;
            if (command(s, code & 1, codeCmd(code >> 1))) return false;
        }
        if (!s.over) step(s);
        return true;
    }
    const clone = s => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

    // play the whole thing through once, fast, before anybody watches it: it
    // has to end where it says, on the tick it says, in the state it says.
    // The states it keeps on the way are what makes scrubbing back cheap
    function verifyReplay(rp) {
        const s = replayStart(rp);
        const cur = { i: 0 };
        const keys = [];
        let fine = true;
        while (!s.over) {
            if (s.tick % KEY_EVERY === 0) keys.push({ tick: s.tick, i: cur.i, s: clone(s) });
            if (s.tick > rp.end || !replayTick(s, rp, cur)) { fine = false; break; }
        }
        const ok = fine && s.over && s.tick === rp.end && s.winner === rp.w && cur.i === rp.c.length && stateHash(s) === rp.hash;
        return { ok, keys, end: s };
    }
    // the state at any tick, from the nearest saved one before it
    function replaySeek(rp, keys, tick) {
        tick = Math.max(0, Math.min(rp.end, Math.floor(tick)));
        let k = keys[0];
        for (let i = keys.length - 1; i >= 0; i--) if (keys[i].tick <= tick) { k = keys[i]; break; }
        const s = clone(k.s), cur = { i: k.i };
        while (s.tick < tick && !s.over) replayTick(s, rp, cur);
        // the very end means the result, even when it was a surrender on the last tick
        if (tick === rp.end) while (!s.over && s.tick <= rp.end) replayTick(s, rp, cur);
        return { s, cur };
    }

    A.replay = {
        FORMAT: REPLAY_FORMAT, RULES_REV, LIMIT: REPLAY_LIMIT, KEY_EVERY, WHY,
        record, replayOf, rulesPrint, stateHash,
        pack: packReplay, unpack: unpackReplay, encode: encodeReplay, decode: decodeReplay,
        start: replayStart, tick: replayTick, verify: verifyReplay, seek: replaySeek,
        cmdCode, codeCmd
    };

    Object.assign(A, {
        DT, rand, newGame, step, command, canCommand, seconds,
        incomeOf, xpRateOf, slotsOf, serverOwner,
        snapshot, applySnapshot,
        newBrain, think, playOut
    });
})(typeof window !== 'undefined' ? window : globalThis);
