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

    // a finished animation that never ran, so `await FX.animate(...)`
    // works the same whether motion is on or off
    function instant(el, keyframes) {
        const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : keyframes;
        if (el && last) {
            for (const k in last) {
                if (k === 'offset' || k === 'easing') continue;
                const v = Array.isArray(last[k]) ? last[k][last[k].length - 1] : last[k];
                if (k === 'opacity' || k === 'transform' || k === 'filter') el.style[k] = v;
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
    function spring(opts) {
        const o = opts || {};
        const stiffness = o.stiffness || 260, damping = o.damping || 22, mass = o.mass || 1;
        if (!supportsLinearEasing) return 'cubic-bezier(.22,1.2,.36,1)';
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
        return `linear(${out.join(',')})`;
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
        on, spring, animate, stagger, inView,
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
    // the os setting can change while the page is open
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mq.addEventListener) mq.addEventListener('change', publish);
    }
})();
