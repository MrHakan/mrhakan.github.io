// Rift Rumble: pixels, seconds expressed as fixed 60 Hz ticks, and original fighters.
(function (root) {
    'use strict';
    const moves = {
        cool: {
            light: { name: 'Chain snap', pose: 'thrust', reach: 65 },
            heavy: { name: 'Gold swing', pose: 'hook', reach: 85 }
        },
        think: {
            light: { name: 'Cane prod', pose: 'thrust', reach: 91, startup: 6, duration: 29, damage: 7 },
            heavy: { name: 'Question hook', pose: 'uppercut', reach: 92, startup: 15, duration: 48, lift: -.91 }
        },
        hot: {
            light: { name: 'Panic jab', pose: 'jab', reach: 55, startup: 3, active: 4, duration: 20 },
            heavy: { name: 'Meltdown uppercut', pose: 'uppercut', reach: 65, startup: 9, duration: 40, lift: -1.12 }
        },
        baby: {
            light: { name: 'Ankle tap', pose: 'sweep', reach: 60, startup: 4, duration: 22, damage: 6 },
            heavy: { name: 'Tantrum smash', pose: 'overhead', reach: 73, startup: 11, active: 8, duration: 39, lift: -.25 }
        },
        cry: {
            light: { name: 'Tissue flick', pose: 'jab', reach: 65, startup: 5, active: 6, duration: 24, damage: 7 },
            heavy: { name: 'Sobbing shove', pose: 'shove', reach: 76, startup: 12, duration: 45, force: 8.6, lift: -.35 }
        },
        smug: {
            light: { name: 'Sneak slash', pose: 'sweep', reach: 71, startup: 4, active: 5, duration: 23 },
            heavy: { name: 'Backhand cut', pose: 'hook', reach: 91, startup: 10, duration: 42, lift: -.4 }
        },
        confused: {
            light: { name: 'Plunger poke', pose: 'thrust', reach: 86, startup: 6, active: 5, duration: 27 },
            heavy: { name: 'Pipe sweep', pose: 'sweep', reach: 105, startup: 14, active: 11, duration: 50, lift: -.28 }
        },
        boss: {
            light: { name: 'Briefcase bump', pose: 'shove', reach: 72, startup: 6, duration: 29, force: 5.8 },
            heavy: { name: 'Case closed', pose: 'overhead', reach: 99, startup: 17, duration: 54, damage: 20, lift: -.38 }
        },
        sleep: {
            light: { name: 'Pillow swat', pose: 'hook', reach: 74, startup: 5, active: 9, duration: 28, force: 4.2 },
            heavy: { name: 'Bedtime push', pose: 'shove', reach: 89, startup: 12, active: 12, duration: 49, damage: 15, stun: 30 }
        },
        hype: {
            light: { name: 'Offbeat tap', pose: 'jab', reach: 58, startup: 3, active: 5, duration: 19, damage: 7 },
            heavy: { name: 'Bass swing', pose: 'hook', reach: 83, startup: 11, active: 10, duration: 43, lift: -.68 }
        },
        nope: {
            light: { name: 'Hammer check', pose: 'thrust', reach: 77, startup: 6, active: 6, duration: 28, stun: 15 },
            heavy: { name: 'Hard reset', pose: 'overhead', reach: 105, startup: 16, duration: 51, force: 8.7 }
        },
        pfft: {
            light: { name: 'Short fuse', pose: 'jab', reach: 69, startup: 5, active: 5, duration: 26, damage: 9 },
            heavy: { name: 'Pressure hook', pose: 'hook', reach: 91, startup: 14, duration: 48, damage: 20, lift: -.72 }
        }
    };
    const data = root.RIFT = {
        TICK: 60, W: 1280, H: 720, STOCKS: 3, LIMIT: 180 * 60,
        GRAVITY: 0.48, JUMP: -11.8, RADIUS: 17, HEIGHT: 43,
        COLORS: ['#79eac7', '#ff967e'],
        FIGHTERS: [
            { id: 'cool', name: 'Joe Cool', kind: 'Shades / duelist', color: '#f5ce58', dark: '#a57832', light: '#fff0a0', outfit: '#34435e', speed: 5.1, weight: 0.95, reach: 65, power: 1, special: 'Shade throw', weapon: 'chain', projectile: { speed: 12, life: 48 }, reference: 'joe-cool-114.webp', tip: 'Too cool to respect the ledge.' },
            { id: 'think', name: 'Dusung', kind: 'Overthinker / zoner', color: '#eee9d6', dark: '#a7aba6', light: '#fffdf0', outfit: '#675f8b', speed: 4.1, weight: 1.22, reach: 77, power: 1.16, special: 'Question mark', weapon: 'cane', projectile: { speed: 5, life: 100, homing: true }, reference: 'dusung-288.webp', tip: 'He has considered every bad idea.' },
            { id: 'hot', name: 'Hothead', kind: 'Meltdown / rushdown', color: '#f2a843', dark: '#bf563d', light: '#ffe77b', outfit: '#c55747', speed: 5.5, weight: 0.87, reach: 58, power: 0.94, special: 'Overheat', weapon: 'fist', projectile: { speed: 11, life: 28, damage: 17, force: 7 }, reference: 'hot-40.webp', tip: 'The CPU temperature is personal.' },
            { id: 'baby', name: 'Bebetrol', kind: 'Tiny menace / trickster', color: '#e9ead9', dark: '#949d98', light: '#fffef2', outfit: '#7cb5bf', speed: 4.8, weight: 0.8, reach: 60, power: 0.9, special: 'Return to sender', weapon: 'mallet', projectile: { speed: 8, life: 85, returning: true }, reference: 'bebetrol.png', tip: 'Small hitbox energy. Huge problem.' },
            { id: 'cry', name: 'Zirlak', kind: 'Emotional damage / zoner', color: '#f6d76b', dark: '#bc8a44', light: '#fff2b2', outfit: '#6d9ad0', speed: 4.5, weight: 0.92, reach: 63, power: 0.96, special: 'Triple tears', weapon: 'tissue', projectile: { speed: 8, life: 62, spread: 3, damage: 5, force: 4.4 }, reference: 'zirlak.gif', tip: 'Every loss is a water feature.' },
            { id: 'smug', name: 'Hehe', kind: 'Bad intentions / duelist', color: '#e6e7d2', dark: '#9a9f8c', light: '#fffef0', outfit: '#8caa69', speed: 5.2, weight: 0.96, reach: 68, power: 0.98, special: 'Grin pounce', weapon: 'knife', specialMelee: { pose: 'pounce', duration: 49, startup: 21, active: 11, reach: 85, damage: 15, force: 7.5, stun: 20, lift: .45 }, reference: 'pffft.png', tip: 'The grin is legally binding.' },
            { id: 'confused', name: 'Nasiya', kind: 'Wait what / disruptor', color: '#f0eadb', dark: '#a69d96', light: '#fffdf5', outfit: '#aa7897', speed: 4.6, weight: 1.03, reach: 74, power: 1.02, special: 'Confusion bomb', weapon: 'plunger', projectile: { speed: 7, life: 78, gravity: 0.1, damage: 15 }, reference: 'nasiya.png', tip: 'Nobody knows. Especially him.' },
            { id: 'boss', name: 'Patron', kind: 'Management / heavyweight', color: '#f5eddf', dark: '#aaa197', light: '#ffffff', outfit: '#333f51', speed: 3.9, weight: 1.3, reach: 78, power: 1.2, special: 'Final notice', weapon: 'case', projectile: { speed: 6, life: 75, gravity: 0.075, damage: 17, force: 7.5 }, reference: 'patronedasiyla.png', tip: 'This meeting could have been a KO.' },
            { id: 'sleep', name: 'Sahur', kind: 'Sleep debt / control', color: '#eee8dc', dark: '#a39a98', light: '#fffbed', outfit: '#7777a8', speed: 4.3, weight: 1.1, reach: 72, power: 1.07, special: 'Pillow talk', weapon: 'pillow', projectile: { speed: 5.5, life: 95, damage: 9, force: 4.2, stun: 34 }, reference: 'sahurdudimi.png', tip: 'Running on two hours and bad news.' },
            { id: 'hype', name: 'Oleey', kind: 'Full volume / rushdown', color: '#f5d15e', dark: '#b88239', light: '#fff4a1', outfit: '#bc664d', speed: 5.7, weight: 0.85, reach: 59, power: 0.92, special: 'LET\'S GO', weapon: 'bat', specialMelee: { pose: 'rush', duration: 48, startup: 6, active: 10, reach: 59, damage: 13, force: 6.7, stun: 19 }, reference: 'oleyy.png', tip: 'No inside voice. No brakes.' },
            { id: 'nope', name: 'Yeter', kind: 'Not today / counterpuncher', color: '#e7e7dd', dark: '#909e9a', light: '#fffef6', outfit: '#467f7d', speed: 4.4, weight: 1.18, reach: 80, power: 1.12, special: 'Fatal error', weapon: 'hammer', projectile: { speed: 7.5, life: 65, damage: 10, force: 8.2 }, reference: 'yeterartik.png', tip: 'You have performed an illegal operation.' },
            { id: 'pfft', name: 'Pffft', kind: 'Absolutely fine / bruiser', color: '#f2d36a', dark: '#b39446', light: '#fff2a5', outfit: '#7c9062', speed: 4.2, weight: 1.25, reach: 75, power: 1.15, special: 'Pressure release', weapon: 'gauntlet', projectile: { speed: 6, life: 50, damage: 14, force: 7.1, size: 19 }, reference: 'heh.png', tip: 'Just one more minor inconvenience.' }
        ],
        ARENAS: [
            { id: 'sky', name: 'The Taskbar', subtitle: 'End task? End friendship.', sky: ['#055e67', '#178c90', '#a2c8bc'], platforms: [{ x: 255, y: 524, w: 770, main: true }, { x: 327, y: 365, w: 190 }, { x: 763, y: 365, w: 190 }, { x: 551, y: 255, w: 178 }] },
            { id: 'moon', name: 'Recycle Rift', subtitle: 'Your last stock is not recoverable.', sky: ['#1c284d', '#526c91', '#91abae'], platforms: [{ x: 285, y: 530, w: 710, main: true }, { x: 345, y: 365, w: 220 }, { x: 715, y: 365, w: 220 }] },
            { id: 'sunset', name: 'Blue Screen', subtitle: 'A fatal exception has occurred.', sky: ['#000078', '#162d9e', '#486dc5'], platforms: [{ x: 225, y: 525, w: 830, main: true }, { x: 475, y: 365, w: 330 }] },
            {
                id: 'lan', name: 'LAN Party', mode: 2, width: 1520,
                sky: ['#082740', '#185864', '#6ba69e'], trim: '#15686c',
                tasks: ['Network Neighborhood', 'Shared Games', '4 players online'],
                platforms: [
                    { x: 160, y: 524, w: 1200, main: true },
                    { x: 235, y: 396, w: 280, label: 'Workstation A' },
                    { x: 1005, y: 396, w: 280, label: 'Workstation B' },
                    { x: 590, y: 286, w: 340, label: 'Ethernet Bridge' }
                ]
            },
            {
                id: 'defrag', name: 'Disk Defrag', mode: 2, width: 1520,
                sky: ['#251b45', '#5a397d', '#9884b9'], trim: '#65418d',
                tasks: ['Disk Defragmenter', 'Volume C:', 'Reorganizing clusters'],
                platforms: [
                    { x: 188, y: 524, w: 1144, main: true },
                    { x: 232, y: 418, w: 205, label: 'Cluster A' },
                    { x: 1083, y: 418, w: 205, label: 'Cluster D' },
                    { x: 505, y: 328, w: 214, label: 'Cluster B' },
                    { x: 801, y: 328, w: 214, label: 'Cluster C' }
                ]
            },
            {
                id: 'print', name: 'Print Queue', mode: 2, width: 1520,
                sky: ['#3b2645', '#795264', '#c08c7c'], trim: '#8a4b54',
                tasks: ['Printers', 'Queue Manager', 'Paper jam detected'],
                platforms: [
                    { x: 208, y: 524, w: 1104, main: true },
                    { x: 497, y: 391, w: 526, label: 'Paper Feed' },
                    { x: 320, y: 295, w: 200, label: 'Tray 1' },
                    { x: 1000, y: 295, w: 200, label: 'Tray 2' }
                ]
            }
        ],
        arenasFor(mode) {
            const size = Number(mode) === 2 ? 2 : 1;
            return data.ARENAS.filter(arena => (arena.mode ?? 1) === size);
        },
        arenaFor(mode, id) {
            const arenas = data.arenasFor(mode);
            return arenas.find(arena => arena.id === id) || arenas[0];
        },
        attackFor(character, kind, dir = 'side') {
            const fighter = data.FIGHTERS[character] || data.FIGHTERS[0];
            if (kind === 'special' && dir === 'up') return data.ATTACKS.special;
            return fighter.moves[kind];
        },
        ATTACKS: {
            light: { duration: 25, startup: 4, active: 7, damage: 8, force: 4.8, stun: 12 },
            heavy: { duration: 47, startup: 13, active: 9, damage: 18, force: 7.6, stun: 21 },
            special: { duration: 51, startup: 9, active: 1, damage: 12, force: 6, stun: 17 }
        }
    };
    for (const fighter of data.FIGHTERS) {
        const profile = moves[fighter.id];
        fighter.moves = {
            light: { ...data.ATTACKS.light, ...profile.light },
            heavy: { ...data.ATTACKS.heavy, ...profile.heavy },
            special: { ...data.ATTACKS.special, name: fighter.special, reach: fighter.reach, ...fighter.specialMelee }
        };
    }
})(typeof window === 'undefined' ? globalThis : window);
