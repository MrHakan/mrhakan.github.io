// The desktop owns the titlebar, taskbar and fullscreen controls. The frame
// isolates the game's keyboard, canvas and styles from the rest of the desktop.
(function () {
    'use strict';
    window.startHarborMaster = function () {
        const existing = document.querySelector('.harbor-window');
        const running = existing?.querySelector('.harbor-frame');
        if (running) {
            existing.style.display = 'flex';
            existing.style.zIndex = ++ieHighestZ;
            running.contentWindow?.focus();
            return;
        }
        if (!document.getElementById('harbor-window-css')) {
            const style = document.createElement('link');
            style.id = 'harbor-window-css'; style.rel = 'stylesheet';
            style.href = 'games/harbor-master/harbor-window.css';
            document.head.appendChild(style);
        }
        const app = createAppWindow('harbor master 98', { icon: 'anchor', width: Math.min(980, viewportWidth() - 24) });
        app.win.classList.add('harbor-window');
        const frame = document.createElement('iframe');
        frame.className = 'harbor-frame';
        frame.title = 'Harbor Master 98 game';
        frame.src = 'games/harbor-master/?embed=1';
        frame.allow = 'fullscreen';
        frame.allowFullscreen = true;
        app.body.appendChild(frame);
        let hidden = false;
        // a minimised window pauses the watch, the same as a hidden tab
        const visibility = new MutationObserver(() => {
            const next = app.win.style.display === 'none';
            if (next === hidden) return;
            hidden = next;
            if (hidden) frame.contentWindow?.postMessage({ type: 'harbor-pause' }, location.origin);
            else frame.contentWindow?.focus();
        });
        visibility.observe(app.win, { attributes: true, attributeFilter: ['style'] });
        frame.addEventListener('load', () => {
            if (app.win.isConnected && !hidden) frame.contentWindow?.focus();
        });
        const cleanup = app.win._cleanup;
        app.win._cleanup = () => {
            visibility.disconnect();
            frame.remove(); // stop its animation loop immediately
            if (cleanup) cleanup();
        };
        return app;
    };
})();
