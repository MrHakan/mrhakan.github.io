// ===================================================================
// balatro-fx.js — jokerz 98, but it moves
//
// The table used to be redrawn with innerHTML on every click, which is
// why nothing here ever animated: the card you selected was destroyed
// and rebuilt already-selected, so the transition it had all along
// never got a chance to play. So this file is two things — the
// animations themselves, and the surgical updates that let the elements
// live long enough to run them.
//
// Everything routes through fx.js, which means everything obeys the
// reduced-motion setting for free: with motion off, every function here
// still does its job, it just does it instantly.
// ===================================================================

(function () {
    'use strict';

    const FXX = () => window.FX;
    const on = () => !!(window.FX && window.FX.on());
    const rect = el => el.getBoundingClientRect();

    // ---------- picking a card up ----------
    // the lift itself is css (.bj-card.sel), so this is the extra bit of
    // life on top: a little overshoot going up, a shorter one coming
    // back down, and a nudge if the hand is already full
    function selectCard(el, picked) {
        if (!el || !on()) return;
        FX.animate(el, picked
            ? [{ transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(-14px) scale(1.06)' },
            { transform: 'translateY(-10px) scale(1)' }]
            : [{ transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
            { duration: picked ? 220 : 130, easing: picked ? FX.spring({ stiffness: 520, damping: 20 }) : 'ease-out' });
    }
    function refuse(el) {
        if (!el || !on()) return;
        FX.nudge(el);
    }

    // ---------- cards leaving ----------
    // they fly to wherever the deck counter is, because that is where a
    // discarded card visibly goes on this table. each one leaves a beat
    // after the last, and the whole thing is capped so a five card
    // discard never feels like a cutscene.
    function flyOut(els, targetEl, opts) {
        const o = opts || {};
        if (!els.length || !on()) return Promise.resolve();
        const to = targetEl ? rect(targetEl) : null;
        const anims = els.map((el, i) => {
            const r = rect(el);
            const dx = to ? (to.left + to.width / 2) - (r.left + r.width / 2) : 0;
            const dy = to ? (to.top + to.height / 2) - (r.top + r.height / 2) : -90;
            const spin = (o.spin === undefined ? 22 : o.spin) * (i % 2 ? 1 : -1);
            el.style.zIndex = 40 + i;
            return FX.animate(el, [
                { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
                { transform: `translate(${dx * 0.35}px, ${dy * 0.3 - 16}px) rotate(${spin * 0.4}deg) scale(1.04)`, opacity: 1, offset: 0.35 },
                { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(.5)`, opacity: 0 }
            ], { duration: o.duration || 300, easing: 'cubic-bezier(.4,0,.7,1)', delay: FX.stagger(0.045) });
        });
        return Promise.all(anims.map(a => a.finished));
    }

    // ---------- cards arriving ----------
    // dealt off the top of the deck: in from the right, tilted, landing
    // one after another
    function dealIn(els, fromEl) {
        if (!els.length || !on()) return Promise.resolve();
        const from = fromEl ? rect(fromEl) : null;
        const anims = els.map(el => {
            const r = rect(el);
            const dx = from ? (from.left + from.width / 2) - (r.left + r.width / 2) : 120;
            const dy = from ? (from.top + from.height / 2) - (r.top + r.height / 2) : 40;
            return FX.animate(el, [
                { transform: `translate(${dx}px, ${dy}px) rotate(12deg) scale(.7)`, opacity: 0 },
                { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 }
            ], { duration: 260, easing: FX.spring({ stiffness: 360, damping: 26 }), delay: FX.stagger(0.05) });
        });
        return Promise.all(anims.map(a => a.finished));
    }

    // ---------- the blind taking a hit ----------
    // a blind is the thing you are fighting, so scoring against it reads
    // as damage: the bar shudders, the fill runs, and the number you hit
    // it for floats off the top.
    function damage(barEl, fillEl, opts) {
        const o = opts || {};
        if (fillEl) {
            const pct = Math.max(0, Math.min(100, o.percent || 0));
            if (on()) {
                FX.animate(fillEl, [{ width: fillEl.style.width || '0%' }, { width: pct + '%' }],
                    { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1)' });
            }
            fillEl.style.width = pct + '%';
        }
        if (!barEl || !on()) return;
        const hard = o.amount && o.required && o.amount / o.required > 0.25;
        FX.animate(barEl, hard
            ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
            { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }]
            : [{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }],
            { duration: hard ? 260 : 140, easing: 'steps(5, end)' });
        if (o.text) floatOff(barEl, o.text, { color: hard ? '#ff5c5c' : '#ffd400', up: 34 });
    }

    // a number that lifts off an element and fades — damage, money, a
    // joker firing
    function floatOff(anchor, text, opts) {
        const o = opts || {};
        if (!anchor || !on() || !anchor.parentElement) return;
        const host = anchor.closest('.bj-body') || anchor.parentElement;
        const a = rect(anchor), h = rect(host);
        const el = document.createElement('div');
        el.className = 'bj-float';
        el.textContent = text;
        el.style.color = o.color || '#0df259';
        el.style.left = (a.left - h.left + a.width / 2) + 'px';
        el.style.top = (a.top - h.top) + 'px';
        host.appendChild(el);
        FX.animate(el, [
            { transform: 'translate(-50%, 0) scale(.7)', opacity: 0 },
            { transform: `translate(-50%, -${(o.up || 26) * 0.4}px) scale(1.15)`, opacity: 1, offset: 0.3 },
            { transform: `translate(-50%, -${o.up || 26}px) scale(1)`, opacity: 0 }
        ], { duration: o.duration || 720, easing: 'ease-out' }).finished.then(() => el.remove());
    }

    // ---------- numbers that change ----------
    // counts up rather than snapping, because a score that lands in one
    // frame does not feel like it was earned
    function countTo(el, to, opts) {
        const o = opts || {};
        if (!el) return;
        const from = o.from === undefined ? (parseFloat(String(el.textContent).replace(/[^0-9.-]/g, '')) || 0) : o.from;
        const fmt = o.format || (v => String(Math.round(v)));
        if (!on() || from === to) { el.textContent = fmt(to); return; }
        const dur = o.duration || 420, t0 = performance.now();
        const step = now => {
            const k = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt(from + (to - from) * eased);
            if (k < 1) requestAnimationFrame(step);
            else el.textContent = fmt(to);
        };
        requestAnimationFrame(step);
    }
    // a value that changed, drawing attention to itself
    function pop(el, opts) {
        const o = opts || {};
        if (!el || !on()) return;
        FX.animate(el, [
            { transform: 'scale(1)' }, { transform: `scale(${o.scale || 1.35})` }, { transform: 'scale(1)' }
        ], { duration: o.duration || 260, easing: FX.spring({ stiffness: 600, damping: 18 }) });
    }
    // a button that acknowledges the click
    function press(el) {
        if (!el || !on()) return;
        FX.animate(el, [
            { transform: 'scale(1)' }, { transform: 'scale(.93)' }, { transform: 'scale(1)' }
        ], { duration: 150, easing: 'ease-out' });
    }
    // a joker doing its thing
    function trigger(el) {
        if (!el || !on()) return;
        FX.animate(el, [
            { transform: 'translateY(0) rotate(0)' },
            { transform: 'translateY(-9px) rotate(-4deg) scale(1.08)' },
            { transform: 'translateY(0) rotate(0) scale(1)' }
        ], { duration: 320, easing: FX.spring({ stiffness: 480, damping: 17 }) });
    }
    // a card scoring, on its way through the hand
    function scorePulse(el) {
        if (!el || !on()) return;
        FX.animate(el, [
            { transform: 'translateY(-10px) scale(1)' },
            { transform: 'translateY(-26px) scale(1.18)' },
            { transform: 'translateY(-10px) scale(1)' }
        ], { duration: 300, easing: FX.spring({ stiffness: 520, damping: 19 }) });
    }
    // a screen arriving — shop, blind select, cash out
    function screenIn(root) {
        if (!root || !on()) return;
        FX.animate(root.children, [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 200, easing: 'ease-out', delay: FX.stagger(0.035) });
    }

    window.BJFX = {
        on, selectCard, refuse, flyOut, dealIn, damage, floatOff,
        countTo, pop, press, trigger, scorePulse, screenIn
    };
})();
