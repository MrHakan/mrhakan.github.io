// ===================================================================
// DUNGEONZ 98 — the rules, the dungeon, the minions, the bots
//
// Nothing in here touches the page, which is how check-dungeonz.mjs can play a
// few hundred runs in a minute. Numbers live in dungeonz-data.js. The height map
// and the flow fields are games/ps1/ps1-world.js, shared with wizardz.
//
// One state object and three doors, the same as wizardz:
//   setInput(s, i, {mx, mz, yaw, pitch, fire, jump, dash, ink})   what they are holding
//   command(s, i, {c: 'cast'|'pick', ...})                         what they just did
//   step(s)                                                        a tick
// A bot, a person and a person at the far end of a wire all come in that way.
// command() is what a stranger can reach, so it refuses nonsense rather than throwing.
//
// The dungeon is built from the run's seed, so every screen builds the same rooms
// and the same sleeping minions, and only what is awake goes over the wire.
// ===================================================================
(function () {
    'use strict';

    const D = window.DZ;
    const PW = window.PS1_WORLD;
    const RUN = D.RUN, HERO = RUN.hero;
    const HZ = RUN.tickHz, DT = 1 / HZ;
    const { sin, cos, hypot, atan2, sqrt, abs, min, max, floor, ceil, round, PI } = Math;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const WALL_H = 4.5, LOW_H = 0.9, PILLAR_H = 3.6, SHOT_Y = 1.2;
    const SKILL_INDEX = {};
    D.SKILLS.forEach((sk, i) => { SKILL_INDEX[sk.id] = i; });
    const PAS_INDEX = {};
    D.PASSIVES.forEach((p, i) => { PAS_INDEX[p.id] = i; });
    const KIND_INDEX = {};
    D.MINION_KINDS.forEach((k, i) => { KIND_INDEX[k] = i; });

    // a small fast random, from a seed, so a dungeon is the same everywhere
    function rng(seed) {
        let a = (seed >>> 0) || 1;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const mix = (...n) => n.reduce((h, v) => Math.imul(h ^ (v >>> 0), 2654435761) >>> 0, 0x811c9dc5);
    function rnd(s) { s.rng = (Math.imul(s.rng, 1103515245) + 12345) >>> 0; return s.rng / 4294967296; }

    // ===============================================================
    // the dungeon, from a seed
    //
    // Rooms in a line along +z. Each fight room has a gate on its way out that opens
    // when everything in it is dead. Three sections, a shrine after each, and the boss's
    // room at the end. Every room is a rectangle of floor in a solid block, so the whole
    // thing is a height map and the walls come out of the mesher as cliffs.
    // ===============================================================
    const X0 = -30, XW = 60;
    const DUNGEONS = new Map();
    function buildDungeon(id, seed) {
        const key = id + ':' + (seed >>> 0);
        if (DUNGEONS.has(key)) return DUNGEONS.get(key);
        const def = D.dungeonById(id);
        const r = rng(mix(seed, 0xd0d0));
        const ri = (a, b) => a + floor(r() * (b - a + 1));
        const rooms = [], corridors = [], gates = [];
        let z = 2, prev = null;
        const addRoom = (kind, w, d, cx, extra) => {
            if (prev) {
                // a corridor four wide where the two rooms overlap
                const lo = max(prev.x0, cx - w / 2) + 3, hi = min(prev.x1, cx + w / 2) - 3;
                const ccx = round(clamp((prev.cx + cx) / 2, lo, hi));
                const len = ri(6, 9);
                corridors.push({ x0: ccx - 2, x1: ccx + 2, z0: prev.z1, z1: prev.z1 + len });
                prev.exit = { x: ccx, z: prev.z1 };
                gates.push({ i: gates.length, room: prev.i, x0: ccx - 2, x1: ccx + 2, z0: prev.z1, z1: prev.z1 + 0.6 });
                prev.gate = gates.length - 1;
                z = prev.z1 + len;
            }
            const room = Object.assign({ i: rooms.length, kind, x0: cx - w / 2, x1: cx + w / 2, z0: z, z1: z + d, cx, cz: z + d / 2, gate: -1, entry: prev ? prev.exit : { x: cx, z: z + 2 } }, extra || {});
            rooms.push(room);
            prev = room;
            return room;
        };
        addRoom('shrine', 14, 14, 0, { shrine: 0, section: -1 });
        let cx = 0;
        const sections = def.rooms.length;
        for (let sec = 0; sec < sections; sec++) {
            for (let k = 0; k < def.rooms[sec]; k++) {
                const w = 16 + 2 * ri(0, 4), d = 16 + 2 * ri(0, 3);
                cx = clamp(cx + ri(-6, 6), -XW / 2 + 2 + w / 2, XW / 2 - 2 - w / 2);
                // the corridor needs room in both
                if (abs(cx - prev.cx) > (w + (prev.x1 - prev.x0)) / 2 - 8) cx = prev.cx + Math.sign(cx - prev.cx) * ((w + (prev.x1 - prev.x0)) / 2 - 8);
                cx = round(cx);
                addRoom('fight', w, d, cx, { section: sec, last: k === def.rooms[sec] - 1 });
            }
            cx = clamp(cx, -6, 6);
            addRoom('shrine', 14, 14, round(cx), { shrine: sec + 1, section: sec });
        }
        const boss = addRoom('boss', 34, 34, 0, { section: sections });
        // the door behind you in the boss's room: open until the fight starts
        gates.push({ i: gates.length, room: boss.i, door: true, x0: boss.entry.x - 2, x1: boss.entry.x + 2, z0: boss.z0 - 0.6, z1: boss.z0 });
        boss.door = gates.length - 1;
        const zEnd = boss.z1 + 2;

        // ---- what stands in the rooms ----
        const pillarsFor = room => {
            const out = [];
            if (room.kind !== 'fight') return out;
            const style = ri(0, 4);
            const w = room.x1 - room.x0, d = room.z1 - room.z0;
            if (style === 0) {
                // four pillars round the middle
                const ox = w / 2 - 4.5, oz = d / 2 - 4.5;
                for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push([room.cx + sx * ox, room.cz + sz * oz, 0.8, 0.8, PILLAR_H]);
            } else if (style === 1) {
                // two low walls to duck behind. shots go over, nothing walks through
                out.push([room.cx - w / 4, room.cz, 2, 0.4, LOW_H]);
                out.push([room.cx + w / 4, room.cz + 2, 2, 0.4, LOW_H]);
            } else if (style === 2) {
                // a block in the middle
                out.push([room.cx, room.cz, 1.5, 1.5, PILLAR_H]);
            } else if (style === 3) {
                // a row of short pillars
                for (let k = -1; k <= 1; k++) out.push([room.cx + k * (w / 4), room.cz - 1, 0.6, 0.6, PILLAR_H]);
            }
            return out;
        };
        let boxes = [];
        rooms.forEach(room => { room.boxes = pillarsFor(room); boxes = boxes.concat(room.boxes); });
        // the boss's room: four pillars far out, to hide behind for a moment
        {
            const b = boss;
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
                const p = [b.cx + sx * 10, b.cz + sz * 10, 1, 1, PILLAR_H];
                b.boxes.push(p); boxes.push(p);
            }
        }
        const open = (x, zz) => {
            for (const rm of rooms) if (x >= rm.x0 && x <= rm.x1 && zz >= rm.z0 && zz <= rm.z1) return true;
            for (const c of corridors) if (x >= c.x0 && x <= c.x1 && zz >= c.z0 && zz <= c.z1) return true;
            return false;
        };
        // a grid of what is floor, half a metre a cell, so the height function is a lookup
        const GX = XW * 2, GZ = ceil(zEnd * 2) + 2;
        const floorGrid = new Float32Array(GX * GZ).fill(WALL_H);
        for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
            const x = X0 + (i + 0.5) / 2, zz = (j + 0.5) / 2;
            if (!open(x, zz)) continue;
            let h = 0;
            for (const b of boxes) if (abs(x - b[0]) < b[2] && abs(zz - b[1]) < b[3]) h = max(h, b[4]);
            floorGrid[j * GX + i] = h;
        }
        const ground = (x, zz) => {
            const i = floor((x - X0) * 2), j = floor(zz * 2);
            if (i < 0 || j < 0 || i >= GX || j >= GZ) return WALL_H;
            return floorGrid[j * GX + i];
        };
        const world = PW.build({ x0: X0, z0: 0, w: XW, d: GZ / 2, cells: 2, nav: 1, outer: WALL_H, rim: 0, ground: (x, zz) => ground(x - 0.01, zz - 0.01) });

        // a chest in the last fight room of each section, somewhere you can stand
        const chests = [];
        rooms.forEach(room => {
            if (room.kind !== 'fight' || !room.last) return;
            for (let k = 0; k < 40; k++) {
                const x = room.x0 + 2 + r() * (room.x1 - room.x0 - 4), zz = room.z0 + 3 + r() * (room.z1 - room.z0 - 6);
                if (world.passable[world.navCell(x, zz)]) { chests.push({ i: chests.length, room: room.i, x, z: zz }); break; }
            }
        });
        const dun = {
            id: def.id, def, seed, rooms, corridors, gates, chests, boxes, ground, world, zEnd,
            x0: X0, x1: X0 + XW, boss: boss.i,
            roomAt(x, zz) {
                for (const rm of rooms) if (x >= rm.x0 && x <= rm.x1 && zz >= rm.z0 && zz <= rm.z1) return rm.i;
                return -1;
            }
        };
        if (DUNGEONS.size > 12) DUNGEONS.delete(DUNGEONS.keys().next().value);
        DUNGEONS.set(key, dun);
        return dun;
    }

    // ---- minions, from the seed, the room and how many times the party has wiped ----
    function spawnRoom(s, room, attempt) {
        const dun = s.dun, def = dun.def, out = [];
        if (room.kind !== 'fight') return out;
        const r = rng(mix(s.seed, room.i, attempt, 0x5eed));
        const ri = (a, b) => a + floor(r() * (b - a + 1));
        const weights = Object.assign({}, def.kinds);
        if (room.section >= 1) for (const k in def.late) weights[k] = (weights[k] || 0) + def.late[k];
        const kinds = Object.keys(weights), total = kinds.reduce((a, k) => a + weights[k], 0);
        const pickKind = () => { let x = r() * total; for (const k of kinds) { x -= weights[k]; if (x <= 0) return k; } return kinds[0]; };
        const area = (room.x1 - room.x0) * (room.z1 - room.z0);
        // the first section is where a level one party learns the game: fewer of them
        let packs = ri(def.packs[0], def.packs[1]) + (area > 420 && room.section > 0 ? 1 : 0) - (room.section === 0 ? 1 : 0);
        if (room.i === 1) packs = min(packs, 2);
        packs = max(1, packs);
        const W = dun.world;
        let n = 0;
        for (let p = 0; p < packs; p++) {
            const kind = pickKind();
            let size = ri(def.pack[0], def.pack[1]);
            if (room.i === 1) size = min(size, 5);
            if (kind === 'swarm') size = 6;
            if (kind === 'brute') size = 1 + (r() < 0.3 ? 1 : 0);
            if (kind === 'healer') size = 1;
            // the pack's middle: away from the door you came in by
            let ax = room.cx, az = room.cz;
            for (let k = 0; k < 30; k++) {
                ax = room.x0 + 3 + r() * (room.x1 - room.x0 - 6);
                az = room.z0 + 7 + r() * (room.z1 - room.z0 - 9);
                if (W.passable[W.navCell(ax, az)]) break;
            }
            for (let m = 0; m < size; m++) {
                // a healer or a shield joins a pack of something else, rather than being alone
                let k2 = kind;
                if (m === 0 && size > 2 && r() < 0.25) k2 = pickKind();
                let x = ax, z = az;
                for (let t = 0; t < 12; t++) {
                    x = ax + (r() - 0.5) * 5; z = az + (r() - 0.5) * 5;
                    if (x > room.x0 + 1 && x < room.x1 - 1 && z > room.z0 + 1 && z < room.z1 - 1 && W.passable[W.navCell(x, z)]) break;
                    x = ax; z = az;
                }
                // no elites before the first shrine: a level one party has enough to learn
                const elite = room.section >= 1 && r() < def.elite;
                const mn = newMinion(s, room.i * 64 + n, k2, x, z, room.i, elite, room.section);
                // the same room again after a wipe is worth half: no farming your way out of it
                if (attempt > 0) mn.xp *= 0.5;
                out.push(mn);
                n++;
                if (n >= 63) return out;
            }
        }
        return out;
    }
    function newMinion(s, id, kind, x, z, room, elite, section) {
        const M = D.MINIONS[kind], def = s.dun.def;
        const grow = 1 + def.grow * max(0, section);
        const hp = M.hp * def.hpMul * grow * (elite ? D.ELITE.hp : 1);
        return {
            id, kind, room, elite: !!elite,
            x, z, y: 0, yaw: PI, vx: 0, vz: 0, kx: 0, kz: 0,
            hp, maxHp: hp,
            dmgMul: def.dmgMul * (1 + def.grow * 0.5 * max(0, section)) * (elite ? D.ELITE.dmg : 1),
            xp: M.xp * (elite ? D.ELITE.xp : 1) * (1 + 0.15 * max(0, section)),
            r: M.r * (elite ? D.ELITE.size : 1),
            state: 0,          // 0 asleep, 1 awake, 2 dead
            act: 0, actT: 0,   // what it is doing: 0 nothing, 1 winding up, 2 fuse
            cd: 0, target: -1, think: 0,
            slow: 0, slowT: 0, stunT: 0, hitT: 0
        };
    }

    // ===============================================================
    // a new run
    // ===============================================================
    function newHero(i, p, dun) {
        const room = dun.rooms[0];
        const x = room.cx + (i - 1.5) * 1.6, z = room.z0 + 4;
        return {
            i, id: p.id, name: p.name || 'wizard', avatar: p.avatar || null, bot: !!p.bot,
            x, y: 0, z, vy: 0, yaw: PI, pitch: 0, mvx: 0, mvz: 0, kx: 0, kz: 0, grounded: true,
            hp: HERO.hp, maxHp: HERO.hp, level: 1, xp: 0, picks: 1, offer: null, offerN: 0,
            skills: [], pas: {},
            shield: 0, shieldT: 0, regen: [], slow: 0, slowT: 0, stunT: 0, safe: 0,
            down: false, bleed: 0, revive: 0, out: false,
            fireCd: 0, dashCd: 0, dashT: 0, dashX: 0, dashZ: 0, stance: false, firing: false,
            hitT: 0, castT: 0, threat: 0
        };
    }
    function newRun(o) {
        o = o || {};
        const seed = (o.seed >>> 0) || 1;
        const dun = buildDungeon(o.dungeon || D.DUNGEONS[0].id, seed);
        const list = (o.players || []).slice(0, RUN.seats);
        while (list.length < RUN.seats) list.push({ id: 'bot-' + list.length, name: 'bot', bot: true });
        const s = {
            seed, rng: seed, dungeon: dun.id, dun, run: o.run || 1,
            tick: 0, t: 0, phase: 'countdown', phaseT: RUN.countdown,
            heroes: list.map((p, i) => newHero(i, p, dun)),
            input: list.map(() => blankInput()),
            minions: [], byId: new Map(), nextDyn: 100000,
            entered: new Uint8Array(dun.rooms.length), cleared: new Uint8Array(dun.rooms.length),
            gateOpen: new Uint8Array(dun.gates.length),
            chestOpen: new Uint8Array(dun.chests.length),
            frontier: 0, lastShrine: 0, shrine: { room: 0, t: 0, done: false, healed: true },
            continues: RUN.continues, wipeT: 0, attempt: 0,
            proj: [], tel: [], zones: [], walls: [], decoys: [], nextId: 1,
            boss: null, bossOn: false,
            over: null, reason: null,
            ev: [], guessing: false,
            stats: o.stats ? newStats() : null
        };
        s.input.forEach((inp, i) => { inp.yaw = s.heroes[i].yaw; });
        dun.rooms.forEach(room => { spawnRoom(s, room, 0).forEach(m => addMinion(s, m)); });
        s.cleared[0] = 1; s.entered[0] = 1;
        s.gateOpen[dun.rooms[dun.boss].door] = 1;
        s.heroes.forEach(h => rollOffer(s, h));
        return s;
    }
    function newStats() {
        return { kills: 0, wipes: 0, downs: 0, revives: 0, bossT: 0, bossAt: -1, levelAtBoss: 0, picks: {}, dmg: {}, saved: {}, own: {}, sections: [], deaths: 0, casts: 0 };
    }
    const blankInput = () => ({ mx: 0, mz: 0, yaw: PI, pitch: 0, fire: false, jump: false, dash: false, ink: false });
    function addMinion(s, m) { s.minions.push(m); s.byId.set(m.id, m); }
    function emit(s, ...e) { if (!s.guessing) s.ev.push(e); }

    // ===============================================================
    // levels, cards and picks
    // ===============================================================
    const skillOf = (h, id) => h.skills.find(k => k.id === id);
    function cardsFor(s, h) {
        const pool = [];
        if (h.skills.length < D.MAX_SKILLS) D.SKILLS.forEach(sk => { if (!skillOf(h, sk.id)) pool.push({ t: 'new', id: sk.id }); });
        h.skills.forEach(k => { if (k.rank < 3) pool.push({ t: 'rank', id: k.id }); });
        // the first pick is always a skill: nobody wants to start with "more ram"
        if (h.skills.length) D.PASSIVES.forEach(p => { if ((h.pas[p.id] || 0) < p.max) pool.push({ t: 'pas', id: p.id }); });
        return pool;
    }
    function rollOffer(s, h) {
        if (h.picks <= 0) { h.offer = null; return; }
        const r = rng(mix(s.seed, h.i, h.offerN, 0xca4d));
        const pool = cardsFor(s, h);
        const out = [];
        // while there is room for a skill, one card is always a new one
        const fresh = pool.filter(c => c.t === 'new');
        if (fresh.length && h.skills.length < D.MAX_SKILLS) out.push(fresh.splice(floor(r() * fresh.length), 1)[0]);
        const rest = pool.filter(c => !out.some(o => o.t === c.t && o.id === c.id));
        while (out.length < 3 && rest.length) out.push(rest.splice(floor(r() * rest.length), 1)[0]);
        h.offer = out;
    }
    function applyCard(s, h, c) {
        if (c.t === 'new') h.skills.push({ id: c.id, rank: 1, cd: 0 });
        else if (c.t === 'rank') { const k = skillOf(h, c.id); if (k) k.rank = min(3, k.rank + 1); }
        else if (c.t === 'pas') {
            h.pas[c.id] = (h.pas[c.id] || 0) + 1;
            if (c.id === 'ram') { const was = h.maxHp; h.maxHp = maxHpOf(h); h.hp += h.maxHp - was; }
        }
        h.picks--;
        h.offerN++;
        if (s.stats) {
            const k = c.t === 'pas' ? 'pas:' + c.id : c.id;
            s.stats.picks[k] = (s.stats.picks[k] || 0) + 1;
        }
        emit(s, 'pick', h.i, c.t === 'pas' ? 1 : 0, c.t === 'pas' ? PAS_INDEX[c.id] : SKILL_INDEX[c.id]);
        rollOffer(s, h);
    }
    const maxHpOf = h => round((HERO.hp + HERO.hpPerLevel * (h.level - 1)) * (1 + 0.2 * (h.pas.ram || 0)));
    const dmgOf = h => (1 + HERO.dmgPerLevel * (h.level - 1)) * (1 + 0.12 * (h.pas.overclock || 0));
    const cdOf = (h, sk) => sk.cd * (1 - 0.12 * (h.pas.defrag || 0)) - (sk.id === 'blink' ? sk.r[skillOf(h, sk.id).rank - 1].cdr : 0);
    function giveXp(s, amount) {
        for (const h of s.heroes) {
            h.xp += amount;
            while (h.xp >= D.xpFor(h.level)) {
                h.xp -= D.xpFor(h.level);
                h.level++;
                const was = h.maxHp;
                h.maxHp = maxHpOf(h);
                if (!h.down && !h.out) h.hp = min(h.maxHp, h.hp + (h.maxHp - was) + h.maxHp * 0.15);
                h.picks++;
                if (!h.offer) rollOffer(s, h);
                emit(s, 'level', h.i, h.level);
            }
        }
    }

    // ===============================================================
    // commands: the only things a player does that are not holding a button
    // ===============================================================
    function sanitizeInput(d) {
        const num = (v, a, b, def) => (typeof v === 'number' && isFinite(v)) ? clamp(v, a, b) : def;
        return {
            mx: num(d && d.mx, -1, 1, 0), mz: num(d && d.mz, -1, 1, 0),
            yaw: num(d && d.yaw, -100, 100, 0), pitch: num(d && d.pitch, -1.5, 1.5, 0),
            fire: !!(d && d.fire), jump: !!(d && d.jump), dash: !!(d && d.dash), ink: !!(d && d.ink)
        };
    }
    function setInput(s, i, d) { if (s.input[i]) s.input[i] = sanitizeInput(d); }
    const canAct = h => !h.down && !h.out && h.stunT <= 0;
    // why a cast would not go, or null
    function castProblem(s, i, slot) {
        const h = s.heroes[i];
        if (!h) return 'nobody';
        if (s.phase !== 'live') return 'wait';
        if (!canAct(h)) return h.down || h.out ? 'down' : 'stunned';
        const k = h.skills[slot];
        if (!k) return 'empty';
        if (k.cd > 0) return 'cooling';
        return null;
    }
    function command(s, i, c) {
        if (!c || typeof c !== 'object' || !s.heroes[i]) return 'nonsense';
        const h = s.heroes[i];
        if (c.c === 'cast') {
            const slot = c.k | 0;
            if (slot < 0 || slot > 3) return 'nonsense';
            const why = castProblem(s, i, slot);
            if (why) return why;
            const q = typeof c.q === 'number' && isFinite(c.q) ? clamp(c.q, 0, 1) : 0;
            const yaw = typeof c.y === 'number' && isFinite(c.y) ? c.y : h.yaw;
            cast(s, i, slot, q, yaw, c.tx, c.tz);
            return null;
        }
        if (c.c === 'pick') {
            if (!h.offer || h.picks <= 0) return 'nothing';
            // cards are spent at a shrine, once the party is in and healed
            if (!(s.shrine && !s.shrine.done && s.shrine.healed)) return 'notshrine';
            const card = h.offer[c.n | 0];
            if (!card) return 'nonsense';
            applyCard(s, h, card);
            return null;
        }
        return 'nonsense';
    }

    // ===============================================================
    // casting
    // ===============================================================
    // how much a drawing is worth: a key is 1, a clean sigil up to 1.5
    function drawPower(q) {
        const st = RUN.stance;
        if (!q) return 1;
        const u = clamp((q - st.floor) / (st.top - st.floor), 0, 1);
        return st.power[0] + (st.power[1] - st.power[0]) * u;
    }
    function groundPoint(s, h, range, tx, tz) {
        const fx = sin(h.yaw), fz = -cos(h.yaw);
        let x = h.x + fx * range * 0.6, z = h.z + fz * range * 0.6;
        if (typeof tx === 'number' && typeof tz === 'number' && isFinite(tx) && isFinite(tz)) { x = tx; z = tz; }
        const d = hypot(x - h.x, z - h.z);
        if (d > range) { x = h.x + (x - h.x) / d * range; z = h.z + (z - h.z) / d * range; }
        // walk it back until it is on the floor and can be seen
        const W = s.dun.world;
        for (let k = 0; k < 12; k++) {
            if (W.at(x, z) < 0.5 && W.clearLine(h.x, 1.4, h.z, x, 0.6, z)) break;
            x = h.x + (x - h.x) * 0.8; z = h.z + (z - h.z) * 0.8;
        }
        return { x, z };
    }
    function cast(s, i, slot, q, yaw, tx, tz) {
        const h = s.heroes[i], k = h.skills[slot], sk = D.skillById(k.id), R = sk.r[k.rank - 1];
        const pow = drawPower(q) * dmgOf(h);
        k.cd = cdOf(h, sk);
        h.yaw = yaw;
        h.castT = 0.3;
        if (h.stance) h.stance = false;
        emit(s, 'cast', i, SKILL_INDEX[sk.id], q > 0 ? round(q * 100) : 0);
        if (s.stats) s.stats.casts = (s.stats.casts || 0) + 1;
        const fx = sin(yaw), fz = -cos(yaw);
        switch (sk.kind) {
            case 'shot':
                shoot(s, { side: 0, o: i, kind: sk.id, x: h.x + fx * 0.6, z: h.z + fz * 0.6, vx: fx * sk.speed, vz: fz * sk.speed, r: sk.size, dmg: R.dmg * pow, life: 2.2, aoe: R.aoe || 0, pierce: R.pierce || 0, slow: R.slow || 0, slowT: R.dur || 0, src: sk.id });
                break;
            case 'missiles': {
                const targets = enemiesNear(s, h.x, h.z, sk.range).sort((a, b) => a.d - b.d);
                for (let n = 0; n < R.n; n++) {
                    const tg = targets.length ? targets[n % targets.length].e : null;
                    const a = yaw + (n - (R.n - 1) / 2) * 0.35;
                    shoot(s, { side: 0, o: i, kind: 'missile', x: h.x, z: h.z, vx: sin(a) * sk.speed, vz: -cos(a) * sk.speed, r: 0.3, dmg: R.dmg * pow, life: 2.4, home: tg ? tg.id : null, homeBoss: tg && tg.boss, turn: sk.turn, src: sk.id });
                }
                break;
            }
            case 'chain': {
                // whatever is nearest the aim, then hop
                let best = null, bestScore = 1e9;
                for (const t of enemiesNear(s, h.x, h.z, sk.range)) {
                    const a = abs(angleDiff(atan2(t.e.x - h.x, -(t.e.z - h.z)), yaw));
                    if (a > 0.6) continue;
                    if (!s.dun.world.clearLine(h.x, SHOT_Y, h.z, t.e.x, SHOT_Y, t.e.z)) continue;
                    const score = a * 10 + t.d * 0.1;
                    if (score < bestScore) { bestScore = score; best = t.e; }
                }
                if (!best) { emit(s, 'chain', i, r1(h.x), r1(h.z), r1(h.x + fx * 8), r1(h.z + fz * 8)); break; }
                const hit = new Set();
                let cur = best, dmg = R.dmg * pow, px = h.x, pz = h.z;
                for (let n = 0; n <= R.jumps && cur; n++) {
                    hit.add(cur);
                    emit(s, 'chain', i, r1(px), r1(pz), r1(cur.x), r1(cur.z));
                    px = cur.x; pz = cur.z;
                    damageEnemy(s, cur, dmg, { o: i, src: sk.id, fx: 0, fz: 0 });
                    dmg *= sk.fall;
                    let next = null, nd = sk.hop;
                    for (const t of enemiesNear(s, px, pz, sk.hop)) if (!hit.has(t.e) && t.d < nd) { nd = t.d; next = t.e; }
                    cur = next;
                }
                break;
            }
            case 'strike': {
                const p = groundPoint(s, h, sk.range, tx, tz);
                s.tel.push({ id: s.nextId++, k: 'strike', x: p.x, z: p.z, r: R.aoe, t: 0, total: sk.delay, dmg: R.dmg * pow, side: 0, o: i, src: sk.id });
                break;
            }
            case 'zone': {
                const p = groundPoint(s, h, sk.range, tx, tz);
                if (s.zones.filter(zn => zn.o === i).length >= 2) s.zones.splice(s.zones.findIndex(zn => zn.o === i), 1);
                s.zones.push({ id: s.nextId++, k: sk.id, x: p.x, z: p.z, r: R.aoe, life: R.life, dps: R.dps * pow, slow: R.slow, o: i });
                break;
            }
            case 'wall': {
                const p = groundPoint(s, h, sk.range, tx, tz);
                if (s.walls.filter(w => w.o === i).length >= 2) s.walls.splice(s.walls.findIndex(w => w.o === i), 1);
                // across your aim
                s.walls.push({ id: s.nextId++, x: p.x, z: p.z, ang: yaw, hw: R.w / 2, hd: 0.5, hp: R.hp * pow, maxHp: R.hp * pow, life: R.life, chill: R.chill, o: i, ca: cos(yaw), sa: sin(yaw) });
                break;
            }
            case 'decoy': {
                const p = groundPoint(s, h, sk.range, tx, tz);
                s.decoys = s.decoys.filter(d => d.o !== i);
                s.decoys.push({ id: s.nextId++, x: p.x, z: p.z, hp: R.hp * pow, maxHp: R.hp * pow, life: R.life, taunt: R.taunt, boom: R.boom * pow, aoe: sk.aoe, o: i, yaw });
                break;
            }
            case 'nova': {
                emit(s, 'nova', i, R.aoe, SKILL_INDEX[sk.id]);
                for (const t of enemiesNear(s, h.x, h.z, R.aoe)) {
                    const d = t.d || 0.1;
                    damageEnemy(s, t.e, R.dmg * pow, { o: i, src: sk.id, fx: 0, fz: 0 });
                    if (!t.e.boss) {
                        t.e.stunT = max(t.e.stunT, R.stun);
                        t.e.kx += (t.e.x - h.x) / d * sk.push; t.e.kz += (t.e.z - h.z) / d * sk.push;
                    }
                }
                break;
            }
            case 'ward':
                for (const o of s.heroes) {
                    if (o.out || hypot(o.x - h.x, o.z - h.z) > R.aoe) continue;
                    o.shield = max(o.shield, R.shield * pow); o.shieldT = R.dur;
                    emit(s, 'buff', o.i, SKILL_INDEX[sk.id]);
                }
                break;
            case 'heal':
                for (const o of s.heroes) {
                    if (o.out || o.down || hypot(o.x - h.x, o.z - h.z) > R.aoe) continue;
                    o.regen.push({ hps: R.heal * pow / R.dur, t: R.dur, o: i });
                    emit(s, 'buff', o.i, SKILL_INDEX[sk.id]);
                }
                break;
            case 'blink': {
                let x = h.x, z = h.z;
                const W = s.dun.world;
                for (let d = 0.5; d <= R.dist; d += 0.5) {
                    const nx = h.x + fx * d, nz = h.z + fz * d;
                    if (groundUnder(s, nx, nz) > h.y + HERO.step || gateAt(s, nx, nz, HERO.radius)) break;
                    if (W.passable[W.navCell(nx, nz)]) { x = nx; z = nz; }
                }
                emit(s, 'blink', i, r1(h.x), r1(h.z), r1(x), r1(z));
                h.x = x; h.z = z; h.safe = max(h.safe, sk.safe);
                for (const t of enemiesNear(s, x, z, R.aoe)) damageEnemy(s, t.e, R.dmg * pow, { o: i, src: sk.id, fx: 0, fz: 0 });
                break;
            }
        }
    }
    function shoot(s, p) {
        p.id = s.nextId++;
        p.y = SHOT_Y;
        p.hit = p.pierce ? [] : null;
        s.proj.push(p);
        return p;
    }
    // everything a hero could hit near a point: minions that are awake, and the boss
    function enemiesNear(s, x, z, r) {
        const out = [];
        for (const m of s.minions) {
            if (m.state !== 1) continue;
            const d = hypot(m.x - x, m.z - z);
            if (d <= r + m.r) out.push({ e: m, d });
        }
        const b = s.boss;
        if (b && s.bossOn && b.hp > 0) {
            const d = hypot(b.x - x, b.z - z);
            if (d <= r + b.r) out.push({ e: b, d });
        }
        return out;
    }
    function angleDiff(a, b) { let d = a - b; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; }

    // ===============================================================
    // hurting things
    // ===============================================================
    function damageEnemy(s, e, amount, src) {
        if (e.boss) return damageBoss(s, amount, src);
        if (e.state !== 1 || amount <= 0) return 0;
        const M = D.MINIONS[e.kind];
        // a firewall's front: shots from in front of it mostly bounce off
        if (M.guard && (src.fx || src.fz)) {
            const from = atan2(-src.fx, src.fz);
            if (abs(angleDiff(from, e.yaw)) < M.arc && e.stunT <= 0) { amount *= 1 - M.guard; emit(s, 'block', e.id); }
        }
        amount = min(amount, e.hp);
        e.hp -= amount;
        e.hitT = 0.2;
        const h = s.heroes[src.o];
        if (h) {
            h.threat += amount;
            if (src.src === 'bolt' && h.pas.leech) h.hp = min(h.maxHp, h.hp + 1.5 * h.pas.leech);
        }
        if (s.stats && src.src) s.stats.dmg[src.src] = (s.stats.dmg[src.src] || 0) + amount;
        emit(s, 'hit', e.id, round(amount), src.o === undefined ? -1 : src.o);
        if (e.hp <= 0.001) killMinion(s, e, src.o);
        return amount;
    }
    function killMinion(s, m, by) {
        m.state = 2;
        m.hp = 0;
        emit(s, 'die', m.id, r1(m.x), r1(m.z), by === undefined ? -1 : by);
        if (s.stats) s.stats.kills++;
        giveXp(s, m.xp);
        checkCleared(s, m.room);
    }
    function damageBoss(s, amount, src) {
        const b = s.boss;
        if (!b || !s.bossOn || b.hp <= 0 || b.safe > 0) return 0;
        amount = min(amount, b.hp);
        b.hp -= amount;
        b.hitT = 0.15;
        const h = s.heroes[src.o];
        if (h) h.threat += amount;
        if (s.stats && src.src) s.stats.dmg[src.src] = (s.stats.dmg[src.src] || 0) + amount;
        emit(s, 'bhit', round(amount), src.o === undefined ? -1 : src.o);
        if (b.hp <= 0) {
            b.hp = 0;
            emit(s, 'bdie');
            if (s.stats) s.stats.bossT = s.t - s.stats.bossAt;
            finish(s, 'win', 'boss');
        }
        return amount;
    }
    function hurtHero(s, h, amount, src) {
        if (h.down || h.out || h.safe > 0 || amount <= 0 || s.over) return 0;
        if (h.stance) amount *= RUN.stance.hurt;
        if (h.shield > 0) {
            const soak = min(h.shield, amount);
            h.shield -= soak; amount -= soak;
            if (s.stats) s.stats.saved.runeward = (s.stats.saved.runeward || 0) + soak;
            if (h.shield <= 0) h.shieldT = 0;
        }
        if (amount <= 0) { emit(s, 'soak', h.i); return 0; }
        h.hp -= amount;
        h.hitT = 0.25;
        emit(s, 'hurt', h.i, round(amount), src || 0);
        if (h.hp <= 0) {
            h.hp = 0;
            h.down = true;
            h.bleed = RUN.down.bleed;
            h.revive = 0;
            h.stance = false;
            h.regen = [];
            if (s.stats) s.stats.downs++;
            emit(s, 'down', h.i);
        }
        return amount;
    }
    // a wall or a decoy taking a hit that would have been somebody's
    function soak(s, thing, amount, id) {
        const took = min(max(0, thing.hp), amount);
        thing.hp -= amount;
        if (s.stats) s.stats.saved[id] = (s.stats.saved[id] || 0) + took;
    }
    function finish(s, how, reason) {
        if (s.over) return;
        s.over = how; s.reason = reason;
        s.phase = 'over';
        emit(s, 'over', how === 'win' ? 1 : 0);
    }

    // ===============================================================
    // rooms, gates, shrines
    // ===============================================================
    function checkCleared(s, room) {
        if (room < 0 || s.cleared[room]) return;
        if (s.minions.some(m => m.room === room && m.state !== 2)) return;
        const rm = s.dun.rooms[room];
        if (rm.kind === 'boss') return;
        s.cleared[room] = 1;
        if (rm.gate >= 0 && rm.kind === 'fight') s.gateOpen[rm.gate] = 1;
        emit(s, 'clear', room);
        // the ones who were out come back, at the door
        for (const h of s.heroes) if (h.out) standUp(s, h, rm.exit ? rm.exit.x : rm.cx, (rm.exit ? rm.exit.z : rm.cz) - 2, 0.5);
        advanceFrontier(s);
    }
    function advanceFrontier(s) {
        while (s.frontier < s.dun.rooms.length - 1 && s.cleared[s.frontier] && s.gateOpen[s.dun.rooms[s.frontier].gate]) s.frontier++;
    }
    function standUp(s, h, x, z, hpFrac) {
        h.out = false; h.down = false; h.bleed = 0; h.revive = 0;
        h.x = x; h.z = z; h.y = groundUnder(s, x, z); h.vy = 0;
        h.hp = max(1, round(h.maxHp * hpFrac));
        h.safe = 1;
        emit(s, 'up', h.i);
    }
    const inRoom = (rm, x, z, pad) => x >= rm.x0 - (pad || 0) && x <= rm.x1 + (pad || 0) && z >= rm.z0 - (pad || 0) && z <= rm.z1 + (pad || 0);
    function stepRooms(s) {
        const dun = s.dun;
        const alive = s.heroes.filter(h => !h.out);
        for (const h of alive) {
            const ri = dun.roomAt(h.x, h.z);
            if (ri < 0 || s.entered[ri]) continue;
            s.entered[ri] = 1;
            const rm = dun.rooms[ri];
            emit(s, 'enter', ri);
            if (rm.kind === 'fight') wakeRoom(s, ri);
            if (rm.kind === 'shrine') s.shrine = { room: ri, t: 0, done: false, healed: false };
            if (rm.kind === 'boss') s.bossWait = 0;
            if (s.stats && rm.kind === 'shrine') s.stats.sections.push(round(s.t));
        }
        // a room that has gone on too long: whatever is hiding in a corner comes out
        if (s.entered[s.frontier] && !s.cleared[s.frontier] && dun.rooms[s.frontier].kind === 'fight') {
            s.frontT = (s.frontT || 0) + DT;
            // and the ones that keep their distance stop doing that
            s.brave = s.frontT > 40;
            if (s.frontT > 50 && s.tick % HZ === 0) {
                const rm = dun.rooms[s.frontier];
                for (const m of s.minions) {
                    if (m.room !== rm.i || m.state !== 1) continue;
                    let near = 1e9;
                    for (const h of alive) near = min(near, hypot(h.x - m.x, h.z - m.z));
                    if (near > 14) { m.x = rm.cx + (rnd(s) - 0.5) * 4; m.z = rm.cz + (rnd(s) - 0.5) * 4; }
                }
            }
        } else { s.frontT = 0; s.brave = false; }
        // a shrine: when everyone is in, heal, bring back the dead, and spend the picks
        const sh = s.shrine;
        if (sh && !sh.done) {
            sh.t += DT;
            const rm = dun.rooms[sh.room];
            const inside = s.heroes.filter(h => !h.out && !h.down && inRoom(rm, h.x, h.z));
            const everyone = s.heroes.filter(h => !h.out && !h.down);
            if (!sh.healed && (inside.length === everyone.length || sh.t > RUN.shrine.straggle)) {
                sh.healed = true;
                s.lastShrine = sh.room;
                for (const h of s.heroes) {
                    if (h.out || h.down || !inRoom(rm, h.x, h.z)) standUp(s, h, rm.cx + (h.i - 1.5) * 1.5, rm.cz, 1);
                    h.hp = h.maxHp; h.regen = [];
                }
                emit(s, 'shrine', sh.room);
            }
            if (sh.healed) {
                const waiting = s.heroes.some(h => h.picks > 0);
                if (sh.t > RUN.shrine.wait + RUN.shrine.straggle) for (const h of s.heroes) while (h.picks > 0 && h.offer) applyCard(s, h, h.offer[0]);
                if (!waiting || sh.t > RUN.shrine.wait + RUN.shrine.straggle) {
                    sh.done = true;
                    s.cleared[sh.room] = 1;
                    if (rm.gate >= 0) s.gateOpen[rm.gate] = 1;
                    emit(s, 'onward', sh.room);
                    advanceFrontier(s);
                }
            }
        }
        // chests: the room has to be clear, and then everybody gets a card
        dun.chests.forEach((c, k) => {
            if (s.chestOpen[k] || !s.cleared[c.room]) return;
            for (const h of alive) {
                if (h.down || hypot(h.x - c.x, h.z - c.z) > 1.6) continue;
                s.chestOpen[k] = 1;
                for (const o of s.heroes) { o.picks++; if (!o.offer) rollOffer(s, o); }
                emit(s, 'chest', k, h.i);
                break;
            }
        });
        // the boss: the door shuts once you are all in
        const brm = dun.rooms[dun.boss];
        if (s.entered[dun.boss] && !s.bossOn && !s.over) {
            s.bossWait = (s.bossWait || 0) + DT;
            const all = s.heroes.filter(h => !h.out && !h.down);
            const inside = all.filter(h => inRoom(brm, h.x, h.z) && h.z > brm.z0 + 1);
            if ((inside.length === all.length && s.bossWait > 1) || s.bossWait > 12) {
                for (const h of s.heroes) if (!inRoom(brm, h.x, h.z) || h.z <= brm.z0 + 1) standUp(s, h, brm.cx + (h.i - 1.5) * 1.5, brm.z0 + 3, h.out || h.down ? 0.5 : h.hp / h.maxHp);
                s.gateOpen[brm.door] = 0;
                startBoss(s);
            }
        }
    }
    function wakeRoom(s, ri) {
        let n = 0;
        for (const m of s.minions) if (m.room === ri && m.state === 0) { m.state = 1; m.think = rnd(s) * 0.5; m.cd = 0.4 + rnd(s) * 0.8; n++; }
        emit(s, 'wake', ri, n);
        if (!n) checkCleared(s, ri);
    }

    // ===============================================================
    // walking about
    // ===============================================================
    const W_ = s => s.dun.world;
    function groundUnder(s, x, z) {
        const r = HERO.radius * 0.7, at = W_(s).at;
        return max(at(x, z), at(x + r, z), at(x - r, z), at(x, z + r), at(x, z - r));
    }
    function gateAt(s, x, z, r) {
        const g = s.dun.gates;
        for (let k = 0; k < g.length; k++) {
            if (s.gateOpen[k]) continue;
            const q = g[k];
            if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) return true;
        }
        return false;
    }
    function inWall(w, x, z, r) {
        const dx = x - w.x, dz = z - w.z;
        // the wall runs across the aim it was cast along
        const u = dx * w.ca + dz * w.sa, v = -dx * w.sa + dz * w.ca;
        return abs(u) < w.hw + r && abs(v) < w.hd + r;
    }
    function wallAt(s, x, z, r) {
        for (const w of s.walls) if (inWall(w, x, z, r)) return w;
        return null;
    }
    function blocked(s, y, x, z, r) {
        if (groundUnder(s, x, z) > y + HERO.step) return true;
        if (gateAt(s, x, z, r)) return true;
        return false;
    }
    function moveHero(s, h, inp) {
        const free = canAct(h);
        let speed = h.down ? 1.1 : h.stance ? HERO.stanceWalk : HERO.walk;
        speed *= 1 + 0.1 * (h.pas.turbo || 0);
        if (h.slowT > 0) speed *= 1 - h.slow;
        h.yaw = inp.yaw; h.pitch = inp.pitch;
        const fx = sin(h.yaw), fz = -cos(h.yaw), rx = cos(h.yaw), rz = sin(h.yaw);
        let mx = (free || h.down) ? inp.mx : 0, mz = (free || h.down) ? inp.mz : 0;
        const m = hypot(mx, mz);
        if (m > 1) { mx /= m; mz /= m; }
        let vx = (rx * mx + fx * mz) * speed, vz = (rz * mx + fz * mz) * speed;
        h.mvx = vx; h.mvz = vz;
        if (inp.dash && free && h.dashCd <= 0 && !h.stance) {
            let dx = rx * mx + fx * mz, dz = rz * mx + fz * mz;
            const l = hypot(dx, dz);
            if (l < 0.1) { dx = fx; dz = fz; } else { dx /= l; dz /= l; }
            h.dashX = dx; h.dashZ = dz; h.dashT = HERO.dash.time; h.dashCd = HERO.dash.cd * (1 - 0.15 * (h.pas.turbo || 0));
            emit(s, 'dash', h.i);
        }
        if (h.dashT > 0) { h.dashT -= DT; vx = h.dashX * HERO.dash.speed; vz = h.dashZ * HERO.dash.speed; }
        vx += h.kx; vz += h.kz;
        const fade = Math.pow(0.02, DT);
        h.kx *= fade; h.kz *= fade;
        if (abs(h.kx) < 0.05) h.kx = 0;
        if (abs(h.kz) < 0.05) h.kz = 0;
        const nx = h.x + vx * DT, nz = h.z + vz * DT;
        if (!blocked(s, h.y, nx, h.z, HERO.radius)) h.x = nx;
        if (!blocked(s, h.y, h.x, nz, HERO.radius)) h.z = nz;
        if (inp.jump && h.grounded && free && !h.stance) { h.vy = HERO.jump; h.grounded = false; }
        h.vy -= HERO.gravity * DT;
        h.y += h.vy * DT;
        const ground = groundUnder(s, h.x, h.z);
        if (h.y <= ground) { h.y = ground; h.vy = 0; h.grounded = true; }
        else if (h.y - ground > 0.12) h.grounded = false;
    }
    function stepHero(s, i) {
        const h = s.heroes[i], inp = s.input[i];
        if (h.out) { h.mvx = h.mvz = 0; return; }
        h.fireCd = max(0, h.fireCd - DT);
        h.dashCd = max(0, h.dashCd - DT);
        h.safe = max(0, h.safe - DT);
        h.hitT = max(0, h.hitT - DT);
        h.castT = max(0, h.castT - DT);
        h.stunT = max(0, h.stunT - DT);
        h.threat *= Math.pow(0.7, DT);
        if (h.slowT > 0) { h.slowT -= DT; if (h.slowT <= 0) h.slow = 0; }
        if (h.shieldT > 0) { h.shieldT -= DT; if (h.shieldT <= 0) h.shield = 0; }
        for (const k of h.skills) if (k.cd > 0) k.cd = max(0, k.cd - DT);
        if (s.stats && !h.down) { for (const k of h.skills) s.stats.own[k.id] = (s.stats.own[k.id] || 0) + DT; for (const p in h.pas) s.stats.own['pas:' + p] = (s.stats.own['pas:' + p] || 0) + DT * h.pas[p]; }
        if (h.regen.length) {
            for (const r of h.regen) { const was = h.hp; h.hp = min(h.maxHp, h.hp + r.hps * DT); r.t -= DT; if (s.stats) s.stats.saved.regrowth = (s.stats.saved.regrowth || 0) + h.hp - was; }
            h.regen = h.regen.filter(r => r.t > 0);
        }
        h.stance = !!inp.ink && canAct(h);
        if (h.down) {
            h.bleed -= DT;
            if (h.bleed <= 0) {
                h.down = false; h.out = true; h.hp = 0;
                if (s.stats) s.stats.deaths++;
                emit(s, 'out', h.i);
                return;
            }
        }
        moveHero(s, h, inp);
        // the staff
        h.firing = !!inp.fire && canAct(h) && !h.stance && s.phase === 'live';
        if (h.firing && h.fireCd <= 0) {
            h.fireCd = HERO.bolt.rof;
            const B = HERO.bolt, fx = sin(h.yaw), fz = -cos(h.yaw);
            const dmg = (B.dmg + B.perLevel * (h.level - 1)) * dmgOf(h) / (1 + HERO.dmgPerLevel * (h.level - 1)) * (1 + 0.3 * (h.pas.fatstaff || 0));
            shoot(s, { side: 0, o: i, kind: 'bolt', x: h.x + fx * 0.5, z: h.z + fz * 0.5, vx: fx * B.speed, vz: fz * B.speed, r: B.r, dmg, life: B.range / B.speed, src: 'bolt' });
        }
        // standing over somebody who is down brings them back
        if (!h.down) {
            for (const o of s.heroes) {
                if (o === h || !o.down) continue;
                if (hypot(o.x - h.x, o.z - h.z) > RUN.down.reach) continue;
                o.revive += DT / RUN.down.revive * (1 + 0.4 * (h.pas.firstaid || 0));
                if (o.revive >= 1) {
                    standUp(s, o, o.x, o.z, RUN.down.reviveHp + 0.15 * (h.pas.firstaid || 0));
                    if (s.stats) s.stats.revives++;
                    emit(s, 'revived', o.i, i);
                }
            }
        }
    }

    // ===============================================================
    // the minions
    // ===============================================================
    // a flow field towards each hero, out to 40 cells, refreshed when they move
    function heroField(s, i) {
        const f = s.fields || (s.fields = []);
        const h = s.heroes[i], W = W_(s);
        const cell = W.nearestPassable(W.navCell(h.x, h.z));
        let e = f[i];
        if (!e) e = f[i] = { field: W.field(), cell: -1, at: -1 };
        if (e.cell !== cell && s.t - e.at > 0.3) { W.fill(e.field, cell, 40); e.cell = cell; e.at = s.t; }
        return e.field;
    }
    function minionTarget(s, m) {
        // a decoy close by is the more interesting thing
        let best = null, bd = 1e9;
        for (const d of s.decoys) {
            const dd = hypot(d.x - m.x, d.z - m.z);
            if (dd < d.taunt && dd < bd) { bd = dd; best = { decoy: d }; }
        }
        if (best) return best;
        for (const h of s.heroes) {
            if (h.down || h.out) continue;
            const dd = hypot(h.x - m.x, h.z - m.z) - (h.threat > 60 ? 2 : 0);
            if (dd < bd) { bd = dd; best = { hero: h }; }
        }
        return best;
    }
    function moveMinion(s, m, tx, tz, speed) {
        const W = W_(s);
        let gx = tx, gz = tz;
        const d = hypot(tx - m.x, tz - m.z);
        if (d > 1 && !(d < 12 && W.clearLine(m.x, 0.4, m.z, tx, 0.4, tz, 0.5))) {
            const step = W.nextStep(m.x, m.z, tx, tz, m.field || undefined);
            gx = step.x; gz = step.z;
        }
        let dx = gx - m.x, dz = gz - m.z;
        const l = hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        if (l > 0.1) m.yaw = atan2(dx, -dz);
        m.vx = dx * speed; m.vz = dz * speed;
    }
    function stepMinions(s) {
        const W = W_(s);
        const mins = s.minions;
        for (const m of mins) {
            if (m.state !== 1) continue;
            const M = D.MINIONS[m.kind];
            m.hitT = max(0, m.hitT - DT);
            m.cd = max(0, m.cd - DT);
            if (m.slowT > 0) { m.slowT -= DT; if (m.slowT <= 0) m.slow = 0; }
            let speed = M.speed * (1 - m.slow);
            m.vx = 0; m.vz = 0;
            if (m.stunT > 0) { m.stunT -= DT; m.act = 0; }
            else {
                m.think -= DT;
                if (m.think <= 0 || !m.tgt || (m.tgt.hero && (m.tgt.hero.down || m.tgt.hero.out)) || (m.tgt.decoy && m.tgt.decoy.hp <= 0)) {
                    m.tgt = minionTarget(s, m);
                    m.think = 0.5;
                }
                const T = m.tgt;
                const tx = T ? (T.hero || T.decoy).x : m.x, tz = T ? (T.hero || T.decoy).z : m.z;
                m.field = T && T.hero ? heroField(s, T.hero.i) : null;
                const d = hypot(tx - m.x, tz - m.z);
                if (m.act === 1) {
                    // winding up: it stands there, which is the moment to get out of the way
                    m.actT -= DT;
                    if (m.actT <= 0) { m.act = 0; resolveMinion(s, m, T, d); }
                } else if (m.act === 2) {
                    m.actT -= DT;
                    if (m.actT <= 0) { m.act = 0; resolveMinion(s, m, T, d); }
                } else if (T) {
                    if (M.melee) {
                        if (d <= M.melee.reach + m.r && m.cd <= 0) { m.act = 1; m.actT = M.melee.windup; m.yaw = atan2(tx - m.x, -(tz - m.z)); }
                        else if (d > M.melee.reach * 0.7 + m.r) moveMinion(s, m, tx, tz, speed);
                    } else if (M.slam) {
                        if (d <= M.slam.reach + m.r && m.cd <= 0) {
                            m.act = 1; m.actT = M.slam.windup;
                            m.yaw = atan2(tx - m.x, -(tz - m.z));
                            const cx = m.x + sin(m.yaw) * 1.4, cz = m.z - cos(m.yaw) * 1.4;
                            s.tel.push({ id: s.nextId++, k: 'slam', x: cx, z: cz, r: M.slam.aoe, t: 0, total: M.slam.windup, dmg: 0, side: 1, o: m.id, src: 1 });
                            m.slamAt = { x: cx, z: cz };
                        } else moveMinion(s, m, tx, tz, speed);
                    } else if (M.fuse) {
                        if (d <= M.fuse.reach + m.r) {
                            m.act = 2; m.actT = M.fuse.windup;
                            s.tel.push({ id: s.nextId++, k: 'fuse', x: m.x, z: m.z, r: M.fuse.aoe, t: 0, total: M.fuse.windup, dmg: 0, side: 1, o: m.id, src: 2 });
                        } else moveMinion(s, m, tx, tz, speed);
                    } else if (M.ranged) {
                        const R = M.ranged;
                        const see = d < R.range && W.clearLine(m.x, SHOT_Y, m.z, tx, SHOT_Y, tz);
                        if (see && m.cd <= 0) { m.act = 1; m.actT = R.windup; m.yaw = atan2(tx - m.x, -(tz - m.z)); }
                        else if (!see || d > R.range * 0.9) moveMinion(s, m, tx, tz, speed);
                        else if (d < R.keep && !s.brave) moveMinion(s, m, m.x - (tx - m.x), m.z - (tz - m.z), speed * 0.8);
                        else m.yaw = atan2(tx - m.x, -(tz - m.z));
                    } else if (M.heal) {
                        // stay back, and mend whoever is worst
                        if (m.cd <= 0) {
                            let worst = null, wf = 0.95;
                            for (const o of mins) {
                                // scandisk cannot fix scandisk, or two of them would never die
                                if (o.state !== 1 || o === m || o.kind === 'healer' || o.hp / o.maxHp >= wf) continue;
                                if (hypot(o.x - m.x, o.z - m.z) > M.heal.range) continue;
                                wf = o.hp / o.maxHp; worst = o;
                            }
                            if (worst) {
                                worst.hp = min(worst.maxHp, worst.hp + M.heal.amount * s.dun.def.hpMul * (m.elite ? 1.6 : 1));
                                m.cd = M.heal.cd;
                                emit(s, 'mend', m.id, worst.id);
                            }
                        }
                        if (d < M.keep && !s.brave) moveMinion(s, m, m.x - (tx - m.x), m.z - (tz - m.z), speed);
                        else if (d > M.keep + 5) moveMinion(s, m, tx, tz, speed);
                    }
                }
            }
            // being shoved, and the ice
            m.vx += m.kx; m.vz += m.kz;
            const fade = Math.pow(0.03, DT);
            m.kx *= fade; m.kz *= fade;
            if (abs(m.kx) < 0.05) m.kx = 0;
            if (abs(m.kz) < 0.05) m.kz = 0;
            const nx = m.x + m.vx * DT, nz = m.z + m.vz * DT;
            const ok = (x, z) => W.at(x, z) < 0.3 && !gateAt(s, x, z, m.r * 0.6) && !wallAt(s, x, z, m.r);
            if (ok(nx, m.z)) m.x = nx;
            if (ok(m.x, nz)) m.z = nz;
            // an ice wall in the way gets hit instead
            const w = wallAt(s, m.x + m.vx * 0.3, m.z + m.vz * 0.3, m.r + 0.2);
            if (w) {
                if (w.chill) { m.slow = max(m.slow, w.chill); m.slowT = max(m.slowT, 1); }
                if (m.cd <= 0 && (M.melee || M.slam)) { soak(s, w, ((M.melee || M.slam).dmg) * m.dmgMul, 'icewall'); m.cd = (M.melee || M.slam).cd || 1.5; }
            }
        }
        // keep out of each other, and out of the heroes
        for (let a = 0; a < mins.length; a++) {
            const m = mins[a];
            if (m.state !== 1) continue;
            for (let b = a + 1; b < mins.length; b++) {
                const o = mins[b];
                if (o.state !== 1) continue;
                const dx = o.x - m.x, dz = o.z - m.z, rr = m.r + o.r;
                if (abs(dx) > rr || abs(dz) > rr) continue;
                const d = hypot(dx, dz);
                if (d >= rr || d < 1e-4) continue;
                const push = (rr - d) * 0.5 / d;
                const ax = m.x - dx * push, az = m.z - dz * push, bx = o.x + dx * push, bz = o.z + dz * push;
                if (W.at(ax, az) < 0.3) { m.x = ax; m.z = az; }
                if (W.at(bx, bz) < 0.3) { o.x = bx; o.z = bz; }
            }
            for (const h of s.heroes) {
                if (h.out) continue;
                const dx = m.x - h.x, dz = m.z - h.z, rr = m.r + HERO.radius;
                const d = hypot(dx, dz);
                if (d >= rr || d < 1e-4) continue;
                const nx = h.x + dx / d * rr, nz = h.z + dz / d * rr;
                if (W.at(nx, nz) < 0.3) { m.x = nx; m.z = nz; }
            }
        }
    }
    function resolveMinion(s, m, T, d) {
        const M = D.MINIONS[m.kind];
        if (M.melee) {
            m.cd = M.melee.cd;
            if (T && d <= M.melee.reach + m.r + 0.5) {
                if (T.hero) hurtHero(s, T.hero, M.melee.dmg * m.dmgMul, 1);
                else if (T.decoy) soak(s, T.decoy, M.melee.dmg * m.dmgMul, 'nightfall');
                emit(s, 'bite', m.id);
            }
        } else if (M.slam) {
            m.cd = M.slam.cd;
            const c = m.slamAt || { x: m.x, z: m.z };
            emit(s, 'slam', m.id, r1(c.x), r1(c.z), M.slam.aoe);
            for (const h of s.heroes) if (hypot(h.x - c.x, h.z - c.z) < M.slam.aoe + HERO.radius * 0.5) hurtHero(s, h, M.slam.dmg * m.dmgMul, 2);
            for (const dc of s.decoys) if (hypot(dc.x - c.x, dc.z - c.z) < M.slam.aoe) soak(s, dc, M.slam.dmg * m.dmgMul, 'nightfall');
        } else if (M.fuse) {
            emit(s, 'boom', r1(m.x), r1(m.z), M.fuse.aoe, 0);
            for (const h of s.heroes) if (hypot(h.x - m.x, h.z - m.z) < M.fuse.aoe + HERO.radius * 0.5) hurtHero(s, h, M.fuse.dmg * m.dmgMul, 3);
            for (const dc of s.decoys) if (hypot(dc.x - m.x, dc.z - m.z) < M.fuse.aoe) soak(s, dc, M.fuse.dmg * m.dmgMul, 'nightfall');
            // it goes with it, and counts as a kill: nobody should lose xp to a bomb
            killMinion(s, m, -1);
        } else if (M.ranged && T) {
            const R = M.ranged, tgt = T.hero || T.decoy;
            m.cd = R.cd;
            const a = atan2(tgt.x - m.x, -(tgt.z - m.z));
            shoot(s, { side: 1, o: -1, kind: 'orb', x: m.x + sin(a) * 0.6, z: m.z - cos(a) * 0.6, vx: sin(a) * R.speed, vz: -cos(a) * R.speed, r: 0.35, dmg: R.dmg * m.dmgMul, life: R.range * 1.4 / R.speed });
        }
    }

    // ===============================================================
    // the boss
    // ===============================================================
    function startBoss(s) {
        const dun = s.dun, rm = dun.rooms[dun.boss], B = D.BOSSES[dun.def.boss];
        s.boss = {
            boss: true, kind: dun.def.boss, x: rm.cx, z: rm.cz + 6, y: 0, yaw: 0, r: B.r,
            hp: B.hp, maxHp: B.hp, phase: 0, gap: 2.5, atk: null, atkT: 0, n: 0, safe: 0, hitT: 0, target: 0, stunT: 0, slow: 0, slowT: 0, spiral: null
        };
        s.bossOn = true;
        if (s.stats) { s.stats.bossAt = s.t; s.stats.levelAtBoss = s.heroes.reduce((a, h) => a + h.level, 0) / s.heroes.length; }
        emit(s, 'boss', 0);
    }
    function bossTarget(s) {
        const b = s.boss;
        let best = null, score = -1e9;
        for (const h of s.heroes) {
            if (h.down || h.out) continue;
            const sc = h.threat - hypot(h.x - b.x, h.z - b.z) * 2 + rnd(s) * 20;
            if (sc > score) { score = sc; best = h; }
        }
        return best;
    }
    function stepBoss(s) {
        const b = s.boss;
        if (!b || !s.bossOn || b.hp <= 0) return;
        const B = D.BOSSES[b.kind], dun = s.dun, rm = dun.rooms[dun.boss];
        b.safe = max(0, b.safe - DT);
        b.hitT = max(0, b.hitT - DT);
        const frac = b.hp / b.maxHp;
        // a new phase: a moment of not being hit, and a few words
        if (b.phase < B.phases.length - 1 && frac <= B.phases[b.phase + 1].at) {
            b.phase++;
            b.safe = 1.5;
            b.atk = null; b.gap = 1.6;
            emit(s, 'phase', b.phase);
        }
        const P = B.phases[b.phase];
        const speedUp = P.enrage || 1;
        const t = bossTarget(s);
        // a decoy draws it too
        let tx = t ? t.x : rm.cx, tz = t ? t.z : rm.cz;
        for (const d of s.decoys) if (hypot(d.x - b.x, d.z - b.z) < d.taunt + 6) { tx = d.x; tz = d.z; break; }
        const want = atan2(tx - b.x, -(tz - b.z));
        b.yaw += clamp(angleDiff(want, b.yaw), -2 * DT, 2 * DT);
        const d = hypot(tx - b.x, tz - b.z);
        if (!b.atk && d > 7) {
            const nx = b.x + sin(b.yaw) * B.speed * DT, nz = b.z - cos(b.yaw) * B.speed * DT;
            if (inRoom(rm, nx, nz, -3)) { b.x = nx; b.z = nz; }
        }
        // spirals keep going while it does other things
        if (b.spiral) {
            const sp = b.spiral;
            sp.t -= DT; sp.next -= DT;
            if (sp.next <= 0) {
                sp.next = sp.a.rate;
                sp.ang += sp.a.spin * sp.a.rate;
                for (let k = 0; k < sp.a.n; k++) {
                    const a = sp.ang + k * 2 * PI / sp.a.n;
                    shoot(s, { side: 1, o: -1, kind: 'bossorb', x: b.x + sin(a) * b.r, z: b.z - cos(a) * b.r, vx: sin(a) * sp.a.speed, vz: -cos(a) * sp.a.speed, r: 0.45, dmg: sp.a.dmg * s.dun.def.dmgMul * (s.dun.def.bossDmg || 1), life: 3.2 });
                }
            }
            if (sp.t <= 0) b.spiral = null;
        }
        if (b.atk) {
            b.atkT -= DT;
            if (b.atkT <= 0) b.atk = null;
            return;
        }
        b.gap -= DT * (1 / speedUp);
        if (b.gap > 0) return;
        // the next attack: round the phase's list, starting somewhere random
        const list = P.attacks;
        const name = list[(b.n + floor(rnd(s) * 2)) % list.length];
        b.n++;
        b.gap = B.gap;
        bossAttack(s, b, name, P, t, speedUp);
    }
    const ATTACK_NAMES = Object.keys(D.ATTACKS).concat(['summon']);
    function bossAttack(s, b, name, P, t, speedUp) {
        const dm = s.dun.def.dmgMul * (s.dun.def.bossDmg || 1);
        emit(s, 'battack', ATTACK_NAMES.indexOf(name));
        if (name === 'summon') {
            const S = P.summon || { kinds: ['gremlin'], n: 4 };
            const rm = s.dun.rooms[s.dun.boss];
            for (let k = 0; k < S.n; k++) {
                const kind = S.kinds[k % S.kinds.length];
                const a = rnd(s) * 2 * PI;
                const x = clamp(rm.cx + sin(a) * 13, rm.x0 + 2, rm.x1 - 2), z = clamp(rm.cz + cos(a) * 13, rm.z0 + 3, rm.z1 - 2);
                const m = newMinion(s, s.nextDyn++, kind, x, z, s.dun.boss, false, 2);
                m.state = 1; m.cd = 1;
                addMinion(s, m);
            }
            emit(s, 'summon', S.n);
            b.atk = 'summon'; b.atkT = 0.8;
            return;
        }
        const A = D.ATTACKS[name];
        if (!A) return;
        const windup = (A.windup || 0) * speedUp;
        const tgt = t || s.heroes.find(h => !h.down && !h.out) || { x: b.x, z: b.z + 5 };
        switch (A.kind) {
            case 'slam':
                s.tel.push({ id: s.nextId++, k: 'slam', x: b.x, z: b.z, r: A.r, t: 0, total: windup, dmg: A.dmg * dm, side: 1, o: -1, src: 4 });
                b.atk = name; b.atkT = windup;
                break;
            case 'rain':
                for (const h of s.heroes) {
                    if (h.down || h.out) continue;
                    for (let k = 0; k < A.n; k++) {
                        // the second one lands where you were going
                        const lead = k ? 1.2 : 0;
                        s.tel.push({ id: s.nextId++, k: 'rain', x: h.x + h.mvx * lead, z: h.z + h.mvz * lead, r: A.r, t: -k * 0.35, total: windup, dmg: A.dmg * dm, side: 1, o: -1, src: 5 });
                    }
                }
                b.atk = name; b.atkT = 0.5;
                break;
            case 'lane': {
                const n = A.n || 1;
                const base = atan2(tgt.x - b.x, -(tgt.z - b.z));
                b.yaw = base;
                for (let k = 0; k < n; k++) {
                    const a = base + (k - (n - 1) / 2) * (A.spread || 0);
                    s.tel.push({ id: s.nextId++, k: 'lane', x: b.x, z: b.z, x2: b.x + sin(a) * A.len, z2: b.z - cos(a) * A.len, r: A.w / 2, t: 0, total: windup, dmg: A.dmg * dm, side: 1, o: -1, src: 6 });
                }
                b.atk = name; b.atkT = windup;
                break;
            }
            case 'ring': {
                const n = A.n || 1;
                for (let k = 0; k < n; k++) s.tel.push({ id: s.nextId++, k: 'ring', x: b.x, z: b.z, r: 0.5, t: -k * (A.gap || 0.8), total: A.max / A.speed, speed: A.speed, max: A.max, dmg: A.dmg * dm, side: 1, o: -1, src: 7, hit: [] });
                b.atk = name; b.atkT = 0.6;
                break;
            }
            case 'volley': {
                const base = atan2(tgt.x - b.x, -(tgt.z - b.z));
                for (let k = 0; k < A.n; k++) {
                    const a = base + (k - (A.n - 1) / 2) * (A.spread / max(1, A.n - 1));
                    shoot(s, { side: 1, o: -1, kind: 'bossorb', x: b.x + sin(a) * b.r, z: b.z - cos(a) * b.r, vx: sin(a) * A.speed, vz: -cos(a) * A.speed, r: 0.45, dmg: A.dmg * dm, life: 3 });
                }
                b.atk = name; b.atkT = 0.5;
                break;
            }
            case 'spiral':
                b.spiral = { a: A, t: A.dur, next: 0, ang: rnd(s) * 6.28 };
                b.atk = name; b.atkT = 0.4;
                break;
        }
    }

    // ===============================================================
    // things that fly, things on the floor
    // ===============================================================
    function stepProjectiles(s) {
        const W = W_(s);
        const keep = [];
        for (const p of s.proj) {
            p.life -= DT;
            if (p.home !== undefined && p.home !== null) {
                const t = p.homeBoss ? s.boss : s.byId.get(p.home);
                if (t && (t.boss ? t.hp > 0 : t.state === 1)) {
                    const want = atan2(t.x - p.x, -(t.z - p.z)), have = atan2(p.vx, -p.vz);
                    const a = have + clamp(angleDiff(want, have), -p.turn * DT, p.turn * DT);
                    const sp = hypot(p.vx, p.vz);
                    p.vx = sin(a) * sp; p.vz = -cos(a) * sp;
                }
            }
            p.x += p.vx * DT; p.z += p.vz * DT;
            let dead = p.life <= 0;
            if (!dead && W.at(p.x, p.z) > p.y) { dead = true; if (p.aoe) explode(s, p); else emit(s, 'spark', r1(p.x), r1(p.z), p.side); }
            if (!dead && p.side === 0) {
                for (const t of enemiesNear(s, p.x, p.z, p.r)) {
                    if (p.hit && p.hit.includes(t.e)) continue;
                    if (p.aoe) { explode(s, p); dead = true; break; }
                    const sl = p.slow;
                    damageEnemy(s, t.e, p.dmg, { o: p.o, src: p.src, fx: p.vx, fz: p.vz });
                    if (sl && !t.e.boss) { t.e.slow = max(t.e.slow, sl); t.e.slowT = max(t.e.slowT, p.slowT); }
                    if (p.hit && p.hit.length < p.pierce) { p.hit.push(t.e); continue; }
                    dead = true;
                    break;
                }
            } else if (!dead) {
                for (const h of s.heroes) {
                    if (h.down || h.out) continue;
                    if (abs(h.x - p.x) > p.r + HERO.radius || abs(h.z - p.z) > p.r + HERO.radius) continue;
                    if (hypot(h.x - p.x, h.z - p.z) < p.r + HERO.radius && h.y < p.y + 0.4) { hurtHero(s, h, p.dmg, 8); dead = true; break; }
                }
                if (!dead) {
                    const w = wallAt(s, p.x, p.z, p.r);
                    if (w) { soak(s, w, p.dmg, 'icewall'); dead = true; }
                }
                if (!dead) for (const dc of s.decoys) if (hypot(dc.x - p.x, dc.z - p.z) < p.r + 0.5) { soak(s, dc, p.dmg, 'nightfall'); dead = true; break; }
            }
            if (!dead) keep.push(p);
        }
        s.proj = keep;
    }
    function explode(s, p) {
        emit(s, 'boom', r1(p.x), r1(p.z), p.aoe, 1);
        for (const t of enemiesNear(s, p.x, p.z, p.aoe)) damageEnemy(s, t.e, p.dmg, { o: p.o, src: p.src, fx: 0, fz: 0 });
    }
    function distToSeg(px, pz, ax, az, bx, bz) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
        return hypot(px - (ax + dx * u), pz - (az + dz * u));
    }
    function stepTelegraphs(s) {
        const keep = [];
        for (const t of s.tel) {
            t.t += DT;
            if (t.t < 0) { keep.push(t); continue; }
            if (t.k === 'ring') {
                t.r = 0.5 + t.speed * t.t;
                for (const h of s.heroes) {
                    if (h.down || h.out || t.hit.includes(h.i)) continue;
                    const d = hypot(h.x - t.x, h.z - t.z);
                    // a jump clears it
                    if (abs(d - t.r) < 0.7 && h.y < 0.5) { t.hit.push(h.i); hurtHero(s, h, t.dmg, 7); }
                }
                if (t.r < t.max) keep.push(t);
                continue;
            }
            // a minion's that has died or been stunned does not go off
            if (t.side === 1 && t.o >= 0) {
                const m = s.byId.get(t.o);
                if (!m || m.state !== 1 || (m.stunT > 0 && t.k !== 'fuse')) continue;
            }
            if (t.t < t.total) { keep.push(t); continue; }
            if (t.dmg <= 0) continue;
            if (t.side === 0) {
                emit(s, 'boom', r1(t.x), r1(t.z), t.r, 2);
                for (const e of enemiesNear(s, t.x, t.z, t.r)) damageEnemy(s, e.e, t.dmg, { o: t.o, src: t.src, fx: 0, fz: 0 });
            } else {
                emit(s, 'boom', r1(t.x), r1(t.z), t.r, 3);
                for (const h of s.heroes) {
                    const d = t.k === 'lane' ? distToSeg(h.x, h.z, t.x, t.z, t.x2, t.z2) : hypot(h.x - t.x, h.z - t.z);
                    if (d < t.r + HERO.radius * 0.5) hurtHero(s, h, t.dmg, t.src);
                }
            }
        }
        s.tel = keep;
    }
    function stepThings(s) {
        for (const z of s.zones) {
            z.life -= DT;
            for (const t of enemiesNear(s, z.x, z.z, z.r)) {
                damageEnemy(s, t.e, z.dps * DT, { o: z.o, src: z.k, fx: 0, fz: 0 });
                if (!t.e.boss && z.slow) { t.e.slow = max(t.e.slow, z.slow); t.e.slowT = max(t.e.slowT, 0.3); }
            }
        }
        s.zones = s.zones.filter(z => z.life > 0);
        for (const w of s.walls) w.life -= DT;
        s.walls = s.walls.filter(w => w.life > 0 && w.hp > 0);
        for (const d of s.decoys) {
            d.life -= DT;
            if (d.life <= 0 || d.hp <= 0) {
                emit(s, 'boom', r1(d.x), r1(d.z), d.aoe, 4);
                for (const t of enemiesNear(s, d.x, d.z, d.aoe)) damageEnemy(s, t.e, d.boom, { o: d.o, src: 'nightfall', fx: 0, fz: 0 });
            }
        }
        s.decoys = s.decoys.filter(d => d.life > 0 && d.hp > 0);
    }

    // ===============================================================
    // a wipe: back to the last shrine, the rooms after it as they were
    // ===============================================================
    function stepWipe(s) {
        const standing = s.heroes.some(h => !h.down && !h.out);
        if (standing) { s.wipeT = 0; return; }
        s.wipeT += DT;
        if (s.wipeT < RUN.wipeDelay) return;
        s.wipeT = 0;
        s.continues--;
        if (s.stats) s.stats.wipes++;
        if (s.continues < 0) { s.continues = 0; finish(s, 'lose', 'wipe'); return; }
        s.attempt++;
        const dun = s.dun, from = s.lastShrine;
        // the rooms after the shrine go back to how they were, with fresh minions
        s.minions = s.minions.filter(m => m.room <= from && m.id < 100000);
        s.byId = new Map(s.minions.map(m => [m.id, m]));
        for (let r = from + 1; r < dun.rooms.length; r++) {
            s.entered[r] = 0; s.cleared[r] = 0;
            spawnRoom(s, dun.rooms[r], s.attempt).forEach(m => addMinion(s, m));
            const g = dun.rooms[r].gate;
            if (g >= 0) s.gateOpen[g] = 0;
        }
        const brm = dun.rooms[dun.boss];
        if (brm.door >= 0) s.gateOpen[brm.door] = 1;
        s.boss = null; s.bossOn = false; s.bossWait = 0;
        s.proj = []; s.tel = []; s.zones = []; s.walls = []; s.decoys = [];
        s.frontier = from;
        const rm = dun.rooms[from];
        if (rm.gate >= 0) s.gateOpen[rm.gate] = 1;
        advanceFrontier(s);
        for (const h of s.heroes) { standUp(s, h, rm.cx + (h.i - 1.5) * 1.5, rm.cz, 1); h.shield = 0; h.regen = []; h.slowT = 0; h.stunT = 0; for (const k of h.skills) k.cd = 0; }
        emit(s, 'wipe', s.attempt, s.continues);
    }

    // ===============================================================
    // the tick
    // ===============================================================
    function step(s) {
        s.tick++;
        s.t += DT;
        if (s.phase === 'countdown') {
            s.phaseT -= DT;
            if (s.phaseT <= 0) { s.phase = 'live'; emit(s, 'go'); }
            // you can still walk about and pick your first skill
            for (let i = 0; i < s.heroes.length; i++) moveHero(s, s.heroes[i], s.input[i]);
            return;
        }
        if (s.phase !== 'live') return;
        for (let i = 0; i < s.heroes.length; i++) stepHero(s, i);
        stepRooms(s);
        stepMinions(s);
        stepBoss(s);
        stepProjectiles(s);
        stepTelegraphs(s);
        stepThings(s);
        if (s.over) return;
        // the dead are tidied away now and then, but never the ones a guest may still be drawing
        if (s.tick % (HZ * 10) === 0) {
            s.minions = s.minions.filter(m => !(m.state === 2 && m.id >= 100000));
            s.byId = new Map(s.minions.map(m => [m.id, m]));
        }
        stepWipe(s);
    }

    // ===============================================================
    // the wire
    //
    // The dungeon and every minion asleep in it are built from the seed on every screen,
    // so a snapshot says only what is moving: the four heroes every time, what they carry
    // only when it changes, the awake minions, the enemy bolts and the red bits on the
    // floor. Friendly bolts are not sent at all: a guest draws its own at once and the
    // others' from their firing flag. That is what keeps forty minions inside the relays.
    // ===============================================================
    const r1 = v => round(v * 10) / 10;
    const q5 = v => round(v * 5);         // a fifth of a metre
    const PHASES = ['countdown', 'live', 'over'];
    function packHeroFast(h) {
        const f = (h.down ? 1 : 0) | (h.out ? 2 : 0) | (h.stance ? 4 : 0) | (h.firing ? 8 : 0) | (h.grounded ? 16 : 0) | (h.safe > 0 ? 32 : 0) | (h.castT > 0 ? 64 : 0) | (h.hitT > 0 ? 128 : 0);
        return [q5(h.x), round(h.y * 10), q5(h.z), round(h.yaw * 50), round(h.pitch * 50), round(h.mvx * 5), round(h.mvz * 5), f];
    }
    function packHeroSlow(h, human) {
        const sk = [];
        for (const k of h.skills) sk.push(SKILL_INDEX[k.id] * 4 + k.rank, round(k.cd * 10));
        const pas = [];
        for (const k in h.pas) pas.push(PAS_INDEX[k] * 4 + h.pas[k]);
        const out = [h.i, round(h.hp), h.maxHp, h.level, round(h.xp), h.picks, round(h.shield), r1(h.bleed), round(h.revive * 100), sk, pas, round(h.slowT * 10), round(h.stunT * 10)];
        if (human) out.push(h.offer ? h.offer.map(c => (c.t === 'pas' ? 100 + PAS_INDEX[c.id] : SKILL_INDEX[c.id]) * (c.t === 'rank' ? -1 : 1) - (c.t === 'rank' ? 1 : 0)) : 0, round(h.dashCd * 10), round(h.fireCd * 10));
        return out;
    }
    const cardOf = n => n >= 100 ? { t: 'pas', id: D.PASSIVES[n - 100] && D.PASSIVES[n - 100].id } : n < 0 ? { t: 'rank', id: D.SKILLS[-n - 1] && D.SKILLS[-n - 1].id } : { t: 'new', id: D.SKILLS[n] && D.SKILLS[n].id };
    function slowKey(h, human) {
        let k = round(h.hp) + ',' + h.maxHp + ',' + h.level + ',' + round(h.xp / 5) + ',' + h.picks + ',' + round(h.shield / 3) + ',' + ceil(h.bleed) + ',' + round(h.revive * 10) + ',' + h.skills.map(q => q.id + q.rank + ':' + ceil(q.cd)).join(';') + JSON.stringify(h.pas) + ceil(h.slowT) + ceil(h.stunT);
        if (human) k += '|' + (h.offer ? h.offer.map(c => c.t + c.id).join(',') : '') + ceil(h.dashCd);
        return k;
    }
    function packMinion(m) {
        const f = (m.act ? m.act : 0) | (m.elite ? 4 : 0) | (m.hitT > 0 ? 8 : 0) | (m.stunT > 0 ? 16 : 0) | (m.slowT > 0 ? 32 : 0);
        const out = [m.id, q5(m.x), q5(m.z), round(m.yaw * 10), round(m.hp / m.maxHp * 100), f];
        if (m.id >= 100000) out.push(KIND_INDEX[m.kind]);
        return out;
    }
    function packTel(t) {
        if (t.k === 'lane') return [t.id, 2, q5(t.x), q5(t.z), round(t.r * 10), round(t.t * 10), round(t.total * 10), q5(t.x2), q5(t.z2)];
        if (t.k === 'ring') return [t.id, 3, q5(t.x), q5(t.z), round(t.r * 10), round(t.t * 10), round(t.total * 10), round(t.speed * 10)];
        return [t.id, t.side === 0 ? 1 : 0, q5(t.x), q5(t.z), round(t.r * 10), round(t.t * 10), round(t.total * 10)];
    }
    function snapshot(s, extra, humans, full) {
        const hum = humans || [];
        const wire = s._wire || (s._wire = { key: [], left: [], rr: 0 });
        const hv = [];
        s.heroes.forEach((h, i) => {
            const key = slowKey(h, hum.includes(i));
            if (key !== wire.key[i]) { wire.key[i] = key; wire.left[i] = 3; }
        });
        wire.rr = (wire.rr + 1) % s.heroes.length;
        s.heroes.forEach((h, i) => {
            if (full || wire.left[i] > 0 || i === wire.rr) {
                hv.push(packHeroSlow(h, hum.includes(i)));
                if (wire.left[i] > 0) wire.left[i]--;
            }
        });
        const m = [];
        let n = 0;
        for (const mn of s.minions) if (mn.state === 1 && n++ < RUN.maxAwake) m.push(packMinion(mn));
        const e = [];
        for (const p of s.proj) if (p.side === 1) e.push(q5(p.x), q5(p.z), round(p.vx * 5), round(p.vz * 5), p.kind === 'bossorb' ? 1 : 0);
        const bits = a => { const out = []; for (let k = 0; k < a.length; k += 30) { let v = 0; for (let j = 0; j < 30 && k + j < a.length; j++) if (a[k + j]) v |= 1 << j; out.push(v); } return out; };
        const d = {
            k: s.tick, r: s.run, ph: PHASES.indexOf(s.phase), pt: r1(s.phaseT), t: r1(s.t),
            fr: s.frontier, ls: s.lastShrine, co: s.continues, at: s.attempt,
            sh: s.shrine ? [s.shrine.room, r1(s.shrine.t), s.shrine.done ? 1 : 0, s.shrine.healed ? 1 : 0] : 0,
            g: bits(s.gateOpen), en: bits(s.entered), cl: bits(s.cleared), ch: bits(s.chestOpen),
            h: s.heroes.map(packHeroFast), hv, m, e,
            tl: s.tel.map(packTel),
            zn: s.zones.map(z => [z.id, SKILL_INDEX[z.k], q5(z.x), q5(z.z), round(z.r * 10), r1(z.life)]),
            wl: s.walls.map(w => [w.id, q5(w.x), q5(w.z), round(w.ang * 50), round(w.hw * 10), round(w.hp / w.maxHp * 100)]),
            dc: s.decoys.map(dc => [dc.id, q5(dc.x), q5(dc.z), dc.o, r1(dc.life)])
        };
        if (s.bossOn && s.boss) {
            const b = s.boss;
            d.b = [q5(b.x), q5(b.z), round(b.yaw * 50), round(b.hp), b.phase, b.safe > 0 ? 1 : 0, b.hitT > 0 ? 1 : 0, b.atk ? ATTACK_NAMES.indexOf(b.atk) + 1 : 0];
        }
        if (s.over) { d.ov = s.over === 'win' ? 1 : 0; d.rs = s.reason; }
        if (extra) Object.assign(d, extra);
        return d;
    }
    const unbits = (v, n) => { const out = new Uint8Array(n); if (!Array.isArray(v)) return out; for (let k = 0; k < n; k++) out[k] = (v[floor(k / 30)] >> (k % 30)) & 1; return out; };
    function applySnapshot(s, d) {
        if (!d || !Array.isArray(d.h)) return false;
        s.tick = d.k;
        s.phase = PHASES[d.ph] || s.phase;
        s.phaseT = d.pt; s.t = d.t;
        // a wipe on the host: the rooms after the shrine are built again here too
        if (typeof d.at === 'number' && d.at !== s.attempt) rebuildAfterWipe(s, d.at, d.ls);
        s.frontier = d.fr; s.lastShrine = d.ls; s.continues = d.co;
        s.shrine = Array.isArray(d.sh) ? { room: d.sh[0], t: d.sh[1], done: !!d.sh[2], healed: !!d.sh[3] } : null;
        s.gateOpen = unbits(d.g, s.dun.gates.length);
        s.entered = unbits(d.en, s.dun.rooms.length);
        s.cleared = unbits(d.cl, s.dun.rooms.length);
        s.chestOpen = unbits(d.ch, s.dun.chests.length);
        d.h.forEach((a, i) => {
            const h = s.heroes[i];
            if (!h || !Array.isArray(a)) return;
            h.x = a[0] / 5; h.y = a[1] / 10; h.z = a[2] / 5; h.yaw = a[3] / 50; h.pitch = a[4] / 50; h.mvx = a[5] / 5; h.mvz = a[6] / 5;
            const f = a[7];
            h.down = !!(f & 1); h.out = !!(f & 2); h.stance = !!(f & 4); h.firing = !!(f & 8); h.grounded = !!(f & 16); h.safe = f & 32 ? 0.3 : 0; h.castT = f & 64 ? 0.2 : 0; h.hitT = f & 128 ? 0.2 : 0;
        });
        if (Array.isArray(d.hv)) d.hv.forEach(a => {
            if (!Array.isArray(a)) return;
            const h = s.heroes[a[0]];
            if (!h) return;
            h.hp = a[1]; h.maxHp = a[2]; h.level = a[3]; h.xp = a[4]; h.picks = a[5]; h.shield = a[6]; h.bleed = a[7]; h.revive = a[8] / 100;
            const sk = a[9] || [];
            const was = h.skills;
            h.skills = [];
            for (let k = 0; k + 1 < sk.length; k += 2) {
                const def = D.SKILLS[floor(sk[k] / 4)];
                if (def) h.skills.push({ id: def.id, rank: sk[k] % 4, cd: sk[k + 1] / 10 });
            }
            // a cooldown the guest started itself and the host has not heard of yet stays
            h.skills.forEach(k => { const o = was.find(q => q.id === k.id); if (o && o.guess && o.cd > k.cd) { k.cd = o.cd; k.guess = o.guess; } });
            h.pas = {};
            for (const v of a[10] || []) { const p = D.PASSIVES[floor(v / 4)]; if (p) h.pas[p.id] = v % 4; }
            h.slowT = a[11] / 10; h.stunT = a[12] / 10;
            if (a.length > 13) {
                h.offer = Array.isArray(a[13]) ? a[13].map(cardOf).filter(c => c.id) : null;
                h.dashCd = a[14] / 10; h.fireCd = a[15] / 10;
            }
        });
        // minions: what is listed is awake; what was awake and is not listed is dead
        const seen = new Set();
        for (const a of d.m || []) {
            if (!Array.isArray(a)) continue;
            let mn = s.byId.get(a[0]);
            if (!mn && a[0] >= 100000 && D.MINION_KINDS[a[6]]) {
                mn = newMinion(s, a[0], D.MINION_KINDS[a[6]], a[1] / 5, a[2] / 5, s.dun.boss, false, 2);
                addMinion(s, mn);
            }
            if (!mn) continue;
            seen.add(mn.id);
            mn.state = 1;
            mn.tx = a[1] / 5; mn.tz = a[2] / 5; mn.tyaw = a[3] / 10;
            if (mn.px === undefined) { mn.x = mn.tx; mn.z = mn.tz; mn.yaw = mn.tyaw; mn.px = 1; }
            mn.hp = a[4] / 100 * mn.maxHp;
            const f = a[5];
            mn.act = f & 3; mn.elite = !!(f & 4); mn.hitT = f & 8 ? 0.15 : 0; mn.stunT = f & 16 ? 0.2 : 0; mn.slowT = f & 32 ? 0.2 : 0;
        }
        for (const mn of s.minions) if (mn.state === 1 && !seen.has(mn.id)) { mn.state = 2; mn.hp = 0; }
        s.eproj = [];
        const e = d.e || [];
        for (let k = 0; k + 4 < e.length; k += 5) s.eproj.push({ x: e[k] / 5, z: e[k + 1] / 5, vx: e[k + 2] / 5, vz: e[k + 3] / 5, big: e[k + 4] === 1, y: SHOT_Y });
        s.tel = (d.tl || []).map(a => {
            const t = { id: a[0], k: ['slam', 'strike', 'lane', 'ring'][a[1]] || 'slam', side: a[1] === 1 ? 0 : 1, x: a[2] / 5, z: a[3] / 5, r: a[4] / 10, t: a[5] / 10, total: a[6] / 10 };
            if (a[1] === 2) { t.x2 = a[7] / 5; t.z2 = a[8] / 5; }
            if (a[1] === 3) t.speed = a[7] / 10;
            return t;
        });
        s.zones = (d.zn || []).map(a => ({ id: a[0], k: D.SKILLS[a[1]] ? D.SKILLS[a[1]].id : 'blizzard', x: a[2] / 5, z: a[3] / 5, r: a[4] / 10, life: a[5] }));
        s.walls = (d.wl || []).map(a => ({ id: a[0], x: a[1] / 5, z: a[2] / 5, ang: a[3] / 50, ca: cos(a[3] / 50), sa: sin(a[3] / 50), hw: a[4] / 10, hd: 0.5, hp: a[5], maxHp: 100 }));
        s.decoys = (d.dc || []).map(a => ({ id: a[0], x: a[1] / 5, z: a[2] / 5, o: a[3], life: a[4], hp: 1 }));
        if (Array.isArray(d.b)) {
            if (!s.boss) { const B = D.BOSSES[s.dun.def.boss]; s.boss = { boss: true, kind: s.dun.def.boss, x: d.b[0] / 5, z: d.b[1] / 5, yaw: d.b[2] / 50, r: B.r, maxHp: B.hp, hp: B.hp, phase: 0 }; }
            const b = s.boss;
            b.tx = d.b[0] / 5; b.tz = d.b[1] / 5; b.tyaw = d.b[2] / 50; b.hp = d.b[3]; b.phase = d.b[4]; b.safe = d.b[5] ? 0.3 : 0; b.hitT = d.b[6] ? 0.15 : 0; b.atkN = d.b[7];
            s.bossOn = true;
        } else if (!s.over) { s.bossOn = false; s.boss = null; }
        s.over = d.ov === undefined ? null : d.ov ? 'win' : 'lose';
        s.reason = d.rs || null;
        return true;
    }
    function rebuildAfterWipe(s, attempt, from) {
        const dun = s.dun;
        s.attempt = attempt;
        s.minions = s.minions.filter(m => m.room <= from && m.id < 100000);
        s.byId = new Map(s.minions.map(m => [m.id, m]));
        for (let r = from + 1; r < dun.rooms.length; r++) spawnRoom(s, dun.rooms[r], attempt).forEach(m => addMinion(s, m));
    }

    // ===============================================================
    // THE BOTS
    //
    // They play through the same doors: an input and the odd command. They shoot the
    // nearest thing they can see, keep their distance from what bites, get out of the
    // red, jump the rings, pick each other up, and spend their cards. pick: 'random'
    // takes any of the three, which is what the balance check wants, so every skill is
    // measured; 'smart' has a little taste, which is what a party in a real run wants.
    // ===============================================================
    function newBrain(seed, opts) {
        opts = opts || {};
        return { seed: seed >>> 0 || 1, react: opts.react === undefined ? 0.3 : opts.react, aimErr: opts.aimErr === undefined ? 0.06 : opts.aimErr, pick: opts.pick || 'smart', think: 0, strafe: 1, strafeT: 0, target: null, goal: null, hold: 0 };
    }
    function brnd(b) { b.seed = (Math.imul(b.seed, 1664525) + 1013904223) >>> 0; return b.seed / 4294967296; }
    function danger(s, x, z, react) {
        // how bad it would be to stand here when the red goes off
        let worst = null, wd = 0;
        for (const t of s.tel) {
            if (t.side !== 1 || t.k === 'ring' || t.t < (react || 0)) continue;
            const d = t.k === 'lane' ? distToSeg(x, z, t.x, t.z, t.x2, t.z2) : hypot(x - t.x, z - t.z);
            const over = t.r + HERO.radius + 0.4 - d;
            if (over > wd) { wd = over; worst = t; }
        }
        return worst;
    }
    function botPick(s, h, b) {
        if (!h.offer || !h.offer.length) return 0;
        if (b.pick === 'random') return floor(brnd(b) * h.offer.length);
        const has = id => s.heroes.some(o => skillOf(o, id));
        let best = 0, bs = -1e9;
        h.offer.forEach((c, k) => {
            let sc = brnd(b) * 3;
            if (c.t === 'new') sc += 6 + ((c.id === 'regrowth' || c.id === 'runeward') && !has(c.id) ? 3 : 0);
            if (c.t === 'rank') sc += 5;
            if (c.t === 'pas') sc += 3;
            if (sc > bs) { bs = sc; best = k; }
        });
        return best;
    }
    function goalFor(s, h) {
        const dun = s.dun;
        if (s.shrine && !s.shrine.done) {
            const rm = dun.rooms[s.shrine.room];
            return { x: rm.cx + (h.i - 1.5) * 1.5, z: rm.cz };
        }
        if (s.bossOn) {
            const rm = dun.rooms[dun.boss];
            return { x: rm.cx, z: rm.cz - 6 };
        }
        // the next room nobody has cleared, or the chest in this one
        let fi = s.frontier;
        const rm = dun.rooms[fi];
        const chest = dun.chests.findIndex(c => c.room === fi && !s.chestOpen[c.i]);
        if (s.cleared[fi] && chest >= 0) return { x: dun.chests[chest].x, z: dun.chests[chest].z };
        if (s.cleared[fi] && rm.gate >= 0 && s.gateOpen[rm.gate]) {
            const next = dun.rooms[min(fi + 1, dun.rooms.length - 1)];
            return { x: next.cx, z: next.kind === 'boss' ? next.z0 + 6 : next.cz };
        }
        if (!s.entered[fi] && fi > 0) return { x: rm.cx, z: rm.z0 + 4 };
        return { x: rm.cx + (h.i - 1.5) * 2, z: rm.cz };
    }
    function think(s, i, b) {
        const h = s.heroes[i], inp = blankInput();
        inp.yaw = h.yaw; inp.pitch = 0;
        if (h.offer && h.picks > 0 && (brnd(b) < 0.2 || b.pick === 'random')) command(s, i, { c: 'pick', n: botPick(s, h, b) });
        if (h.out) { s.input[i] = inp; return; }
        const W = W_(s);
        // ---- what to shoot ----
        b.think -= DT;
        if (b.think <= 0 || !b.target || (b.target.state !== undefined && b.target.state !== 1) || (b.target.boss && b.target.hp <= 0)) {
            b.think = 0.35;
            let best = null, bd = 26;
            for (const t of enemiesNear(s, h.x, h.z, 26)) {
                if (!W.clearLine(h.x, SHOT_Y, h.z, t.e.x, SHOT_Y, t.e.z)) continue;
                // the ones that heal and the ones that blow up first
                const k = t.e.kind;
                const d = t.d - (k === 'healer' ? 6 : k === 'bomber' ? 5 : k === 'popup' ? 2 : 0);
                if (d < bd) { bd = d; best = t.e; }
            }
            if (best !== b.target) { b.target = best; b.since = 0; b.tHp = best ? best.hp : 0; b.chase = 0; }
        }
        // shooting it and it is not going down: a wall, or it is being mended. go closer
        if (b.target) {
            b.since = (b.since || 0) + DT;
            if (b.target.hp < b.tHp - 1) { b.tHp = b.target.hp; b.since = 0; }
            if (b.since > 2.5) { b.chase = 3; b.since = 0; b.tHp = b.target.hp; }
        }
        b.chase = max(0, (b.chase || 0) - DT);
        const T = b.target;
        // ---- where to stand ----
        let gx, gz, urgent = false;
        const dz = danger(s, h.x, h.z, b.react);
        const downed = s.heroes.find(o => o.down && o !== h && hypot(o.x - h.x, o.z - h.z) < 30);
        if (dz) {
            // out of the red: away from the middle of it, or off the side of a lane
            let ax, az;
            if (dz.k === 'lane') {
                const lx = dz.x2 - dz.x, lz = dz.z2 - dz.z, l = hypot(lx, lz) || 1;
                const side = ((h.x - dz.x) * -lz + (h.z - dz.z) * lx) >= 0 ? 1 : -1;
                ax = -lz / l * side; az = lx / l * side;
            } else { const d = hypot(h.x - dz.x, h.z - dz.z) || 0.1; ax = (h.x - dz.x) / d; az = (h.z - dz.z) / d; if (d < 0.2) { ax = cos(b.seed); az = sin(b.seed); } }
            gx = h.x + ax * 4; gz = h.z + az * 4;
            urgent = true;
        } else if (downed && (!T || hypot(T.x - downed.x, T.z - downed.z) > 3 || h.hp > h.maxHp * 0.5)) {
            gx = downed.x; gz = downed.z;
        } else if (T) {
            const d = hypot(T.x - h.x, T.z - h.z) || 0.1;
            const M = T.boss ? null : D.MINIONS[T.kind];
            const want = b.chase > 0 ? 2.5 : T.boss ? 10 : M && (M.melee || M.slam || M.fuse) ? 8 : 11;
            b.strafeT -= DT;
            if (b.strafeT <= 0) { b.strafeT = 1 + brnd(b) * 2; b.strafe = brnd(b) < 0.5 ? -1 : 1; }
            const ux = (T.x - h.x) / d, uz = (T.z - h.z) / d;
            const back = d < want ? -1 : d > want + 4 ? 1 : 0;
            gx = h.x + ux * back * 3 + -uz * b.strafe * 2; gz = h.z + uz * back * 3 + ux * b.strafe * 2;
            if (b.chase > 0) { gx = T.x; gz = T.z; }
            // never strafe off into a corner: the room's middle pulls a little
            const rmi = s.dun.roomAt(h.x, h.z);
            if (rmi >= 0) { const rm = s.dun.rooms[rmi]; gx += (rm.cx - h.x) * 0.08; gz += (rm.cz - h.z) * 0.08; }
        } else {
            const g = goalFor(s, h);
            gx = g.x; gz = g.z;
        }
        // ---- getting there ----
        let mvx = 0, mvz = 0;
        if (hypot(gx - h.x, gz - h.z) > 0.6) {
            const step = urgent ? { x: gx, z: gz } : W.nextStep(h.x, h.z, gx, gz);
            mvx = step.x - h.x; mvz = step.z - h.z;
            const l = hypot(mvx, mvz) || 1;
            mvx /= l; mvz /= l;
            // a door that is shut: wait by it rather than walking into it
            if (gateAt(s, h.x + mvx * 1.2, h.z + mvz * 1.2, HERO.radius)) { mvx = 0; mvz = 0; }
        }
        // ---- which way to face: at what we shoot, or where we go ----
        let yaw = h.yaw;
        if (T) {
            // lead a little, and miss a little
            const lead = hypot(T.x - h.x, T.z - h.z) / HERO.bolt.speed;
            const tvx = T.vx || 0, tvz = T.vz || 0;
            yaw = atan2(T.x + tvx * lead - h.x, -(T.z + tvz * lead - h.z)) + (brnd(b) - 0.5) * b.aimErr * 2;
        } else if (mvx || mvz) yaw = atan2(mvx, -mvz);
        // the stick is relative to where you face
        const fx = sin(yaw), fz = -cos(yaw), rx = cos(yaw), rz = sin(yaw);
        inp.mx = mvx * rx + mvz * rz;
        inp.mz = mvx * fx + mvz * fz;
        inp.yaw = yaw;
        inp.fire = !!T;
        // ---- rings: jump them ----
        for (const t of s.tel) {
            if (t.k !== 'ring' || t.t < 0) continue;
            const d = hypot(h.x - t.x, h.z - t.z);
            if (d - t.r > 0 && d - t.r < 1.6) inp.jump = true;
        }
        if (urgent && h.dashCd <= 0 && dz && dz.t > dz.total - 0.4) inp.dash = true;
        s.input[i] = inp;
        // ---- skills ----
        if (!canAct(h) || s.phase !== 'live') return;
        b.hold -= DT;
        if (b.hold > 0) return;
        for (let k = 0; k < h.skills.length; k++) {
            const sk = h.skills[k];
            if (sk.cd > 0) continue;
            const def = D.skillById(sk.id), R = def.r[sk.rank - 1];
            const near = r => enemiesNear(s, h.x, h.z, r);
            let go = false, tx, tz;
            switch (def.kind) {
                case 'shot': case 'chain': case 'missiles':
                    go = !!T && hypot(T.x - h.x, T.z - h.z) < (def.range || 20);
                    break;
                case 'strike': case 'zone': {
                    // the middle of the biggest crowd in reach, or the boss
                    if (T && T.boss) { go = true; tx = T.x; tz = T.z; break; }
                    let bestN = 0;
                    for (const t of near(def.range)) {
                        const n = enemiesNear(s, t.e.x, t.e.z, R.aoe).length;
                        if (n > bestN) { bestN = n; tx = t.e.x; tz = t.e.z; }
                    }
                    go = bestN >= 3 || (bestN >= 1 && T && T.elite);
                    break;
                }
                case 'nova':
                    go = near(R.aoe).length >= 2 || (T && T.boss && hypot(T.x - h.x, T.z - h.z) < R.aoe + T.r);
                    break;
                case 'ward': {
                    const hurting = s.heroes.filter(o => !o.down && !o.out && hypot(o.x - h.x, o.z - h.z) < R.aoe && o.hp < o.maxHp * 0.85).length;
                    go = hurting >= 1 && (near(12).length >= 2 || s.bossOn);
                    break;
                }
                case 'heal': {
                    let missing = 0;
                    for (const o of s.heroes) if (!o.down && !o.out && hypot(o.x - h.x, o.z - h.z) < R.aoe) missing += o.maxHp - o.hp;
                    go = missing > R.heal * 0.9;
                    break;
                }
                case 'blink':
                    go = (h.hp < h.maxHp * 0.4 && near(3).length > 0) || (!!T && hypot(T.x - h.x, T.z - h.z) < 6 && near(R.aoe + 6).length >= 3);
                    if (go && h.hp < h.maxHp * 0.4 && T) { s.input[i].yaw = atan2(h.x - T.x, -(h.z - T.z)); }
                    break;
                case 'wall': {
                    const biters = near(9).filter(t => !t.e.boss && (D.MINIONS[t.e.kind].melee || D.MINIONS[t.e.kind].slam || D.MINIONS[t.e.kind].fuse));
                    if (biters.length >= 3) { go = true; tx = h.x + (biters[0].e.x - h.x) * 0.5; tz = h.z + (biters[0].e.z - h.z) * 0.5; }
                    break;
                }
                case 'decoy':
                    go = near(14).length >= 4 || (s.bossOn && !!T);
                    if (go && T) { tx = h.x + (T.x - h.x) * 0.5; tz = h.z + (T.z - h.z) * 0.5; }
                    break;
            }
            if (!go) continue;
            const y = (tx !== undefined) ? atan2(tx - h.x, -(tz - h.z)) : s.input[i].yaw;
            if (!command(s, i, { c: 'cast', k, q: 0, y, tx, tz })) { b.hold = 0.4; break; }
        }
    }

    // ===============================================================
    // the camera, which the page and the tests both want
    // ===============================================================
    function camera(s, h, out) {
        out = out || {};
        const yaw = h.yaw, pitch = h.pitch || 0;
        const fx = sin(yaw), fz = -cos(yaw);
        const back = 6, up = 3.3;
        let dist = back;
        const W = W_(s);
        // pull in rather than look through a wall
        for (let d = 0.5; d <= back; d += 0.25) {
            const x = h.x - fx * d * cos(pitch), z = h.z - fz * d * cos(pitch);
            if (W.at(x, z) > h.y + up - 0.3) { dist = max(1.2, d - 0.5); break; }
        }
        out.x = h.x - fx * dist * cos(pitch);
        out.y = h.y + up + sin(pitch) * dist * 0.6;
        out.z = h.z - fz * dist * cos(pitch);
        out.fx = fx * cos(pitch - 0.08); out.fy = -sin(-pitch + 0.08); out.fz = fz * cos(pitch - 0.08);
        out.t = dist / back;
        return out;
    }
    // where the crosshair meets the floor, for skills that land somewhere
    function crosshairGround(s, cam, range, h) {
        const W = W_(s);
        for (let d = 1; d < 40; d += 0.4) {
            const x = cam.x + cam.fx * d, y = cam.y + cam.fy * d, z = cam.z + cam.fz * d;
            if (y <= W.at(x, z) + 0.05 || y < 0) {
                const dd = hypot(x - h.x, z - h.z);
                if (dd > range) return { x: h.x + (x - h.x) / dd * range, z: h.z + (z - h.z) / dd * range };
                return { x, z };
            }
        }
        return { x: h.x + sin(h.yaw) * range, z: h.z - cos(h.yaw) * range };
    }

    window.DZ_SIM = {
        newRun, step, command, setInput, sanitizeInput, blankInput, castProblem,
        snapshot, applySnapshot, buildDungeon, spawnRoom, moveHero, groundUnder, gateAt,
        newBrain, think, botPick, camera, crosshairGround, drawPower, cardsFor, rollOffer,
        enemiesNear, damageEnemy, hurtHero, maxHpOf, dmgOf,
        HZ, DT, WALL_H, LOW_H, SHOT_Y, SKILL_INDEX, PAS_INDEX, KIND_INDEX, ATTACK_NAMES, rng, mix
    };
})();
