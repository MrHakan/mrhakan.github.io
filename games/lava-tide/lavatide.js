// lava & tide 98 (placeholder until the game lands)
(function () {
    'use strict';
    window.startLavaTide = function () {
        const app = createAppWindow('lava & tide 98', { icon: 'castle', width: 420 });
        app.body.innerHTML = '<div class="bj-loading">lava & tide 98 is still being built.</div>';
        return app.win;
    };
    if (window.Netplay) Netplay.registerGame({ id: 'lavatide', name: 'lava & tide 98', start: () => window.startLavaTide(), startSolo: () => window.startLavaTide(), soloLabel: 'play with bots' });
})();
