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

    Object.assign(A, {
        DT, rand, newGame, step, command, canCommand, seconds,
        incomeOf, xpRateOf, slotsOf, serverOwner,
        snapshot, applySnapshot,
        newBrain, think, playOut
    });
})(typeof window !== 'undefined' ? window : globalThis);
