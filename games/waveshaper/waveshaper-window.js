// The desktop owns the titlebar, taskbar and fullscreen controls. The frame
// isolates the game's keyboard, canvas and styles from the rest of the desktop.
(function () {
    'use strict';
    window.startWaveShaper = function () {
        const existing = document.querySelector('.waveshaper-window');
        const running = existing?.querySelector('.waveshaper-frame');
        if (running) {
            existing.style.display = 'flex';
            existing.style.zIndex = ++ieHighestZ;
            running.contentWindow?.focus();
            return;
        }
        if (!document.getElementById('waveshaper-window-css')) {
            const style = document.createElement('link');
            style.id = 'waveshaper-window-css'; style.rel = 'stylesheet';
            style.href = 'games/waveshaper/waveshaper-window.css';
            document.head.appendChild(style);
        }
        const app = createAppWindow('waveshaper 98', { icon: 'monitoring', width: Math.min(980, viewportWidth() - 24) });
        app.win.classList.add('waveshaper-window');
        const frame = document.createElement('iframe');
        frame.className = 'waveshaper-frame';
        frame.title = 'WAVESHAPER 98 game';
        frame.src = 'games/waveshaper/?embed=1';
        frame.allow = 'autoplay; gamepad; fullscreen';
        frame.allowFullscreen = true;
        app.body.appendChild(frame);
        let hidden = false;
        const visibility = new MutationObserver(() => {
            const next = app.win.style.display === 'none';
            if (next === hidden) return;
            hidden = next;
            if (hidden) frame.contentWindow?.postMessage({ type: 'waveshaper-pause' }, location.origin);
            else frame.contentWindow?.focus();
        });
        visibility.observe(app.win, { attributes: true, attributeFilter: ['style'] });
        frame.addEventListener('load', () => {
            if (app.win.isConnected && !hidden) frame.contentWindow?.focus();
        });
        const cleanup = app.win._cleanup;
        app.win._cleanup = () => {
            visibility.disconnect();
            frame.remove(); // unload its audio, animation loop and gamepad poll immediately
            if (cleanup) cleanup();
        };
        return app;
    };
})();
