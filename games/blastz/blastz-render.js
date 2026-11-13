// blastz 98 drawing: one 2D canvas, the world fitted inside it. The fighters
// are Brawlz 98's own cutout rigs (RIFT_ART / RIFT_ANIM) with a gun in hand.
(function (root) {
    'use strict';
    const D = root.BLASTZ, A = root.RIFT_ANIM, ART = root.RIFT_ART;
    const TALL = 60;  // how tall a fighter stands, in world pixels
    let unit = 0;
    function scaleFor() {
        if (!unit) { let sum = 0; for (let i = 0; i < D.FIGHTERS; i++) sum += A.height(i); unit = TALL / (sum / D.FIGHTERS); }
        return unit;
    }
    function colorOf(s, p) { return s.teams ? D.TEAM_COLORS[p.team] : D.COLORS[p.slot % 4]; }

    // A small pixel gun along +x, grip at the origin.
    function gun(c, w, kick) {
        const [len, h, body] = w.gun;
        c.fillStyle = '#1b1d24'; c.fillRect(-3, -h / 2 - 1, len + 2, h + 2);
        c.fillStyle = body; c.fillRect(-2, -h / 2, len, h);
        c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(-2, -h / 2, len, 2);
        c.fillStyle = '#1b1d24'; c.fillRect(len - 2, -2, 7, 4);
        c.fillStyle = body; c.fillRect(-1, h / 2 - 1, 5, 7);
        if (w.spin) { c.fillStyle = '#2a2a30'; for (let i = 0; i < 3; i++) c.fillRect(len - 6, -h / 2 + 2 + i * (h - 4) / 2, 12, 2); }
        if (w.rocket || w.lob) { c.fillStyle = w.color; c.fillRect(len, -h / 2 + 1, 5, h - 2); }
        if (kick > 3) {
            c.fillStyle = 'rgba(255,240,170,.95)';
            c.beginPath(); c.moveTo(len + 5, -5); c.lineTo(len + 17 + kick, 0); c.lineTo(len + 5, 5); c.closePath(); c.fill();
        }
    }
    function sprite(c, x, y, character, opts = {}) {
        if (!ART || !ART.ready()) return false;
        const k = opts.scale || scaleFor();
        let animation = opts.animation;
        if (opts.weapon !== undefined && !animation) {
            const pose = { ...A.sample({ character, grounded: true }, opts.clock || 0, true).pose };
            hold(pose, 0); animation = { pose, bones: A.solve(pose) };
        }
        const w = opts.weapon !== undefined ? D.WEAPONS[opts.weapon] : null;
        const paintScale = k * A.SCALE;
        return ART.paint(c, x, y, character, Object.assign({}, opts, { scale: k, animation,
            prop: w ? cc => { cc.scale(1 / paintScale, 1 / paintScale); gun(cc, w, opts.kick || 0); } : opts.prop }));
    }
    // Arms forward, both hands on the gun, a little kick when it fires.
    function hold(pose, kick) {
        pose.armIK = 0; pose.weaponLayer = 1;
        const up = -0.04 - kick * 0.035;
        pose.fUpper = up - pose.body - 0.12; pose.fElbow = 0.14; pose.fHand = up; pose.weapon = 0;
        pose.bUpper = up - pose.body + 0.35; pose.bElbow = -0.55; pose.bHand = up; pose.backLayer = 1;
        return pose;
    }

    function create(canvas) {
        const c = canvas.getContext('2d');
        let anims = [], seen = 0, fx = [], lastTick = -1;
        function reset() { anims = []; seen = 0; fx = []; lastTick = -1; }

        function fit() {
            const dpr = Math.min(2, root.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
            if (!w || !h) return null;
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
            const k = Math.min(canvas.width / D.W, canvas.height / D.H);
            return { k, ox: (canvas.width - D.W * k) / 2, oy: (canvas.height - D.H * k) / 2 };
        }

        function sky(map, t, reduced) {
            const g = c.createLinearGradient(0, -200, 0, D.H + 200);
            g.addColorStop(0, map.sky[0]); g.addColorStop(0.6, map.sky[1]); g.addColorStop(1, map.sky[2]);
            c.fillStyle = g; c.fillRect(-600, -600, D.W + 1200, D.H + 1200);
            c.save(); c.globalAlpha = 0.13; c.strokeStyle = '#fff'; c.fillStyle = '#fff'; c.lineWidth = 2;
            const drift = reduced ? 0 : t;
            if (map.id === 'start') {
                for (let i = 0; i < 4; i++) { const x = 120 + i * 290, y = 80 + (i % 2) * 70; c.strokeRect(x, y, 220, 150); c.fillRect(x, y, 220, 18); }
            } else if (map.id === 'board') {
                for (let i = 0; i < 14; i++) { const y = 40 + i * 52; c.beginPath(); c.moveTo(0, y); c.lineTo(300 + (i * 97) % 500, y); c.lineTo(340 + (i * 97) % 500, y + 26); c.lineTo(D.W, y + 26); c.stroke(); }
                for (let i = 0; i < 6; i++) { const x = (i * 211 + drift * 40) % D.W; c.fillRect(x, 40 + (i * 117) % 600, 6, 6); }
            } else if (map.id === 'tower') {
                for (let i = 0; i < 40; i++) c.fillRect((i * 173) % D.W, (i * 89) % 420, 2, 2);
                c.beginPath(); c.moveTo(640, 140); c.lineTo(560, 720); c.moveTo(640, 140); c.lineTo(720, 720);
                for (let y = 200; y < 720; y += 60) { const s = (y - 140) / 580 * 80; c.moveTo(640 - s, y); c.lineTo(640 + s, y + 60); c.moveTo(640 + s, y); c.lineTo(640 - s, y + 60); }
                c.stroke();
                const r = reduced ? 30 : 30 + (t * 40) % 90; c.beginPath(); c.arc(640, 140, r, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
            } else {
                c.globalAlpha = 0.07; c.lineWidth = 1;
                for (let x = 0; x <= D.W; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, D.H); c.stroke(); }
                for (let y = 0; y <= D.H; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(D.W, y); c.stroke(); }
                c.globalAlpha = 0.18;
                for (let i = 0; i < 9; i++) { const x = 60 + (i * 337) % 1160, y = 60 + (i * 211) % 420; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); c.fillRect(x - 14, y - 1, 28, 2); c.fillRect(x - 1, y - 14, 2, 28); }
            }
            c.restore();
            c.save(); c.globalAlpha = 0.16; c.fillStyle = '#fff'; c.font = 'bold 64px Tahoma, sans-serif'; c.textAlign = 'center';
            c.fillText(map.name, D.W / 2, D.H - 40); c.restore();
        }
        function platforms(map) {
            for (const pl of map.platforms) {
                c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(pl.x + 4, pl.y + 4, pl.w, 14);
                c.fillStyle = map.plat; c.fillRect(pl.x, pl.y, pl.w, 14);
                c.fillStyle = map.edge; c.fillRect(pl.x, pl.y, pl.w, 2); c.fillRect(pl.x, pl.y, 2, 14);
                c.fillStyle = map.shade; c.fillRect(pl.x, pl.y + 12, pl.w, 2); c.fillRect(pl.x + pl.w - 2, pl.y, 2, 14);
                if (pl.label) { c.fillStyle = map.shade; c.font = 'bold 10px Tahoma, sans-serif'; c.textAlign = 'left'; c.fillText(pl.label, pl.x + 6, pl.y + 11); }
            }
        }
        function crates(s, t) {
            for (const k of s.crates) {
                if (k.life < 180 && Math.floor(t * 8) % 2) continue;
                const x = k.x - 14, y = k.y - 26;
                c.fillStyle = '#1b1d24'; c.fillRect(x - 1, y - 1, 30, 28);
                c.fillStyle = k.item ? '#ffe36b' : '#c99a5b'; c.fillRect(x, y, 28, 26);
                c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(x, y, 28, 3); c.fillRect(x, y, 3, 26);
                c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x, y + 23, 28, 3); c.fillRect(x + 25, y, 3, 26);
                c.fillStyle = '#1b1d24'; c.font = 'bold 15px Tahoma, sans-serif'; c.textAlign = 'center'; c.fillText(k.item ? '★' : '?', k.x, y + 19);
                if (!k.landed) { c.strokeStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(k.x - 12, y); c.lineTo(k.x, y - 22); c.lineTo(k.x + 12, y); c.stroke(); c.fillStyle = '#eee'; c.beginPath(); c.arc(k.x, y - 30, 14, Math.PI, 0); c.fill(); }
            }
        }
        function bombs(s, t) {
            for (const g of s.bombs) {
                c.fillStyle = '#16181f'; c.beginPath(); c.arc(g.x, g.y - 7, 7, 0, Math.PI * 2); c.fill();
                c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(g.x - 4, g.y - 11, 3, 3);
                const blink = g.fuse < 40 ? Math.floor(t * 16) % 2 : Math.floor(t * 5) % 2;
                c.fillStyle = blink ? '#ff5a3c' : '#ffd447'; c.fillRect(g.x + 2, g.y - 17, 4, 4);
            }
        }
        function shots(s, lead) {
            for (const b of s.shots) {
                const w = D.WEAPONS[b.w], x = b.x + b.vx * lead, y = b.y + b.vy * lead;
                if (w.rocket) {
                    c.save(); c.translate(x, y); c.rotate(Math.atan2(b.vy, b.vx));
                    c.fillStyle = '#ffb547'; c.fillRect(-18, -3, 8, 6); c.fillStyle = '#d9dde6'; c.fillRect(-10, -4, 16, 8); c.fillStyle = w.color; c.fillRect(6, -4, 5, 8); c.restore();
                } else if (w.lob) {
                    c.fillStyle = w.color; c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
                    c.fillStyle = '#16181f'; c.fillRect(x - 2, y - 2, 4, 4);
                } else {
                    const tail = Math.min(1.6, 26 / Math.max(1, Math.hypot(b.vx, b.vy)) + 0.6);
                    c.strokeStyle = w.color; c.lineWidth = w.size; c.lineCap = 'round';
                    c.beginPath(); c.moveTo(x - b.vx * tail, y - b.vy * tail); c.lineTo(x, y); c.stroke();
                }
            }
        }
        function fighters(s, clock, opts) {
            const k = scaleFor();
            for (const p of s.players) {
                if (p.dead || p.out) continue;
                if (!anims[p.slot]) anims[p.slot] = A.create();
                const t = A.update(anims[p.slot], { character: p.character, grounded: p.grounded, vx: p.vx, vy: p.vy, travel: p.travel, stun: p.stun > 4 ? p.stun : 0, dodge: 0, attack: null }, clock, { reduced: opts.reduced, paused: opts.paused });
                const pose = hold({ ...t.pose }, p.kick || 0), bones = A.solve(pose), w = D.WEAPONS[p.weapon];
                const color = colorOf(s, p);
                c.save();
                if (p.invuln > 0 && Math.floor(clock / 4) % 2) c.globalAlpha = 0.45;
                if (p.turbo > 0) { c.fillStyle = 'rgba(255,230,120,.25)'; c.fillRect(p.x - 18 - p.vx * 3, p.y - 50, 36, 44); }
                if (p.grounded) { c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(p.x, p.y, 16, 4, 0, 0, Math.PI * 2); c.fill(); }
                sprite(c, p.x, p.y, p.character, { scale: k, facing: p.facing, animation: { pose, bones }, weapon: p.weapon, kick: p.kick });
                c.restore();
                if (w.sight && !p.reload) {
                    c.strokeStyle = 'rgba(255,80,160,.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x + p.facing * 30, p.y - 31); c.lineTo(p.x + p.facing * 1400, p.y - 31); c.stroke();
                }
                if (p.shield > 0 || p.invuln > 0) {
                    c.strokeStyle = p.shield > 0 ? 'rgba(120,220,255,.85)' : 'rgba(255,255,255,.5)'; c.lineWidth = 2;
                    c.beginPath(); c.arc(p.x, p.y - 28, 38, 0, Math.PI * 2); c.stroke();
                }
                // name tag and a little ammo bar over the head
                const label = (opts.labels && opts.labels[p.slot]) || (p.bot ? 'cpu' : p.name);
                c.font = 'bold 12px Tahoma, sans-serif'; c.textAlign = 'center';
                const tw = c.measureText(label).width + 10, ty = p.y - 82;
                c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(p.x - tw / 2, ty - 12, tw, 16);
                c.fillStyle = color; c.fillRect(p.x - tw / 2, ty + 3, tw, 2);
                c.fillStyle = '#fff'; c.fillText(label, p.x, ty);
                if (p.reload) { c.fillStyle = '#ffd447'; c.fillRect(p.x - 16, ty + 7, 32 * (1 - p.reload / Math.max(1, w.reload)), 3); }
            }
        }
        function markers(s, view) {
            // anyone off the top or the sides gets an arrow at the edge
            for (const p of s.players) {
                if (p.dead || p.out) continue;
                const out = p.y < 10 || p.x < 0 || p.x > D.W;
                if (!out) continue;
                const x = Math.max(18, Math.min(D.W - 18, p.x)), y = Math.max(18, p.y - 30);
                c.fillStyle = colorOf(s, p); c.strokeStyle = '#000'; c.lineWidth = 2;
                c.beginPath();
                if (p.y < 10) { c.moveTo(x, 6); c.lineTo(x - 10, 24); c.lineTo(x + 10, 24); }
                else if (p.x < 0) { c.moveTo(6, y); c.lineTo(24, y - 10); c.lineTo(24, y + 10); }
                else { c.moveTo(D.W - 6, y); c.lineTo(D.W - 24, y - 10); c.lineTo(D.W - 24, y + 10); }
                c.closePath(); c.fill(); c.stroke();
            }
        }
        function effects(s, now, reduced) {
            for (const e of s.events) {
                if (e.id <= seen) continue;
                seen = Math.max(seen, e.id);
                if (e.type === 'boom') fx.push({ kind: 'ring', x: e.x, y: e.y, r: e.r, at: now, life: 0.45 });
                else if (e.type === 'hit') fx.push({ kind: 'spark', x: e.x, y: e.y, at: now, life: 0.18 });
                else if (e.type === 'ko') fx.push({ kind: 'ko', x: e.x, y: e.y, slot: e.slot, at: now, life: 1.1 });
                else if (e.type === 'pick') fx.push({ kind: 'text', x: e.x, y: e.y, text: e.name, at: now, life: 1.2 });
                else if (e.type === 'empty') fx.push({ kind: 'text', x: e.x, y: e.y, text: 'out of ammo', at: now, life: 0.9 });
                else if (e.type === 'jump' && e.air) fx.push({ kind: 'puff', x: e.x, y: e.y, at: now, life: 0.3 });
            }
            fx = fx.filter(f => now - f.at < f.life);
            for (const f of fx) {
                const u = (now - f.at) / f.life;
                c.save();
                if (f.kind === 'ring') {
                    c.globalAlpha = 1 - u; c.fillStyle = 'rgba(255,190,90,.35)'; c.beginPath(); c.arc(f.x, f.y, f.r * (0.4 + 0.6 * u), 0, Math.PI * 2); c.fill();
                    c.strokeStyle = '#fff2c4'; c.lineWidth = 4 * (1 - u) + 1; c.stroke();
                } else if (f.kind === 'spark') {
                    c.globalAlpha = 1 - u; c.fillStyle = '#fff6c9';
                    for (let i = 0; i < 5; i++) { const a = i * 1.26 + f.x; c.fillRect(f.x + Math.cos(a) * 14 * u - 2, f.y + Math.sin(a) * 14 * u - 2, 4, 4); }
                } else if (f.kind === 'ko') {
                    const p = s.players[f.slot], col = p ? colorOf(s, p) : '#fff';
                    c.globalAlpha = 1 - u; c.strokeStyle = col; c.lineWidth = 6;
                    if (!reduced) for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(f.x + Math.cos(a) * 20, f.y + Math.sin(a) * 20); c.lineTo(f.x + Math.cos(a) * (40 + 120 * u), f.y + Math.sin(a) * (40 + 120 * u)); c.stroke(); }
                    c.fillStyle = '#fff'; c.font = 'bold 34px Tahoma, sans-serif'; c.textAlign = 'center'; c.fillText('KO!', Math.max(60, Math.min(D.W - 60, f.x)), Math.max(60, Math.min(D.H - 40, f.y)) - 20 * u);
                } else if (f.kind === 'text') {
                    c.globalAlpha = 1 - u * u; c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3; c.font = 'bold 14px Tahoma, sans-serif'; c.textAlign = 'center';
                    c.strokeText(f.text, f.x, f.y - 24 * u); c.fillText(f.text, f.x, f.y - 24 * u);
                } else if (f.kind === 'puff') {
                    c.globalAlpha = 0.6 * (1 - u); c.fillStyle = '#fff'; c.beginPath(); c.ellipse(f.x, f.y + 4, 10 + 14 * u, 4, 0, 0, Math.PI * 2); c.fill();
                }
                c.restore();
            }
        }
        function banner(s) {
            let text = '';
            if (s.phase === 'countdown') text = String(Math.max(1, Math.ceil(s.count / 60)));
            else if (s.phase === 'fight' && s.tick < D.COUNTDOWN + 50) text = 'BLAST!';
            if (!text) return;
            c.save(); c.font = 'bold 96px Tahoma, sans-serif'; c.textAlign = 'center'; c.lineWidth = 8; c.strokeStyle = '#000'; c.fillStyle = '#ffd447';
            c.strokeText(text, D.W / 2, 300); c.fillText(text, D.W / 2, 300); c.restore();
        }

        // `lead` moves bullets forward between snapshots on a guest.
        function draw(s, now, opts = {}) {
            const f = fit(); if (!f) return;
            const map = D.map(s.map);
            if (s.tick < lastTick) { anims = []; seen = 0; fx = []; }
            lastTick = s.tick;
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.setTransform(f.k, 0, 0, f.k, f.ox, f.oy);
            sky(map, now, opts.reduced);
            platforms(map);
            crates(s, now);
            bombs(s, now);
            fighters(s, opts.clock ?? s.tick, opts);
            shots(s, opts.lead || 0);
            effects(s, now, opts.reduced);
            markers(s);
            if (!opts.menu) banner(s);
        }
        return { draw, reset };
    }
    root.BLASTZ_RENDER = { create, sprite, scale: scaleFor, colorOf, gun };
})(window);
