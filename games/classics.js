// Old internet classics (2000-2010), loaded on first use so the desktop's boot
// scripts stay inside their budget. Online games load through the lobby like
// tankz; single player games run in a framed page (games/frame-window.js).
(function () {
'use strict';
const NET_CLASSICS = {
    okey: { title: 'okey 98', icon: 'calculate', start: 'startOkey', loading: 'shuffling the tiles...' },
    kartz: { title: 'kartz 98', icon: 'style', start: 'startKartz', loading: 'dealing the cards...' },
    tavla: { title: 'tavla 98', icon: 'casino', start: 'startTavla', loading: 'setting up the board...' },
    lavatide: { title: 'lava & tide 98', icon: 'castle', start: 'startLavaTide', loading: 'lighting the temple...' },
    popz: { title: 'popz 98', icon: 'celebration', start: 'startPopz', loading: 'inflating the bubbles...' }
};
function openNetClassic(id) {
    const g = NET_CLASSICS[id];
    if (window[g.start]) { window[g.start](); return; }
    const { body, win } = createAppWindow(g.title, { icon: g.icon, width: 320 });
    body.innerHTML = '<div class="bj-loading">' + g.loading + '</div>';
    npLoadScripts().then(() => Netplay.loadGame(id)).then(() => {
        replaceLazyWindow(win, () => window[g.start]());
    }).catch(() => { body.innerHTML = lazyFail(g.title + ' would not load. try again?'); });
}
const FRAMED_CLASSICS = {
    goldclaw: { key: 'goldclaw', title: 'gold claw 98', icon: 'star', src: 'games/gold-claw/', loading: 'lowering the claw...' },
    pizzashift: { key: 'pizzashift', title: 'pizza shift 98', icon: 'schedule', src: 'games/pizza-shift/', loading: 'heating the oven...' },
    learntoglide: { key: 'learntoglide', title: 'learn to glide 98', icon: 'rocket_launch', src: 'games/learn-to-glide/', loading: 'waxing the ramp...' },
    blockroll: { key: 'blockroll', title: 'block roll 98', icon: 'flag', src: 'games/block-roll/', loading: 'stacking the tiles...' },
    deepdrill: { key: 'deepdrill', title: 'deep drill 98', icon: 'storage', src: 'games/deep-drill/', loading: 'fuelling the drill...' }
};
function openFramedClassic(key) {
    const g = FRAMED_CLASSICS[key];
    if (window.startFramedGame) { startFramedGame(g); return; }
    const { body, win } = createAppWindow(g.title, { icon: g.icon, width: 320 });
    body.innerHTML = '<div class="bj-loading">' + g.loading + '</div>';
    LAZY.load('games/frame-window.js').then(() => {
        replaceLazyWindow(win, () => startFramedGame(g));
    }).catch(() => { body.innerHTML = lazyFail(g.title + ' would not open. try again?'); });
}

window.openClassicNow = key => (NET_CLASSICS[key] ? openNetClassic : openFramedClassic)(key);
})();
