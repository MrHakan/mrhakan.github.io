// ===================================================================
// touch.js — the site on a phone
//
// Half the games here were built for a keyboard. Echoes of the Tide is
// walked with the arrow keys, snake is steered with them, minesweeper
// puts flags down with a right click. On a touchscreen none of that
// exists, so those games were not hard on a phone — they were
// unplayable, which is a different thing.
//
// This is the layer that fixes it: a real answer to "is this a touch
// device", an on-screen pad that emits exactly what the keyboard emits
// so games keep one code path, and a long press for the right click a
// finger does not have.
//
// On detection: `innerWidth < 768` is not it. A narrow desktop window
// is not a phone, a tablet in landscape is not a desktop, and a laptop
// with a touchscreen is both. `pointer: coarse` asks the question that
// is actually being asked — is the thing pointing at this screen a
// fingertip — and it answers live, so plugging a mouse into a tablet
// puts the pad away.
// ===================================================================

(function () {
    'use strict';

    const DIRS = ['up', 'down', 'left', 'right'];
    const listeners = [];

    // ---------- is this a finger ----------
    const coarseQuery = () => (window.matchMedia ? window.matchMedia('(pointer: coarse)') : null);
    function coarse() {
        const q = coarseQuery();
        if (q && typeof q.matches === 'boolean') return q.matches;
        // a browser with no matchMedia: fall back to whether a touch has ever
        // been possible, which is the next most honest question
        return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    }
    // How wide the page actually is, in the pixels css is measured in.
    //
    // Not window.innerWidth. On a phone, if anything on the page is wider
    // than the screen — one unsized image is enough — the browser widens the
    // layout viewport to fit it, and innerWidth widens with it. Measured on
    // a 412px phone with one oversized image on the page, innerWidth read
    // 1648 while the screen was still 412, which is how app windows ended up
    // positioned off the side of the display. documentElement.clientWidth is
    // the layout viewport by definition and agrees with the media queries.
    const viewportWidth = () =>
        (document.documentElement && document.documentElement.clientWidth) || window.innerWidth || 0;

    // and whether it is a *small* screen, which is a separate question — a
    // desk tablet is coarse and roomy, a phone is coarse and cramped
    const narrow = () => viewportWidth() < 700;

    function onChange(fn) {
        listeners.push(fn);
        return () => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
        };
    }
    function announce() {
        const state = { coarse: coarse(), narrow: narrow() };
        for (const fn of listeners.slice()) { try { fn(state); } catch (e) { } }
        document.documentElement.classList.toggle('is-touch', state.coarse);
        document.documentElement.classList.toggle('is-narrow', state.narrow);
    }
    {
        const q = coarseQuery();
        if (q && q.addEventListener) q.addEventListener('change', announce);
        else if (q && q.addListener) q.addListener(announce);
        window.addEventListener('resize', announce);
        // the class goes on before anything asks, so css can lean on it
        if (document.documentElement) announce();
    }

    // ---------- the pad ----------
    // Emits held directions and button taps. A game wires it to whatever its
    // keyboard handler already does, so there is one set of rules and the
    // pad is only another way of pressing the same keys.
    //
    // opts: {
    //   onDir(dir, isDown)   a direction went down or came up
    //   buttons: [{ label, title, onPress, onRelease }]
    //   always                mount even on a mouse (for testing)
    // }
    function pad(host, opts) {
        const o = opts || {};
        if (!host) return null;
        if (!o.always && !coarse()) return null;

        const root = document.createElement('div');
        root.className = 'tp-pad';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', 'on-screen controls');

        const dpad = document.createElement('div');
        dpad.className = 'tp-dpad';
        const GLYPH = { up: '▲', down: '▼', left: '◀', right: '▶' };
        const keys = {};
        for (const dir of DIRS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tp-key tp-' + dir;
            b.dataset.dir = dir;
            b.textContent = GLYPH[dir];
            b.setAttribute('aria-label', dir);
            keys[dir] = b;
            dpad.appendChild(b);
        }
        root.appendChild(dpad);

        const acts = document.createElement('div');
        acts.className = 'tp-acts';
        for (const spec of (o.buttons || [])) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'tp-btn';
            b.textContent = spec.label;
            if (spec.title) { b.title = spec.title; b.setAttribute('aria-label', spec.title); }
            b._spec = spec;
            acts.appendChild(b);
        }
        if (acts.children.length) root.appendChild(acts);

        // Pointer events, captured, so a finger that slides off a key still
        // sends the release — otherwise the diver walks into a wall forever.
        const held = {};
        function setDir(dir, down) {
            if (!dir || held[dir] === down) return;
            held[dir] = down;
            keys[dir] && keys[dir].classList.toggle('down', down);
            if (o.onDir) { try { o.onDir(dir, down); } catch (e) { } }
        }
        function releaseAll() { for (const d of DIRS) setDir(d, false); }

        function down(e) {
            const key = e.target.closest('.tp-key, .tp-btn');
            if (!key) return;
            e.preventDefault();
            if (key.setPointerCapture && e.pointerId !== undefined) {
                try { key.setPointerCapture(e.pointerId); } catch (err) { }
            }
            if (key.dataset.dir) return setDir(key.dataset.dir, true);
            key.classList.add('down');
            if (key._spec && key._spec.onPress) { try { key._spec.onPress(); } catch (err) { } }
        }
        function up(e) {
            const key = e.target.closest('.tp-key, .tp-btn');
            if (key && key.dataset.dir) setDir(key.dataset.dir, false);
            else if (key) {
                key.classList.remove('down');
                if (key._spec && key._spec.onRelease) { try { key._spec.onRelease(); } catch (err) { } }
            }
            if (!key) releaseAll();
        }
        root.addEventListener('pointerdown', down);
        root.addEventListener('pointerup', up);
        root.addEventListener('pointercancel', up);
        // a finger lifted anywhere, or the tab going away mid-press
        window.addEventListener('pointerup', releaseAll);
        window.addEventListener('blur', releaseAll);
        document.addEventListener('visibilitychange', releaseAll);
        // the pad is a control surface, not a page: no scrolling or zooming
        root.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
        root.addEventListener('contextmenu', e => e.preventDefault());

        host.appendChild(root);
        return {
            el: root,
            destroy() {
                releaseAll();
                window.removeEventListener('pointerup', releaseAll);
                window.removeEventListener('blur', releaseAll);
                document.removeEventListener('visibilitychange', releaseAll);
                root.remove();
            }
        };
    }

    // ---------- the right click a finger does not have ----------
    // Holding still for half a second is the gesture everybody already
    // knows. It has to lose to a scroll, or the board cannot be panned.
    function longPress(el, fn, opts) {
        const o = opts || {};
        const delay = o.delay || 450;
        const slop = o.slop || 10;
        let timer = null, startX = 0, startY = 0, fired = false;

        const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
        const down = e => {
            if (e.pointerType === 'mouse') return;      // a mouse has a right button
            fired = false;
            startX = e.clientX; startY = e.clientY;
            clear();
            timer = setTimeout(() => {
                fired = true;
                timer = null;
                if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { } }
                try { fn(e); } catch (err) { }
            }, delay);
        };
        const move = e => {
            if (!timer) return;
            if (Math.abs(e.clientX - startX) > slop || Math.abs(e.clientY - startY) > slop) clear();
        };
        // the tap that followed a long press is not also a tap
        const click = e => { if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); } };

        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', clear);
        el.addEventListener('pointercancel', clear);
        el.addEventListener('click', click, true);
        return () => {
            clear();
            el.removeEventListener('pointerdown', down);
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', clear);
            el.removeEventListener('pointercancel', clear);
            el.removeEventListener('click', click, true);
        };
    }

    // ---------- a canvas a finger can point at ----------
    // Mouse-driven canvases read e.clientX; a touch puts it on the first
    // changedTouch instead. This normalises both to canvas coordinates.
    function canvasPoint(cv, e) {
        const r = cv.getBoundingClientRect();
        const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
        const cx = (t ? t.clientX : e.clientX) - r.left;
        const cy = (t ? t.clientY : e.clientY) - r.top;
        return { x: cx * (cv.width / r.width), y: cy * (cv.height / r.height) };
    }

    window.TOUCH = {
        DIRS: DIRS,
        coarse: coarse, narrow: narrow, viewportWidth: viewportWidth, onChange: onChange,
        pad: pad, longPress: longPress, canvasPoint: canvasPoint
    };
})();
