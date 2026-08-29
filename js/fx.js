// ===================================================================
// fx.js — motion, the way a 1998 desktop would do it
//
// The shape of this is borrowed openly from motion.dev: animate(),
// stagger(), inView(), springs. The implementation is not — it is the
// Web Animations API, which every browser has had for years, wrapped in
// about four kilobytes. That matters here: this file runs on every page
// load of a site whose whole pitch is no frameworks and no build step,
// and motion.dev's own vanilla build is 139kb. Borrowing the API rather
// than the bundle keeps the swap open if this ever needs more than it
// has (anime.js and motion both expose animate/stagger the same way).
//
// Two rules everything obeys:
//
//   · if the visitor asked for less motion — the OS setting, or the
//     animations tickbox in display properties — nothing animates. The
//     end state is applied instantly instead, so callers never have to
//     care which mode they are in.
//   · a 1998 window does not ease luxuriously into place. Durations are
//     short and some of them are deliberately stepped, because the
//     charm is in things snapping rather than gliding.
// ===================================================================

(function () {
    'use strict';

    const MOTION_KEY = 'motion-off';

    // the OS asked, or the visitor asked in display properties
    function reduced() {
        try {
            if (localStorage.getItem(MOTION_KEY) === '1') return true;
        } catch (e) { /* private mode */ }
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    const on = () => !reduced();

    // A finished animation that never ran, so `await FX.animate(...)` works
    // the same whether motion is on or off — and it applies everything in
    // the keyframe, not a hand-picked three. The old version
    // applied opacity, transform and filter and dropped the rest on the
    // floor, so with motion off a keyframe that moved something by `left`
    // or coloured it by `background` simply never happened — and the
    // caller could not tell, because the promise resolved either way.
    // Custom properties go through setProperty, which is the only way in.
    const SKIP = { offset: 1, easing: 1, composite: 1 };
    function instant(el, keyframes) {
        const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : keyframes;
        if (el && el.style && last) {
            for (const k in last) {
                if (SKIP[k]) continue;
                const v = Array.isArray(last[k]) ? last[k][last[k].length - 1] : last[k];
                if (v === undefined || v === null) continue;
                if (k.indexOf('--') === 0) el.style.setProperty(k, String(v));
                else el.style[k] = v;
            }
        }
        return { finished: Promise.resolve(), cancel() { }, reverse() { }, skipped: true };
    }

    // ---------- springs ----------
    // WAAPI has no spring easing, so the spring is simulated once and
    // handed over as a linear() easing curve — the same trick motion.dev
    // uses. Browsers without linear() get a bezier that is close enough.
    const supportsLinearEasing = (() => {
        try { return CSS.supports('animation-timing-function', 'linear(0, 1)'); }
        catch (e) { return false; }
    })();
    // sixty steps of physics per call, and the presets below ask for the
    // same three springs every time a window opens. They are pure
    // functions of their arguments, so they are worked out once.
    const springCache = Object.create(null);
    function spring(opts) {
        const o = opts || {};
        const stiffness = o.stiffness || 260, damping = o.damping || 22, mass = o.mass || 1;
        if (!supportsLinearEasing) return 'cubic-bezier(.22,1.2,.36,1)';
        const key = stiffness + '/' + damping + '/' + mass;
        if (springCache[key]) return springCache[key];
        const steps = 60, dt = 1 / 60;
        let x = 1, v = 0;
        const out = [];
        for (let i = 0; i < steps; i++) {
            const f = -stiffness * x - damping * v;
            v += (f / mass) * dt;
            x += v * dt;
            out.push(+(1 - x).toFixed(4));
        }
        out[out.length - 1] = 1;
        return (springCache[key] = `linear(${out.join(',')})`);
    }

    // ---------- the core ----------
    // animate(target, keyframes, options) — target may be an element, a
    // list of them, or a selector, exactly like motion.dev
    function nodes(target) {
        if (!target) return [];
        if (typeof target === 'string') return Array.prototype.slice.call(document.querySelectorAll(target));
        if (target.length !== undefined && !target.nodeType) return Array.prototype.slice.call(target);
        return [target];
    }
    function animate(target, keyframes, options) {
        const list = nodes(target);
        const o = Object.assign({ duration: 180, easing: 'ease-out', fill: 'both' }, options || {});
        if (!list.length) return instant(null, keyframes);
        if (!on()) {
            list.forEach(el => instant(el, keyframes));
            return instant(null, keyframes);
        }
        const anims = list.map((el, i) => {
            const delay = typeof o.delay === 'function' ? o.delay(i, list.length) : (o.delay || 0);
            return el.animate(keyframes, {
                duration: o.duration, easing: o.easing, delay: delay,
                fill: o.fill, iterations: o.iterations || 1, direction: o.direction || 'normal'
            });
        });
        return {
            animations: anims,
            finished: Promise.all(anims.map(a => a.finished.catch(() => { }))),
            cancel() { anims.forEach(a => { try { a.cancel(); } catch (e) { } }); },
            reverse() { anims.forEach(a => a.reverse()); }
        };
    }

    // stagger(0.04) -> a delay function, like motion.dev's. `from` takes
    // 'first' | 'last' | 'center' | an index.
    function stagger(each, opts) {
        const ms = each < 1 ? each * 1000 : each;
        const from = (opts && opts.from) || 'first';
        return (i, total) => {
            let anchor = 0;
            if (from === 'last') anchor = total - 1;
            else if (from === 'center') anchor = (total - 1) / 2;
            else if (typeof from === 'number') anchor = from;
            return Math.abs(i - anchor) * ms + ((opts && opts.start) || 0);
        };
    }

    // inView(target, cb) — one shot unless {once:false}
    function inView(target, cb, opts) {
        const list = nodes(target);
        if (!list.length) return () => { };
        if (!window.IntersectionObserver) { list.forEach(el => cb(el)); return () => { }; }
        const o = opts || {};
        const io = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (!e.isIntersecting) return;
                cb(e.target);
                if (o.once !== false) io.unobserve(e.target);
            });
        }, { rootMargin: o.margin || '0px 0px -10% 0px', threshold: o.amount || 0 });
        list.forEach(el => io.observe(el));
        return () => io.disconnect();
    }

    // ---------- sequence ----------
    // one thing after another, which WAAPI has no word for. Each step is
    // [target, keyframes, options]; `at` offsets a step from the end of
    // the one before it, so a negative number overlaps them.
    //
    //   FX.sequence([
    //     [win, [{opacity:0},{opacity:1}], {duration:120}],
    //     ['.row', [{transform:'translateY(6px)'},{transform:'none'}], {at:-60}]
    //   ])
    function sequence(steps, opts) {
        const list = steps || [];
        let cursor = (opts && opts.delay) || 0;
        const running = [];
        list.forEach(step => {
            const [target, keyframes, options] = step;
            const o = Object.assign({}, options || {});
            const at = o.at || 0;
            delete o.at;
            const start = Math.max(0, cursor + at);
            const base = typeof o.delay === 'function' ? o.delay : null;
            o.delay = base ? ((i, n) => start + base(i, n)) : start + (o.delay || 0);
            running.push(animate(target, keyframes, o));
            cursor = start + (o.duration || 180);
        });
        return {
            animations: running,
            finished: Promise.all(running.map(r => r.finished)),
            cancel() { running.forEach(r => r.cancel()); },
            reverse() { running.forEach(r => r.reverse()); }
        };
    }

    // ---------- press ----------
    // A bevelled button on a mouse tells you it went down because the
    // border flips. Under a fingertip the finger is on top of the thing it
    // just pressed, so the one bit of feedback there was is the bit you
    // cannot see. This gives the press somewhere to go, and asks the phone
    // to buzz if it has been allowed to.
    function press(target, opts) {
        const o = opts || {};
        const list = nodes(target);
        list.forEach(el => {
            if (el._fxPress) return;
            el._fxPress = true;
            const down = () => {
                if (!on()) return;
                animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(' + (o.scale || 0.94) + ')' }],
                    { duration: 60, easing: 'ease-out', fill: 'forwards' });
                if (o.haptic !== false && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { } }
            };
            const up = () => {
                if (!on()) { el.style.transform = ''; return; }
                animate(el, [{ transform: 'scale(' + (o.scale || 0.94) + ')' }, { transform: 'scale(1)' }],
                    { duration: 110, easing: spring({ stiffness: 500, damping: 24 }), fill: 'forwards' });
            };
            el.addEventListener('pointerdown', down);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
            el.addEventListener('pointerleave', up);
        });
        return () => list.forEach(el => { el._fxPress = false; });
    }

    // ---------- a device that cannot keep up ----------
    // Reduced motion is a preference. This is a different question: a
    // cheap phone running a canvas game and a starfield and a marquee will
    // drop frames, and the honest answer to that is fewer animations
    // rather than the same ones, badly. Measured once, over real frames,
    // rather than guessed from a user agent string.
    let slow = false;
    function measure() {
        if (typeof requestAnimationFrame !== 'function') return;
        if (typeof document === 'undefined' || !document.documentElement) return;
        let frames = 0, start = 0;
        const step = (t) => {
            if (!start) start = t;
            frames++;
            if (t - start < 900) { requestAnimationFrame(step); return; }
            const fps = frames / ((t - start) / 1000);
            // under about 40fps with nothing much happening, this device is
            // not going to enjoy the decorative layer
            if (fps < 40) {
                slow = true;
                const el = document.documentElement;
                if (el) el.classList.add('slow-device');
            }
        };
        requestAnimationFrame(step);
    }

    // ---------- the presets this desktop actually uses ----------
    // a window arriving: it snaps out of its own title bar rather than
    // fading in like a modern app would
    function openWindow(el) {
        return animate(el, [
            { opacity: 0, transform: 'scale(.86) translateY(-6px)' },
            { opacity: 1, transform: 'scale(1) translateY(0)' }
        ], { duration: 170, easing: spring({ stiffness: 420, damping: 26 }) });
    }
    // and leaving: shorter, because nobody wants to watch a window go
    function closeWindow(el) {
        return animate(el, [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(.9)' }
        ], { duration: 110, easing: 'ease-in' });
    }
    // minimise: down towards the taskbar
    function minimizeWindow(el) {
        return animate(el, [
            { opacity: 1, transform: 'scale(1) translateY(0)' },
            { opacity: 0, transform: 'scale(.7) translateY(40vh)' }
        ], { duration: 150, easing: 'ease-in' });
    }
    // a toast sliding in from the right, stepped on purpose — it reads
    // as a notification panel being pushed rather than floating
    function toastIn(el) {
        return animate(el, [
            { opacity: 0, transform: 'translateX(120%)' },
            { opacity: 1, transform: 'translateX(0)' }
        ], { duration: 260, easing: 'steps(6, end)' });
    }
    function toastOut(el) {
        return animate(el, [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: 'translateX(120%)' }
        ], { duration: 200, easing: 'steps(5, end)' });
    }
    // a menu unrolling downwards
    function unroll(el) {
        return animate(el, [
            { opacity: 0, transform: 'scaleY(.6)', transformOrigin: 'top' },
            { opacity: 1, transform: 'scaleY(1)', transformOrigin: 'top' }
        ], { duration: 130, easing: 'ease-out' });
    }
    // rows arriving one after another
    function reveal(target, opts) {
        const o = opts || {};
        return animate(target, [
            { opacity: 0, transform: `translateY(${o.from || 6}px)` },
            { opacity: 1, transform: 'translateY(0)' }
        ], { duration: o.duration || 160, easing: 'ease-out', delay: stagger(o.each || 0.03) });
    }
    // a button that argues back
    function nudge(el) {
        return animate(el, [
            { transform: 'translateX(0)' }, { transform: 'translateX(-3px)' },
            { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }
        ], { duration: 160, easing: 'steps(4, end)' });
    }

    // css transitions are motion too, and no media query can see the
    // tickbox in display properties — so the answer is published as a
    // class on <html> and the stylesheet reads it there
    function publish() {
        const el = typeof document !== 'undefined' && document.documentElement;
        if (el) el.classList.toggle('no-motion', !on());
    }

    window.FX = {
        on, spring, animate, stagger, inView, sequence, press,
        slow: () => slow,
        openWindow, closeWindow, minimizeWindow,
        toastIn, toastOut, unroll, reveal, nudge,
        MOTION_KEY, publish,
        // display properties flips this; nothing caches the answer
        setEnabled(yes) {
            try { localStorage.setItem(MOTION_KEY, yes ? '0' : '1'); } catch (e) { }
            publish();
        },
        enabled() {
            try { return localStorage.getItem(MOTION_KEY) !== '1'; } catch (e) { return true; }
        }
    };
    publish();
    // The frame budget is measured once the page has something to draw.
    // Guarded because check-motion.mjs loads this file against a window
    // that is an object literal, which is the point of that test — it
    // catches exactly this sort of assumption about the environment.
    if (typeof document !== 'undefined' && typeof setTimeout === 'function') {
        if (document.readyState === 'complete') setTimeout(measure, 1200);
        else if (window && typeof window.addEventListener === 'function') {
            window.addEventListener('load', () => setTimeout(measure, 1200));
        }
    }
    // the os setting can change while the page is open
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mq.addEventListener) mq.addEventListener('change', publish);
    }
})();
