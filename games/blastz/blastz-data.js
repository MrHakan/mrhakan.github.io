// blastz 98: tuning, guns, perks and maps. Pixels and 60 Hz ticks.
// Nobody has health here. A hit pushes you; enough pushes and you fall off.
(function (root) {
    'use strict';
    const data = root.BLASTZ = {
        TICK: 60, W: 1280, H: 720, FIGHTERS: 12,
        GRAVITY: 0.42, MAX_FALL: 12, JUMP: -10.2, AIR_JUMP: -9.3,
        RUN: 3.7, ACCEL: 0.7, AIR_ACCEL: 0.36,
        BOX_W: 28, BOX_H: 54,
        // fall past these and a life is gone
        BLAST: { left: -240, right: 1520, top: -520, bottom: 880 },
        COUNTDOWN: 180, RESPAWN: 100, SHIELD_AFTER_SPAWN: 150,
        CREDIT: 360,                // a hit within this many ticks gets the KO
        OVERTIME: 3 * 60 * 60,      // after three minutes everything pushes harder
        CRATE_EVERY: [150, 260], CRATE_MAX: 3, CRATE_LIFE: 1100,
        GRENADES: 2,
        LIVES: [3, 5, 10],
        BOT_NAMES: ['clippy', 'dialup', 'bonzi', 'winamp'],
        COLORS: ['#ffd447', '#5ed2ff', '#ff7a6b', '#8dee7a'],
        TEAM_COLORS: ['#79eac7', '#ff967e'],
        TEAM_NAMES: ['mint', 'coral'],

        // Every gun is held down to fire. `knock` is what a bullet does to the
        // one it hits, `recoil` what each shot does to the shooter.
        WEAPONS: [
            { id: 'pea', name: 'pea shooter', blurb: 'the one you always have', rate: 19, mag: 12, clips: -1, reload: 55, speed: 18, knock: 5.61, recoil: 0.42, spread: 0.015, life: 61, weight: 0, color: '#fff1a8', size: 3, gun: [14, 7, '#8a94a8'] },
            { id: 'cannon', name: 'hand cannon', blurb: 'six big shoves', rate: 35, mag: 6, clips: 3, reload: 74, speed: 23.04, knock: 12.24, recoil: 2.89, spread: 0.01, life: 61, weight: 10, color: '#ffcf6a', size: 5, gun: [20, 9, '#5f5a73'] },
            { id: 'buzz', name: 'buzz box', blurb: 'a lot of small shoves', rate: 6, mag: 30, clips: 3, reload: 76, speed: 18.72, knock: 2.04, recoil: 0.38, spread: 0.075, life: 47, weight: 12, color: '#bdf6ff', size: 2.5, gun: [20, 8, '#3f4d5c'] },
            { id: 'sheet', name: 'spread sheet', blurb: 'six pellets, short reach', rate: 50, mag: 5, clips: 3, reload: 80, speed: 17.28, knock: 3.19, recoil: 4.67, spread: 0.2, pellets: 6, life: 24, weight: 11, color: '#d4ffb0', size: 3, gun: [28, 8, '#6b4a33'] },
            { id: 'ldc', name: 'long distance call', blurb: 'one slow line, one long flight', rate: 70, mag: 4, clips: 3, reload: 92, speed: 46.08, knock: 18.49, recoil: 3.74, spread: 0, life: 42, weight: 7, color: '#ff8fd2', size: 3, sight: true, gun: [36, 7, '#2d3a2f'] },
            { id: 'spin', name: 'spin cycle', blurb: 'winds up, then never stops', rate: 4, mag: 120, clips: 1, reload: 103, spin: 38, speed: 19.44, knock: 1.6, recoil: 0.59, spread: 0.11, life: 44, weight: 6, slow: 0.6, color: '#ffe08a', size: 2.5, gun: [30, 12, '#4c4c55'] },
            { id: 'autosave', name: 'auto save', blurb: 'steady and dependable', rate: 10, mag: 24, clips: 3, reload: 69, speed: 21.6, knock: 4.21, recoil: 0.77, spread: 0.03, life: 56, weight: 12, color: '#a8f0ff', size: 3, gun: [26, 8, '#43505f'] },
            { id: 'triple', name: 'triple click', blurb: 'three at a time', rate: 32, burst: 3, gap: 5, mag: 27, clips: 3, reload: 69, speed: 22.32, knock: 5.1, recoil: 0.94, spread: 0.02, life: 56, weight: 10, color: '#c9b6ff', size: 3, gun: [25, 9, '#5a4d78'] },
            { id: 'delete', name: 'delete key', blurb: 'a rocket. it blows up', rate: 78, mag: 3, clips: 2, reload: 92, speed: 9, knock: 5.1, recoil: 5.52, spread: 0, life: 153, weight: 6, color: '#ff6d4d', size: 6, rocket: true, blast: { radius: 120, knock: 12.75 }, gun: [32, 12, '#6b2f2f'] },
            { id: 'zip', name: 'zip launcher', blurb: 'lobs bombs that pop on contact', rate: 55, mag: 4, clips: 2, reload: 86, speed: 7.2, knock: 3.82, recoil: 2.55, spread: 0, life: 167, weight: 6, color: '#7cff8e', size: 6, lob: true, blast: { radius: 105, knock: 10.62 }, gun: [26, 12, '#2f5b37'] }
        ],
        BOMB: { fuse: 110, radius: 120, knock: 12, throwX: 4.4, throwY: -5.6 },
        ITEMS: [
            { id: 'firewall', name: 'firewall', blurb: 'nothing pushes you for 6 s', time: 360 },
            { id: 'bombs', name: 'zip bombs', blurb: '+3 bombs' },
            { id: 'turbo', name: 'turbo button', blurb: 'faster and higher for 8 s', time: 480 }
        ],
        PERKS: [
            { id: 'spring', name: 'spring boots', blurb: 'a third jump' },
            { id: 'anchor', name: 'heavy boots', blurb: 'pushed 30% less, a bit slower' },
            { id: 'steady', name: 'steady hands', blurb: 'no recoil, tighter spread' },
            { id: 'bigmag', name: 'big mag', blurb: 'half again the ammo, faster reloads' },
            { id: 'bomber', name: 'bomb bag', blurb: 'four bombs, bigger blasts' },
            { id: 'turbo', name: 'turbo', blurb: '15% faster on foot' }
        ],

        // Thin platforms only: jump up through any of them, hold down to drop.
        MAPS: [
            {
                id: 'start', name: 'the start menu', blurb: 'climb the program list',
                sky: ['#0b3b74', '#1a6ab0', '#78b6e3'], plat: '#c0c0c0', edge: '#ffffff', shade: '#404040',
                spawns: [[400, 120], [880, 120], [640, 60], [520, 220]],
                platforms: [
                    { x: 300, y: 560, w: 680, label: 'Start' }, { x: 180, y: 430, w: 300, label: 'Programs' },
                    { x: 800, y: 430, w: 300, label: 'Documents' }, { x: 470, y: 320, w: 340, label: 'Settings' },
                    { x: 230, y: 210, w: 220, label: 'Find' }, { x: 830, y: 210, w: 220, label: 'Run...' }
                ]
            },
            {
                id: 'board', name: 'the motherboard', blurb: 'long traces, a gap in the middle',
                sky: ['#06231a', '#0c4a35', '#2b7d5a'], plat: '#2fa36b', edge: '#a8ffcf', shade: '#0b3d27',
                spawns: [[330, 150], [950, 150], [640, 120], [640, 250]],
                platforms: [
                    { x: 150, y: 540, w: 420, label: 'PCI 1' }, { x: 710, y: 540, w: 420, label: 'PCI 2' },
                    { x: 520, y: 430, w: 240, label: 'CPU' }, { x: 200, y: 330, w: 260, label: 'RAM' },
                    { x: 820, y: 330, w: 260, label: 'RAM' }, { x: 545, y: 230, w: 190, label: 'BIOS' }
                ]
            },
            {
                id: 'tower', name: 'dial-up tower', blurb: 'a tall antenna, short ledges',
                sky: ['#2b1446', '#5a2d7c', '#c06f8d'], plat: '#d8c7a0', edge: '#fff4d6', shade: '#5a4a35',
                spawns: [[640, 60], [470, 160], [810, 160], [640, 300]],
                platforms: [
                    { x: 420, y: 590, w: 440, label: '56k' }, { x: 230, y: 480, w: 210, label: 'COM1' },
                    { x: 840, y: 480, w: 210, label: 'COM2' }, { x: 520, y: 380, w: 240, label: 'modem' },
                    { x: 330, y: 270, w: 170, label: 'ping' }, { x: 780, y: 270, w: 170, label: 'pong' },
                    { x: 565, y: 170, w: 150, label: 'antenna' }
                ]
            },
            {
                id: 'mines', name: 'the minefield', blurb: 'small squares, nothing safe',
                sky: ['#16161c', '#2c2c36', '#454552'], plat: '#c0c0c0', edge: '#ffffff', shade: '#6b6b6b',
                spawns: [[300, 120], [980, 120], [640, 100], [640, 260]],
                platforms: [
                    { x: 200, y: 560, w: 200, label: '1' }, { x: 540, y: 560, w: 200, label: '2' }, { x: 880, y: 560, w: 200, label: '1' },
                    { x: 360, y: 450, w: 160, label: '3' }, { x: 760, y: 450, w: 160, label: '1' },
                    { x: 160, y: 340, w: 170, label: '2' }, { x: 555, y: 340, w: 170, label: '1' }, { x: 950, y: 340, w: 170, label: '2' },
                    { x: 380, y: 230, w: 150, label: '1' }, { x: 750, y: 230, w: 150, label: '3' }
                ]
            }
        ],
        weapon(id) { return data.WEAPONS.find(w => w.id === id) || data.WEAPONS[0]; },
        map(id) { return data.MAPS.find(m => m.id === id) || data.MAPS[0]; },
        perk(id) { return data.PERKS.find(p => p.id === id) ? id : data.PERKS[0].id; },
        lives(n) { n = Number(n); return data.LIVES.includes(n) ? n : 5; },
        count(n) { n = Number(n); return n >= 2 && n <= 4 ? Math.floor(n) : 4; }
    };
})(typeof window === 'undefined' ? globalThis : window);
