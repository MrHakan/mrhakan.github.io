// Locally served sprite atlases, desktop stages and responsive combat effects.
(function (root) {
    'use strict';
    const D = root.RIFT, TAU = Math.PI * 2;
    const sprite = (...args) => root.RIFT_FIGHTERS.draw(...args);
    const swingAngles = {
        hook: [-1.28, 1.25], sweep: [-.12, 1.08], uppercut: [-1.72, .1],
        overhead: [-1.53, .85], shove: [-.5, .5], rush: [-.66, .66], pounce: [.12, 1.25]
    };
    function create(canvas) {
        const c = canvas.getContext('2d', { alpha: false });
        let seen = 0, particles = [], lastT = 0, shake = 0, bursts = [];
        const tracks = new Map();
        function rect(x, y, w, h, color) { c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
        function draw(s, time, opts = {}) {
            const simulationTime = opts.menu ? time : (opts.clock === undefined ? s.tick : opts.clock) / 60;
            const t = opts.reduced ? 0 : simulationTime, dt = opts.paused ? 0 : Math.min(0.05, Math.max(0, time - lastT)); lastT = time;
            const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720, dpr = Math.min(2, root.devicePixelRatio || 1);
            if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
            const arena = D.ARENAS.find(a => a.id === s.arena) || D.ARENAS[0];
            const width = arena.width || D.W;
            c.setTransform(canvas.width / width, 0, 0, canvas.height / D.H, 0, 0); c.imageSmoothingEnabled = false;
            root.RIFT_STAGES.background(c, arena, t);
            // Preserve pixel proportions in a tall phone viewport. The sky fills the
            // margins; the entire arena stays visible above the touch controls.
            if (w / h < 1.4) {
                const scale = canvas.width / (arena.width || (opts.menu ? 1180 : 900));
                c.setTransform(scale, 0, 0, scale, (canvas.width - width * scale) / 2, canvas.height * (opts.menu ? 0.11 : 0.22));
            } else {
                const scale = Math.min(canvas.width / width, canvas.height / D.H);
                c.setTransform(scale, 0, 0, scale, (canvas.width - width * scale) / 2, (canvas.height - D.H * scale) / 2);
            }
            if (!opts.reduced && !opts.paused && shake > 0) { c.translate(Math.sin(t * 150) * shake * 24, Math.cos(t * 120) * shake * 14); shake = Math.max(0, shake - dt); }
            arena.platforms.forEach((p, i) => root.RIFT_STAGES.platform(c, p, i, t, arena));
            if (opts.menu) { const g = c.createLinearGradient(0, 0, width, 0); g.addColorStop(0, '#102d4bcb'); g.addColorStop(0.52, '#12304410'); g.addColorStop(1, '#112b4a99'); c.fillStyle = g; c.fillRect(0, 0, width, D.H); }
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
                const key = p.id || p.slot;
                if (!tracks.has(key) || tracks.get(key).character !== p.character) tracks.set(key, Object.assign(root.RIFT_ANIM.create(), { character: p.character }));
                const animation = root.RIFT_ANIM.update(tracks.get(key), p, opts.menu ? time * 60 : opts.clock === undefined ? s.tick : opts.clock, { paused: opts.paused, reduced: opts.reduced });
                const facing = p.attack ? p.attack.facing : p.facing;
                if (p.grounded) { c.fillStyle = '#26395b66'; c.beginPath(); c.ellipse(px, py + 2, 28, 6, 0, 0, TAU); c.fill(); }
                if (p.dodge) { c.globalAlpha = 0.25; sprite(c, px - p.vx * 3, py, p.character, { facing, scale: 1.5, animation }); c.globalAlpha = 1; }
                sprite(c, px, py, p.character, { team: p.team, scale: opts.menu ? 4.6 : 1.5, facing, animation, time: t, walk: p.grounded && Math.abs(p.vx) > 0.3, airborne: !p.grounded, hurt: p.stun > 0, attack: p.attack, alpha: p.invuln && Math.floor(simulationTime * 12) % 2 ? 0.55 : 1 });
                if (p.attack) {
                    const a = p.attack, fighter = D.FIGHTERS[p.character], spec = D.attackFor(p.character, a.kind, a.dir);
                    const melee = a.kind !== 'special' || (fighter.specialMelee && a.dir !== 'up');
                    if (melee && a.age >= spec.startup && a.age <= spec.startup + spec.active + 2) {
                        c.save(); c.translate(px, py - 28); if (a.dir === 'up') c.rotate(-Math.PI / 2); else if (a.dir === 'down') c.rotate(Math.PI / 2); else c.scale(a.facing, 1);
                        c.strokeStyle = a.kind === 'light' ? '#d8fff4' : fighter.light;
                        c.lineWidth = a.kind === 'light' ? 6 : 9;
                        c.globalAlpha = Math.min(1, (spec.startup + spec.active + 3 - a.age) / 4);
                        c.beginPath();
                        if (a.dir === 'side' && (spec.pose === 'thrust' || spec.pose === 'jab')) {
                            c.moveTo(21, 1); c.lineTo(spec.reach, -3);
                        } else {
                            const angles = a.dir === 'side' && swingAngles[spec.pose] || [-1.12, 1.12];
                            c.arc(10, 0, spec.reach - 10, ...angles);
                        }
                        c.stroke(); c.restore();
                    }
                }
                if (!opts.menu) {
                    const markerY = py - root.RIFT_ANIM.height(p.character) * 1.5 - 8;
                    c.fillStyle = D.COLORS[p.team]; c.beginPath(); c.moveTo(px, markerY); c.lineTo(px - 7, markerY - 9); c.lineTo(px + 7, markerY - 9); c.fill();
                    c.font = 'bold 13px Trebuchet MS, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#172544';
                    const label = p.id === opts.me ? 'YOU' : p.bot ? 'CPU' : p.name;
                    const labelWidth = c.measureText(label).width + 14; rect(px - labelWidth / 2, markerY - 32, labelWidth, 19, D.COLORS[p.team]); c.fillStyle = '#172544'; c.fillText(label, px, markerY - 18);
                    if (px < 18 || px > width - 18 || py < 15) {
                        c.strokeStyle = D.COLORS[p.team]; c.lineWidth = 3; c.strokeRect(Math.max(8, Math.min(width - 45, px - 18)), Math.max(10, Math.min(620, py)), 36, 36);
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
        return { draw, reset: () => { seen = 0; particles = []; bursts = []; shake = 0; tracks.clear(); }, animations: () => [...tracks.values()].map(t => ({ action: t.action, phase: t.phase, contact: t.contact, character: t.character })) };
    }
    root.RIFT_RENDER = { create, sprite };
})(typeof window === 'undefined' ? globalThis : window);
