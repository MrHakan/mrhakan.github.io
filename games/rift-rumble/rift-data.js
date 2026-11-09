// Rift Rumble: pixels, seconds expressed as fixed 60 Hz ticks, and original fighters.
(function (root) {
    'use strict';
    root.RIFT = {
        TICK: 60, W: 1280, H: 720, STOCKS: 3, LIMIT: 180 * 60,
        GRAVITY: 0.48, JUMP: -11.8, RADIUS: 17, HEIGHT: 43,
        COLORS: ['#79eac7', '#ff967e'],
        FIGHTERS: [
            { id: 'cool', name: 'Joe Cool', kind: 'Shades / duelist', color: '#f5ce58', dark: '#a57832', light: '#fff0a0', outfit: '#34435e', speed: 5.1, weight: 0.95, reach: 65, power: 1, special: 'Shade throw', weapon: 'chain', projectile: { speed: 12, life: 48 }, reference: 'joe-cool-114.webp', tip: 'Too cool to respect the ledge.' },
            { id: 'think', name: 'Dusung', kind: 'Overthinker / zoner', color: '#eee9d6', dark: '#a7aba6', light: '#fffdf0', outfit: '#675f8b', speed: 4.1, weight: 1.22, reach: 77, power: 1.16, special: 'Question mark', weapon: 'cane', projectile: { speed: 5, life: 100, homing: true }, reference: 'dusung-288.webp', tip: 'He has considered every bad idea.' },
            { id: 'hot', name: 'Hothead', kind: 'Meltdown / rushdown', color: '#f2a843', dark: '#bf563d', light: '#ffe77b', outfit: '#c55747', speed: 5.5, weight: 0.87, reach: 58, power: 0.94, special: 'Overheat', weapon: 'fist', projectile: { speed: 11, life: 28, damage: 17, force: 7 }, reference: 'hot-40.webp', tip: 'The CPU temperature is personal.' },
            { id: 'baby', name: 'Bebetrol', kind: 'Tiny menace / trickster', color: '#e9ead9', dark: '#949d98', light: '#fffef2', outfit: '#7cb5bf', speed: 4.8, weight: 0.8, reach: 60, power: 0.9, special: 'Return to sender', weapon: 'mallet', projectile: { speed: 8, life: 85, returning: true }, reference: 'bebetrol.png', tip: 'Small hitbox energy. Huge problem.' },
            { id: 'cry', name: 'Zirlak', kind: 'Emotional damage / zoner', color: '#f6d76b', dark: '#bc8a44', light: '#fff2b2', outfit: '#6d9ad0', speed: 4.5, weight: 0.92, reach: 63, power: 0.96, special: 'Triple tears', weapon: 'tissue', projectile: { speed: 8, life: 62, spread: 3, damage: 5, force: 4.4 }, reference: 'zirlak.gif', tip: 'Every loss is a water feature.' },
            { id: 'smug', name: 'Hehe', kind: 'Bad intentions / duelist', color: '#e6e7d2', dark: '#9a9f8c', light: '#fffef0', outfit: '#8caa69', speed: 5.2, weight: 0.96, reach: 68, power: 0.98, special: 'Grin disc', weapon: 'knife', projectile: { speed: 9, life: 75, pierce: true }, reference: 'pffft.png', tip: 'The grin is legally binding.' },
            { id: 'confused', name: 'Nasiya', kind: 'Wait what / disruptor', color: '#f0eadb', dark: '#a69d96', light: '#fffdf5', outfit: '#aa7897', speed: 4.6, weight: 1.03, reach: 74, power: 1.02, special: 'Confusion bomb', weapon: 'plunger', projectile: { speed: 7, life: 78, gravity: 0.1, damage: 15 }, reference: 'nasiya.png', tip: 'Nobody knows. Especially him.' },
            { id: 'boss', name: 'Patron', kind: 'Management / heavyweight', color: '#f5eddf', dark: '#aaa197', light: '#ffffff', outfit: '#333f51', speed: 3.9, weight: 1.3, reach: 78, power: 1.2, special: 'Final notice', weapon: 'case', projectile: { speed: 6, life: 75, gravity: 0.075, damage: 17, force: 7.5 }, reference: 'patronedasiyla.png', tip: 'This meeting could have been a KO.' },
            { id: 'sleep', name: 'Sahur', kind: 'Sleep debt / control', color: '#eee8dc', dark: '#a39a98', light: '#fffbed', outfit: '#7777a8', speed: 4.3, weight: 1.1, reach: 72, power: 1.07, special: 'Pillow talk', weapon: 'pillow', projectile: { speed: 5.5, life: 95, damage: 9, force: 4.2, stun: 34 }, reference: 'sahurdudimi.png', tip: 'Running on two hours and bad news.' },
            { id: 'hype', name: 'Oleey', kind: 'Full volume / rushdown', color: '#f5d15e', dark: '#b88239', light: '#fff4a1', outfit: '#bc664d', speed: 5.7, weight: 0.85, reach: 59, power: 0.92, special: 'LET\'S GO', weapon: 'bat', dash: true, specialMelee: { duration: 48, startup: 6, active: 10, damage: 13, force: 6.7, stun: 19 }, reference: 'oleyy.png', tip: 'No inside voice. No brakes.' },
            { id: 'nope', name: 'Yeter', kind: 'Not today / counterpuncher', color: '#e7e7dd', dark: '#909e9a', light: '#fffef6', outfit: '#467f7d', speed: 4.4, weight: 1.18, reach: 80, power: 1.12, special: 'Fatal error', weapon: 'hammer', projectile: { speed: 7.5, life: 65, damage: 10, force: 8.2 }, reference: 'yeterartik.png', tip: 'You have performed an illegal operation.' },
            { id: 'pfft', name: 'Pffft', kind: 'Absolutely fine / bruiser', color: '#f2d36a', dark: '#b39446', light: '#fff2a5', outfit: '#7c9062', speed: 4.2, weight: 1.25, reach: 75, power: 1.15, special: 'Pressure release', weapon: 'gauntlet', projectile: { speed: 6, life: 50, damage: 14, force: 7.1, size: 19 }, reference: 'heh.png', tip: 'Just one more minor inconvenience.' }
        ],
        ARENAS: [
            { id: 'sky', name: 'The Taskbar', subtitle: 'End task? End friendship.', sky: ['#055e67', '#178c90', '#a2c8bc'], platforms: [{ x: 255, y: 524, w: 770, main: true }, { x: 327, y: 365, w: 190 }, { x: 763, y: 365, w: 190 }, { x: 551, y: 255, w: 178 }] },
            { id: 'moon', name: 'Recycle Rift', subtitle: 'Your last stock is not recoverable.', sky: ['#1c284d', '#526c91', '#91abae'], platforms: [{ x: 285, y: 530, w: 710, main: true }, { x: 345, y: 365, w: 220 }, { x: 715, y: 365, w: 220 }] },
            { id: 'sunset', name: 'Blue Screen', subtitle: 'A fatal exception has occurred.', sky: ['#000078', '#162d9e', '#486dc5'], platforms: [{ x: 225, y: 525, w: 830, main: true }, { x: 475, y: 365, w: 330 }] }
        ],
        ATTACKS: {
            light: { duration: 25, startup: 4, active: 7, damage: 8, force: 4.8, stun: 12 },
            heavy: { duration: 47, startup: 13, active: 9, damage: 18, force: 7.6, stun: 21 },
            special: { duration: 51, startup: 9, active: 1, damage: 12, force: 6, stun: 17 }
        }
    };
})(typeof window === 'undefined' ? globalThis : window);
