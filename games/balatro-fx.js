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
    // ---------- winning ----------
    // a yellow head drops out of nowhere, lands on the beaten blind, and
    // then slides off and falls out of the window. the blind takes the
    // hit at the moment of contact — squashed, then wobbling — which is
    // the whole joke, so the two animations are timed against each
    // other rather than just played at once.
    function bonk(targetEl, src) {
        if (!targetEl || !on() || !targetEl.parentElement) return Promise.resolve();
        const host = targetEl.closest('.bj-body') || targetEl.parentElement;
        const t = rect(targetEl), h = rect(host);
        // it has to come to rest *on their head*, not over their face —
        // slightly smaller than the victim and sitting three quarters
        // above them, so at the moment of impact you can see both
        const size = Math.max(40, t.width * 0.88);
        const head = document.createElement('img');
        head.className = 'bj-bonk';
        head.src = src;
        head.alt = '';
        head.style.width = size + 'px';
        head.style.left = (t.left - h.left + t.width / 2 - size / 2) + 'px';
        // half the size, not three quarters: these pngs carry a lot of
        // transparent margin, so a head that is geometrically resting on
        // the crown looks like it is hovering over it
        const restTop = t.top - h.top - size * 0.5;
        head.style.top = restTop + 'px';
        host.appendChild(head);

        // it falls from the top edge of the panel rather than from
        // somewhere above it — the window clips its own overflow, and a
        // head that spends its whole drop outside the box is a head
        // nobody sees
        // the easing has to live on the keyframes, not on the animation:
        // one curve across the whole thing stretches the drop over the
        // hang and the fall as well, and the head arrives late for its
        // own impact
        const DROP = 300, HANG = 140, FALL = 620, TOTAL = DROP + HANG + FALL;
        const from = Math.max(0, restTop) + 4;
        const fall = FX.animate(head, [
            { transform: `translateY(-${from}px) rotate(-14deg)`, opacity: 0, offset: 0, easing: 'linear' },
            // gravity: slow off the mark, quick at the end
            { transform: `translateY(-${from * 0.94}px) rotate(-12deg)`, opacity: 1, offset: 0.05, easing: 'cubic-bezier(.5,0,.9,.5)' },
            // lands
            { transform: 'translateY(0) rotate(0deg)', offset: DROP / TOTAL, easing: 'ease-out' },
            // a small bounce off their skull
            { transform: 'translateY(-9px) rotate(4deg)', offset: (DROP + HANG * 0.45) / TOTAL, easing: 'ease-in' },
            { transform: 'translateY(0) rotate(1deg)', offset: (DROP + HANG) / TOTAL, easing: 'cubic-bezier(.4,0,.9,.6)' },
            // then off the side and out of the window
            { transform: `translate(${size * 0.55}px, ${h.height}px) rotate(120deg)`, opacity: 0.9, offset: 1 }
        ], { duration: TOTAL, easing: 'linear' });

        // the impact, on the frame the head lands
        setTimeout(() => {
            if (!targetEl.isConnected) return;
            FX.animate(targetEl, [
                { transform: 'scale(1,1) translateY(0)' },
                { transform: 'scale(1.22,.72) translateY(7px)' },
                { transform: 'scale(.94,1.08) translateY(-3px)' },
                { transform: 'scale(1.04,.97) translateY(1px)' },
                { transform: 'scale(1,1) translateY(0)' }
            ], { duration: 520, easing: 'ease-out' });
            const host2 = targetEl.closest('.bj-body');
            if (host2) host2.classList.add('bj-shook');
            setTimeout(() => host2 && host2.classList.remove('bj-shook'), 220);
            floatOff(targetEl, 'BONK', { color: '#ffd400', up: 40, duration: 900 });
        }, DROP);

        return fall.finished.then(() => head.remove());
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
        countTo, pop, press, trigger, scorePulse, screenIn, bonk
    };
})();
