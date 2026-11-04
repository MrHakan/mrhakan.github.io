// ===================================================================
// scale.js — a big screen gets the same desktop, bigger
//
// The desktop was laid out for about 1707x960, which is what a 2560x1440
// screen is at 150% in the browser. At 100% on that screen it sits in the
// middle looking small, and the fix was to press ctrl+plus. So the page does
// it: the viewport is measured, and the scale is whatever brings it down to
// that size, never below 1. Somebody already at 150% measures 1707 wide, gets
// a scale of 1, and does not grow twice. A phone never gets one at all.
//
// The fit itself is in a small inline script in the head of each page, because
// it has to land before the first paint. check-startup.mjs holds the copies to
// the same text. This file does everything that can wait for the parser.
//
// Why css zoom, measured in chromium, firefox and webkit:
//
//   transform: scale on the root is a containing block for everything fixed,
//   so "inset: 0" came out 3000x0 on a 2000x1000 window and the page scrolled
//   sideways. Pixel sizes in rem would miss most of style.css, which is px.
//   zoom gives a real layout, and fixed things still fill the screen.
//
// What zoom does not do is tell javascript. A mouse still reports real pixels
// and style.left is still read in zoomed ones, so a dragged window ran away
// from the cursor at 1.5x, in thirty files' worth of mouse code. So this tells
// the page what a browser at that zoom would have told it: the same numbers,
// from the same names. The site already works at 150% in the browser, which
// makes that the one state nothing here had to be rewritten for.
//
// Viewport units are the other half. Under zoom 100vh is taller than the screen
// in chromium and firefox, and is not in webkit, so the head script measures it
// and style.css divides by the answer: calc(100vh / var(--z, 1)). check-startup
// fails on a bare one.
// ===================================================================

const SCALE = (function () {
    'use strict';

    const fit = window.siteFit;
    let z = 1;          // what the page is zoomed by
    let k = 1;          // what a rect has to be divided by, which webkit has already done

    // WebIDL puts these on the window in some engines and its prototype in others
    function descriptor(obj, name) {
        for (let o = obj; o; o = Object.getPrototypeOf(o)) {
            const d = Object.getOwnPropertyDescriptor(o, name);
            if (d) return d;
        }
        return null;
    }
    const realWidth = descriptor(window, 'innerWidth').get;
    const realHeight = descriptor(window, 'innerHeight').get;

    function divide(proto, names) {
        names.forEach(name => {
            const d = Object.getOwnPropertyDescriptor(proto, name);
            if (!d || !d.get) return;
            Object.defineProperty(proto, name, {
                configurable: true,
                enumerable: d.enumerable,
                // an event the page made itself is already in the page's numbers
                get() {
                    const v = d.get.call(this);
                    return z === 1 || this.isTrusted === false ? v : v / z;
                }
            });
        });
    }

    let installed = false;
    function install() {
        if (installed) return;
        installed = true;

        [Element.prototype, Range.prototype].forEach(proto => {
            const box = proto.getBoundingClientRect, boxes = proto.getClientRects;
            const scaled = r => new DOMRect(r.x / k, r.y / k, r.width / k, r.height / k);
            proto.getBoundingClientRect = function () {
                const r = box.call(this);
                return k === 1 ? r : scaled(r);
            };
            proto.getClientRects = function () {
                const list = boxes.call(this);
                return k === 1 ? list : Array.from(list, scaled);
            };
        });

        divide(MouseEvent.prototype, ['clientX', 'clientY', 'pageX', 'pageY', 'x', 'y',
            'offsetX', 'offsetY', 'movementX', 'movementY']);
        // a laptop with a touchscreen has a mouse as its main pointer, so it gets here
        if (window.Touch) divide(Touch.prototype, ['clientX', 'clientY', 'pageX', 'pageY']);

        Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => Math.round(realWidth.call(window) / z) });
        Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => Math.round(realHeight.call(window) / z) });

        // only the root's: every other element already answers in zoomed pixels
        const root = document.documentElement;
        ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'].forEach(name => {
            const d = descriptor(root, name);
            Object.defineProperty(root, name, { configurable: true, get() { return Math.round(d.get.call(root) / z); } });
        });

        // a canvas that sizes itself by this stays sharp, as it does at 150%
        const dpr = descriptor(window, 'devicePixelRatio');
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr.get.call(window) * z });

        // these take the same numbers the mouse now reports, and want real ones
        ['elementFromPoint', 'elementsFromPoint'].forEach(name => {
            const f = Document.prototype[name];
            if (f) Document.prototype[name] = function (x, y) { return f.call(this, x * z, y * z); };
        });
    }

    function refit() {
        z = fit(realWidth.call(window), realHeight.call(window));
        k = fit.rectFactor;
        if (z > 1) install();
    }

    // First in the queue for every resize, because this file loads before
    // anything else that listens: they all measure after the scale has moved.
    window.addEventListener('resize', refit);
    window.addEventListener('pageshow', refit);
    refit();

    return {
        get scale() { return z; },
        enabled() {
            try { return localStorage.getItem('site-scale') !== 'off'; } catch (e) { return true; }
        },
        setEnabled(on) {
            try { localStorage.setItem('site-scale', on ? 'on' : 'off'); } catch (e) { /* this visit, then */ }
            // no real resize comes with this one, and canvases size themselves on it
            window.dispatchEvent(new Event('resize'));
        }
    };
})();

window.SCALE = SCALE;
