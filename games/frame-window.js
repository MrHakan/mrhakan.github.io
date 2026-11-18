// One popup for every framed single player game: the desktop owns the
// titlebar, taskbar and fullscreen; the iframe isolates the game's keyboard,
// canvas and styles. A game page reads ?embed=1 (hides its own chrome) and
// pauses on {type: 'game-pause'} when the window is minimised.
(function () {
    'use strict';
    function ensureCss() {
        if (document.getElementById('frame-window-css')) return;
        const style = document.createElement('link');
        style.id = 'frame-window-css'; style.rel = 'stylesheet';
        style.href = 'games/frame-window.css';
        document.head.appendChild(style);
    }
    window.startFramedGame = function (g) {
        const cls = 'framed-' + g.key + '-window';
        const existing = document.querySelector('.' + cls);
        const running = existing?.querySelector('.framed-game');
        if (running) {
            existing.style.display = 'flex';
            existing.style.zIndex = ++ieHighestZ;
            running.contentWindow?.focus();
            return existing;
        }
        ensureCss();
        const app = createAppWindow(g.title, { icon: g.icon, width: Math.min(g.width || 960, viewportWidth() - 24) });
        app.win.classList.add('framed-window', cls);
        const frame = document.createElement('iframe');
        frame.className = 'framed-game';
        frame.title = g.title + ' game';
        frame.src = g.src + '?embed=1';
        frame.allow = 'fullscreen';
        frame.allowFullscreen = true;
        app.body.appendChild(frame);
        let hidden = false;
        const visibility = new MutationObserver(() => {
            const next = app.win.style.display === 'none';
            if (next === hidden) return;
            hidden = next;
            if (hidden) frame.contentWindow?.postMessage({ type: 'game-pause' }, location.origin);
            else frame.contentWindow?.focus();
        });
        visibility.observe(app.win, { attributes: true, attributeFilter: ['style'] });
        frame.addEventListener('load', () => {
            if (app.win.isConnected && !hidden) frame.contentWindow?.focus();
        });
        const cleanup = app.win._cleanup;
        app.win._cleanup = () => {
            visibility.disconnect();
            frame.remove(); // stops the game loop at once
            if (cleanup) cleanup();
        };
        return app.win;
    };
})();
