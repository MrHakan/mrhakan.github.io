// okey 98 (placeholder until the game lands)
(function () {
    'use strict';
    window.startOkey = function () {
        const app = createAppWindow('okey 98', { icon: 'calculate', width: 420 });
        app.body.innerHTML = '<div class="bj-loading">okey 98 is still being built.</div>';
        return app.win;
    };
    if (window.Netplay) Netplay.registerGame({ id: 'okey', name: 'okey 98', start: () => window.startOkey(), startSolo: () => window.startOkey(), soloLabel: 'play with bots' });
})();
