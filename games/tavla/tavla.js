// tavla 98 (placeholder until the game lands)
(function () {
    'use strict';
    window.startTavla = function () {
        const app = createAppWindow('tavla 98', { icon: 'casino', width: 420 });
        app.body.innerHTML = '<div class="bj-loading">tavla 98 is still being built.</div>';
        return app.win;
    };
    if (window.Netplay) Netplay.registerGame({ id: 'tavla', name: 'tavla 98', start: () => window.startTavla(), startSolo: () => window.startTavla(), soloLabel: 'play with bots' });
})();
