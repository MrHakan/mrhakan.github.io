// popz 98 (placeholder until the game lands)
(function () {
    'use strict';
    window.startPopz = function () {
        const app = createAppWindow('popz 98', { icon: 'celebration', width: 420 });
        app.body.innerHTML = '<div class="bj-loading">popz 98 is still being built.</div>';
        return app.win;
    };
    if (window.Netplay) Netplay.registerGame({ id: 'popz', name: 'popz 98', start: () => window.startPopz(), startSolo: () => window.startPopz(), soloLabel: 'play with bots' });
})();
