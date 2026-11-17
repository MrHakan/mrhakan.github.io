// kartz 98 (placeholder until the game lands)
(function () {
    'use strict';
    window.startKartz = function () {
        const app = createAppWindow('kartz 98', { icon: 'style', width: 420 });
        app.body.innerHTML = '<div class="bj-loading">kartz 98 is still being built.</div>';
        return app.win;
    };
    if (window.Netplay) Netplay.registerGame({ id: 'kartz', name: 'kartz 98', start: () => window.startKartz(), startSolo: () => window.startKartz(), soloLabel: 'play with bots' });
})();
