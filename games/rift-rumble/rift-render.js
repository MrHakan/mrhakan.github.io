// Locally served sprite atlases, desktop stages and responsive combat effects.
(function (root) {
    'use strict';
    const D = root.RIFT, TAU = Math.PI * 2;
    const sprite = (...args) => root.RIFT_FIGHTERS.draw(...args);
    function create(canvas) {
        const c = canvas.getContext('2d', { alpha: false });
        let seen = 0, particles = [], lastT = 0, shake = 0, bursts = [];
        function rect(x, y, w, h, color) { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
        function draw(s, time, opts = {}) {
            const t = opts.reduced ? 0 : time, dt = Math.min(0.05, Math.max(0, time - lastT)); lastT = time;
            const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720, dpr = Math.min(2, root.devicePixelRatio || 1);
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
            c.setTransform(canvas.width / 1280, 0, 0, canvas.height / 720, 0, 0); c.imageSmoothingEnabled = false;
            if (!opts.reduced && shake > 0) { c.translate(Math.sin(time * 150) * shake * 24, Math.cos(time * 120) * shake * 14); shake = Math.max(0, shake - dt); }
            const arena = D.ARENAS.find(a => a.id === s.arena) || D.ARENAS[0];
            root.RIFT_STAGES.background(c, arena, t);
            // Preserve pixel proportions in a tall phone viewport. The sky fills the
            // margins; the entire arena stays visible above the touch controls.
            if (w / h < 1.4) {
                const scale = canvas.width / (opts.menu ? 1180 : s.mode === 2 ? 1000 : 900);
                c.setTransform(scale, 0, 0, scale, (canvas.width - 1280 * scale) / 2, canvas.height * (opts.menu ? 0.11 : 0.22));
            }
            arena.platforms.forEach((p, i) => root.RIFT_STAGES.platform(c, p, i, t, arena));
            if (opts.menu) { const g = c.createLinearGradient(0, 0, 1280, 0); g.addColorStop(0, '#102d4bcb'); g.addColorStop(0.52, '#12304410'); g.addColorStop(1, '#112b4a99'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720); }
            for (const e of s.events || []) if (e.id > seen) {
                if (e.type === 'hit') shake = e.heavy ? 0.15 : 0.075;
                if (e.type === 'ko') { shake = 0.2; bursts.push({ x: e.x, y: e.y - 35, life: 0.85, team: e.team }); }
                if (e.type === 'hit' || e.type === 'ko' || e.type === 'jump' || e.type === 'recover') {
                    const count = e.type === 'ko' ? 36 : e.type === 'hit' ? 16 : 7;
                    for (let i = 0; i < count; i++) particles.push({ x: e.x, y: e.y - 18, vx: Math.cos(i * 2.399) * (e.type === 'ko' ? 300 : 160), vy: Math.sin(i * 2.399) * 200 - 70, life: e.type === 'ko' ? 0.9 : 0.4, color: i % 3 ? '#fff0c4' : D.COLORS[e.team || 0], size: e.type === 'ko' ? 7 : 4 });
                }
                seen = e.id;
            }
            for (const shot of s.shots || []) {
                root.RIFT_FIGHTERS.shot(c, shot, t);
            }
            for (const p of s.players) {
                if (!p.stocks || p.respawn) continue;
                const px = p.x, py = p.y;
                if (p.grounded) { c.fillStyle = '#26395b66'; c.beginPath(); c.ellipse(px, py + 2, 28, 6, 0, 0, TAU); c.fill(); }
                if (p.dodge) { c.globalAlpha = 0.25; sprite(c, px - p.vx * 3, py, p.character, { facing: p.facing, team: p.team }); c.globalAlpha = 1; }
                sprite(c, px, py + (p.grounded && Math.abs(p.vx) < 0.2 ? Math.sin(t * 3 + p.slot) * 1.5 : 0), p.character, { team: p.team, scale: opts.menu ? 4.6 : 1.5, facing: p.facing, time: t, walk: p.grounded && Math.abs(p.vx) > 0.3, airborne: !p.grounded, hurt: p.stun > 0, attack: p.attack, alpha: p.invuln && Math.floor(t * 12) % 2 ? 0.55 : 1 });
                if (p.attack) {
                    const a = p.attack, spec = a.kind === 'special' && D.FIGHTERS[p.character].specialMelee ? D.FIGHTERS[p.character].specialMelee : D.ATTACKS[a.kind];
                    if (a.age >= spec.startup - 1 && a.age <= spec.startup + spec.active + 3 && a.kind !== 'special') {
                        c.save(); c.translate(px, py - 28); if (a.dir === 'up') c.rotate(-Math.PI / 2); else if (a.dir === 'down') c.rotate(Math.PI / 2); else c.scale(a.facing, 1);
                        c.strokeStyle = a.kind === 'heavy' ? '#fff1ba' : '#d8fff4'; c.lineWidth = a.kind === 'heavy' ? 10 : 6;
                        c.beginPath(); c.arc(10, 0, a.kind === 'heavy' ? 66 : 48, -1.12, 1.12); c.stroke(); c.restore();
                    }
                }
                if (!opts.menu) {
                    c.fillStyle = D.COLORS[p.team]; c.beginPath(); c.moveTo(px, py - 85); c.lineTo(px - 7, py - 94); c.lineTo(px + 7, py - 94); c.fill();
                    c.font = 'bold 13px Trebuchet MS, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#172544';
                    const label = p.id === opts.me ? 'YOU' : p.bot ? 'CPU' : p.name;
                    const width = c.measureText(label).width + 14; rect(px - width / 2, py - 118, width, 19, D.COLORS[p.team]); c.fillStyle = '#172544'; c.fillText(label, px, py - 104);
                    if (px < 18 || px > 1262 || py < 15) {
                        c.strokeStyle = D.COLORS[p.team]; c.lineWidth = 3; c.strokeRect(Math.max(8, Math.min(1235, px - 18)), Math.max(10, Math.min(620, py)), 36, 36);
                    }
                }
            }
            particles = particles.filter(p => p.life > 0);
            for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += dt * 300; c.globalAlpha = Math.min(1, p.life * 4); rect(p.x, p.y, p.size, p.size, p.color); }
            c.globalAlpha = 1;
            bursts = bursts.filter(b => b.life > 0);
            for (const b of bursts) {
                b.life -= dt; c.globalAlpha = Math.min(1, b.life * 3); c.strokeStyle = D.COLORS[b.team]; c.lineWidth = 7;
                c.beginPath(); c.arc(b.x, b.y, 25 + (0.85 - b.life) * 130, 0, TAU); c.stroke();
                c.font = 'italic 900 37px Arial Black,sans-serif'; c.textAlign = 'center'; c.fillStyle = '#112c47'; c.fillText('RECYCLED!', b.x + 3, b.y + 3); c.fillStyle = '#fff0bd'; c.fillText('RECYCLED!', b.x, b.y);
            }
            c.globalAlpha = 1;

        }
        return { draw, reset: () => { seen = 0; particles = []; bursts = []; shake = 0; } };
    }
    root.RIFT_RENDER = { create, sprite };
})(typeof window === 'undefined' ? globalThis : window);
