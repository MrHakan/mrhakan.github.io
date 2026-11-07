// ===================================================================
// lazy.js — a window nobody has opened does not need to be downloaded
//
// The start menu has a hundred things in it and most visits open two. So the
// arcade, the toys, the defragmenter and my documents stay on the server until
// somebody asks for one, the way the big games always have.
//
// The rest of the site does not know. Every name below exists from the start
// as a stand-in carrying the real function's name, so the start menu, the run
// box, find: and the address bar call it the way they always did. It fetches
// the script, whose own declaration replaces the stand-in, then calls the real
// thing. This file loads first so that nothing can ask before it is here.
//
// Only functions that are called and not read can go in the table, because the
// answer arrives after the caller has moved on. check-startup.mjs fails if a
// name here is not declared by its file, and if a file here is also loaded by
// a script tag.
// ===================================================================

const LAZY = (function () {
    'use strict';

    const MODULES = {
        'js/arcade.js': ['openTicTacToe', 'openRPS', 'openHangman', 'openSimon', 'open2048',
            'openTetris', 'openBreakout', 'openWhack'],
        'js/toys.js': ['openPet', 'toggleNeko', 'openBlinkieMaker', 'openStampShelf', 'openAwards',
            'openDirectory', 'openScanDisk', 'openSetup', 'openMoreRam', 'openVirusScan',
            'openNetworkPassword', 'openSoundBoard', 'openMoon', 'openWorldClock', 'openBiorhythm',
            'openLoveCalc', 'openCowsay', 'openDice', 'surpriseMe', 'openRating',
            'toggleStatusScroller', 'toggleCursorTrail'],
        'js/defrag.js': ['openDefrag'],
        'js/documents.js': ['openDocuments'],
        'js/trophies.js': ['openTrophies']
    };

    // how long somebody has to stay before the offline copies are worth fetching
    const WARM_AFTER_MS = 15000;

    const scripts = {};
    function load(src, opts) {
        if (scripts[src]) return scripts[src];
        return (scripts[src] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            if (opts && opts.low) s.fetchPriority = 'low';
            s.onload = resolve;
            // forgotten, so the next try is a real try: the cable might be back
            s.onerror = () => { delete scripts[src]; s.remove(); reject(new Error(src)); };
            document.head.appendChild(s);
        }));
    }

    const opening = {};
    function standIn(name, src) {
        // a computed method so it is named what it stands in for: js/web.js
        // finds its routes by reading .name off the action table
        return { [name](...args) {
            // a second click while the first is still downloading is the same click
            if (opening[name]) return;
            opening[name] = true;
            // if this came from the start menu, js/web.js is in the middle of
            // opening a route, and will have finished long before the script arrives
            const route = window.WEB ? WEB.pendingRoute() : null;
            const root = document.documentElement;
            root.classList.add('lazy-loading');
            load(src).then(() => {
                if (window.WEB) WEB.routeDirectCalls();
                const launch = () => window[name].apply(window, args);
                return window.WEB ? WEB.withRoute(route, launch) : launch();
            }, () => {
                if (typeof showToast === 'function') showToast('windows', navigator.onLine === false
                    ? 'you are offline, and this one was never saved for offline. open it once with the cable in.'
                    : 'could not load that bradar. check the cable?');
            }).finally(() => {
                delete opening[name];
                root.classList.remove('lazy-loading');
            });
        } }[name];
    }

    Object.keys(MODULES).forEach(src => MODULES[src].forEach(name => {
        window[name] = standIn(name, src);
    }));

    // Ask the service worker to fetch the on-demand files for offline use, but
    // only once somebody has stayed, and not on a connection that said to save data.
    window.addEventListener('load', () => setTimeout(() => {
        const c = navigator.connection;
        if (!navigator.serviceWorker || (c && (c.saveData || /2g/.test(c.effectiveType)))) return;
        navigator.serviceWorker.ready.then(reg => { if (reg.active) reg.active.postMessage('warm'); });
    }, WARM_AFTER_MS));

    return { load, MODULES };
})();

window.LAZY = LAZY;
