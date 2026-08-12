// ===================================================================
// mrhakan 98 — the overhaul pack
//
// the stuff every retro desktop and every personal site is supposed to
// have and this one didn't: klondike solitaire, a proper screensaver
// collection (mystify / starfield / 3d pipes / flying windows), the
// hypnotic defrag.exe, a devlog, and a "find files" search that looks
// through every single thing on this site.
// ===================================================================

// ===================================================================
// devlog — the one thing a personal site is actually for
// ===================================================================
let postsData = null;
async function loadPosts() {
    if (postsData) return postsData;
    const res = await fetch('data/posts.json');
    postsData = await res.json();
    return postsData;
}

async function openDevlog(focusId) {
    const { body } = createAppWindow('devlog.txt', { icon: 'draft', width: 430 });
    body.classList.add('doc-body');
    body.innerHTML = '<div class="doc-loading">loading...</div>';
    try {
        const d = await loadPosts();
        const render = (openId) => {
            body.innerHTML = `
                <h2 class="doc-h1">devlog</h2>
                <p class="doc-intro">${escapeHtml(d.intro)}</p>
                ${d.posts.map(p => `
                    <article class="post${p.id === openId ? ' open' : ''}" data-post="${escapeHtml(p.id)}">
                        <button class="post-head" data-toggle="${escapeHtml(p.id)}">
                            <span class="post-caret">${p.id === openId ? '▾' : '▸'}</span>
                            <span class="post-title">${escapeHtml(p.title)}</span>
                        </button>
                        <div class="post-meta">${escapeHtml(p.date)} · ${p.tags.map(t => `<span class="post-tag">#${escapeHtml(t)}</span>`).join(' ')}</div>
                        <div class="post-body">${p.body.map(par => `<p>${escapeHtml(par)}</p>`).join('')}</div>
                    </article>`).join('')}
                <p class="doc-foot">no comments, no tracking, no newsletter. mail me instead — the address is on the desktop.</p>`;
            body.querySelectorAll('[data-toggle]').forEach(btn => {
                btn.onclick = () => {
                    const id = btn.dataset.toggle;
                    playSound('click');
                    render(id === openId ? null : id);
                };
            });
        };
        render(focusId || d.posts[0].id);
        unlockAchievement('reader');
    } catch (e) {
        body.innerHTML = '<div class="doc-loading">could not load data/posts.json bradar</div>';
    }
}

// ===================================================================
// klondike solitaire — the single most-played program in windows history
// ===================================================================
const SOL_SUITS = ['♠', '♥', '♦', '♣'];
const SOL_RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const solIsRed = (s) => s === 1 || s === 2;

function openSolitaire() {
    const { body, win } = createAppWindow('solitaire', { icon: 'style', width: 560 });
    body.classList.add('sol-body');
    body.innerHTML = `
        <div class="sol-bar">
            <button class="bevel-out sol-btn" data-act="new">deal</button>
            <button class="bevel-out sol-btn" data-act="undo">undo</button>
            <button class="bevel-out sol-btn" data-act="auto">auto-finish</button>
            <span class="sol-status" data-status>moves: 0</span>
        </div>
        <div class="sol-table" data-table></div>`;

    const table = body.querySelector('[data-table]');
    const statusEl = body.querySelector('[data-status]');
    let stock, waste, foundations, tableau, moves, sel, history, won;

    const deal = () => {
        const deck = [];
        for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ r, s, up: false });
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        tableau = [];
        for (let c = 0; c < 7; c++) {
            const pile = deck.splice(0, c + 1);
            pile[pile.length - 1].up = true;
            tableau.push(pile);
        }
        stock = deck;
        waste = [];
        foundations = [[], [], [], []];
        moves = 0; sel = null; history = []; won = false;
        render();
    };

    // deep-ish snapshot so undo can rewind a whole move, flips included
    const snapshot = () => JSON.stringify({ stock, waste, foundations, tableau, moves });
    const pushHistory = () => {
        history.push(snapshot());
        if (history.length > 60) history.shift();
    };
    const undo = () => {
        if (!history.length) { playSound('error'); return; }
        const s = JSON.parse(history.pop());
        stock = s.stock; waste = s.waste; foundations = s.foundations; tableau = s.tableau; moves = s.moves;
        sel = null;
        playSound('click');
        render();
    };

    const canStackTableau = (card, pile) => {
        if (!pile.length) return card.r === 13;
        const top = pile[pile.length - 1];
        return top.up && solIsRed(top.s) !== solIsRed(card.s) && top.r === card.r + 1;
    };
    const canStackFoundation = (card, pile) => {
        if (!pile.length) return card.r === 1;
        const top = pile[pile.length - 1];
        return top.s === card.s && top.r === card.r - 1;
    };

    // after lifting cards off a tableau column, the newly exposed card turns over
    const flipExposed = () => {
        tableau.forEach(p => { if (p.length && !p[p.length - 1].up) p[p.length - 1].up = true; });
    };

    const checkWin = () => {
        if (foundations.every(f => f.length === 13) && !won) {
            won = true;
            playSound('ding');
            unlockAchievement('solitaire');
            solitaireCascade(win);
            showToast('solitaire', `you won in ${moves} moves. bradar.`);
        }
    };

    // move the selected run onto a destination, or bail out with an error beep
    const tryMove = (dest) => {
        if (!sel) return;
        const cards = sel.cards;
        let ok = false;
        if (dest.type === 'foundation' && cards.length === 1 && canStackFoundation(cards[0], foundations[dest.i])) {
            pushHistory();
            removeSelected();
            foundations[dest.i].push(cards[0]);
            ok = true;
        } else if (dest.type === 'tableau' && canStackTableau(cards[0], tableau[dest.i])) {
            pushHistory();
            removeSelected();
            tableau[dest.i].push(...cards);
            ok = true;
        }
        sel = null;
        if (ok) { moves++; flipExposed(); playSound('click'); checkWin(); }
        else playSound('error');
        render();
    };

    const removeSelected = () => {
        if (sel.from.type === 'waste') waste.pop();
        else if (sel.from.type === 'tableau') tableau[sel.from.i].splice(sel.from.idx);
        else if (sel.from.type === 'foundation') foundations[sel.from.i].pop();
    };

    // double click / right click: shoot a card straight to whichever foundation takes it
    const sendToFoundation = (from) => {
        let card;
        if (from.type === 'waste') card = waste[waste.length - 1];
        else if (from.type === 'tableau') {
            const p = tableau[from.i];
            if (from.idx !== p.length - 1) return false;
            card = p[p.length - 1];
        }
        if (!card) return false;
        for (let f = 0; f < 4; f++) {
            if (canStackFoundation(card, foundations[f])) {
                pushHistory();
                if (from.type === 'waste') waste.pop(); else tableau[from.i].pop();
                foundations[f].push(card);
                moves++; flipExposed(); playSound('click'); checkWin(); render();
                return true;
            }
        }
        return false;
    };

    const autoFinish = () => {
        let did = 0;
        for (let pass = 0; pass < 60; pass++) {
            let movedThisPass = false;
            if (waste.length && sendToFoundation({ type: 'waste' })) { movedThisPass = true; did++; }
            for (let i = 0; i < 7; i++) {
                const p = tableau[i];
                if (p.length && sendToFoundation({ type: 'tableau', i, idx: p.length - 1 })) { movedThisPass = true; did++; }
            }
            if (!movedThisPass) break;
        }
        if (!did) { playSound('error'); showToast('solitaire', 'nothing can go up yet'); }
    };

    const drawFromStock = () => {
        pushHistory();
        if (!stock.length) {
            if (!waste.length) { history.pop(); playSound('error'); return; }
            stock = waste.reverse().map(c => ({ ...c, up: false }));
            waste = [];
        } else {
            const c = stock.pop();
            c.up = true;
            waste.push(c);
        }
        sel = null;
        playSound('click');
        render();
    };

    const cardHtml = (c, extra) => c.up
        ? `<div class="sol-card${solIsRed(c.s) ? ' red' : ''}${extra || ''}">
               <span class="sol-corner">${SOL_RANKS[c.r]}${SOL_SUITS[c.s]}</span>
               <span class="sol-pip">${SOL_SUITS[c.s]}</span>
           </div>`
        : `<div class="sol-card back${extra || ''}"></div>`;

    const render = () => {
        statusEl.textContent = won ? `you won in ${moves} moves` : `moves: ${moves}`;
        table.innerHTML = `
            <div class="sol-top">
                <div class="sol-slot" data-stock>${stock.length ? '<div class="sol-card back"></div>' : '<div class="sol-empty">↻</div>'}</div>
                <div class="sol-slot" data-waste>${waste.length ? cardHtml(waste[waste.length - 1]) : '<div class="sol-empty"></div>'}</div>
                <div class="sol-gap"></div>
                ${foundations.map((f, i) => `<div class="sol-slot" data-foundation="${i}">
                    ${f.length ? cardHtml(f[f.length - 1]) : `<div class="sol-empty">${SOL_SUITS[i]}</div>`}
                </div>`).join('')}
            </div>
            <div class="sol-cols">
                ${tableau.map((p, i) => `<div class="sol-col${p.length > 12 ? ' dense' : ''}" data-tableau="${i}" style="--n:${Math.max(1, p.length)}">
                    ${p.length ? p.map((c, idx) => `<div class="sol-stackitem" style="top:calc(var(--stack) * ${idx})" data-card="${i}-${idx}">
                        ${cardHtml(c, sel && sel.from.type === 'tableau' && sel.from.i === i && idx >= sel.from.idx ? ' sel' : '')}
                    </div>`).join('') : '<div class="sol-empty"></div>'}
                </div>`).join('')}
            </div>`;

        table.querySelector('[data-stock]').onclick = drawFromStock;

        const wasteEl = table.querySelector('[data-waste]');
        wasteEl.onclick = () => {
            if (!waste.length) return;
            if (sel && sel.from.type === 'waste') { sel = null; render(); return; }
            sel = { from: { type: 'waste' }, cards: [waste[waste.length - 1]] };
            render();
        };
        wasteEl.ondblclick = () => sendToFoundation({ type: 'waste' });
        if (sel && sel.from.type === 'waste') wasteEl.querySelector('.sol-card')?.classList.add('sel');

        table.querySelectorAll('[data-foundation]').forEach(el => {
            el.onclick = () => {
                const i = +el.dataset.foundation;
                if (sel) return tryMove({ type: 'foundation', i });
                if (foundations[i].length) {
                    sel = { from: { type: 'foundation', i }, cards: [foundations[i][foundations[i].length - 1]] };
                    render();
                }
            };
        });

        table.querySelectorAll('[data-tableau]').forEach(el => {
            const i = +el.dataset.tableau;
            el.onclick = (e) => {
                const item = e.target.closest('[data-card]');
                // clicking the empty part of a column always means "drop here"
                if (sel && (!item || sel.from.type !== 'tableau' || sel.from.i !== i)) return tryMove({ type: 'tableau', i });
                if (!item) { if (sel) { sel = null; render(); } return; }
                const idx = +item.dataset.card.split('-')[1];
                if (!tableau[i][idx].up) { playSound('error'); return; }
                if (sel && sel.from.type === 'tableau' && sel.from.i === i && sel.from.idx === idx) { sel = null; render(); return; }
                sel = { from: { type: 'tableau', i, idx }, cards: tableau[i].slice(idx) };
                render();
            };
            el.ondblclick = (e) => {
                const item = e.target.closest('[data-card]');
                if (!item) return;
                const idx = +item.dataset.card.split('-')[1];
                sel = null;
                sendToFoundation({ type: 'tableau', i, idx });
            };
        });
    };

    body.querySelectorAll('.sol-btn').forEach(b => b.onclick = () => {
        if (b.dataset.act === 'new') { playSound('navigate'); deal(); }
        if (b.dataset.act === 'undo') undo();
        if (b.dataset.act === 'auto') autoFinish();
    });

    deal();
}

// the win animation everybody actually played solitaire for
function solitaireCascade(win) {
    const layer = document.createElement('div');
    layer.className = 'sol-cascade';
    document.body.appendChild(layer);
    const rect = win ? win.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth };
    let launched = 0;
    const timer = setInterval(() => {
        if (launched++ >= 40) { clearInterval(timer); setTimeout(() => layer.remove(), 4000); return; }
        const c = document.createElement('div');
        const s = Math.floor(Math.random() * 4);
        c.className = `sol-card sol-fall${solIsRed(s) ? ' red' : ''}`;
        c.innerHTML = `<span class="sol-corner">${SOL_RANKS[1 + Math.floor(Math.random() * 13)]}${SOL_SUITS[s]}</span>`;
        const startX = rect.left + Math.random() * Math.max(60, rect.width);
        c.style.left = `${startX}px`;
        c.style.top = `${rect.top + 40}px`;
        c.style.setProperty('--dx', `${(Math.random() - 0.5) * 700}px`);
        c.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
        layer.appendChild(c);
        setTimeout(() => c.remove(), 3200);
    }, 90);
}

// ===================================================================
// jokerz 98 — the poker roguelike, loaded on demand
//
// It is by far the biggest thing on this site, so it stays out of the
// initial page load and only arrives when somebody actually opens it.
// ===================================================================
let balLoading = null;
function balLoadScripts() {
    if (window.startBalatro) return Promise.resolve();
    if (balLoading) return balLoading;
    const load = src => new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = () => rej(new Error(src));
        document.head.appendChild(s);
    });
    // data first: the engine reads BAL at definition time
    balLoading = load('games/balatro-data.js').then(() => load('games/balatro.js'));
    return balLoading;
}

function openBalatro() {
    if (window.startBalatro) { startBalatro(); return; }
    const { body, win } = createAppWindow('jokerz 98', { icon: 'casino', width: 320 });
    body.innerHTML = '<div class="bj-loading">shuffling deck...</div>';
    balLoadScripts().then(() => {
        closeAppWindow(win.id);
        startBalatro();
    }).catch(() => {
        body.innerHTML = '<div class="bj-loading">could not load the game files bradar</div>';
    });
}

// ===================================================================
// sir, we have a troll problem — tower defense mini-game, loaded on
// demand, same lazy pattern as jokerz 98.
// ===================================================================
let tgLoading = null;
function tgLoadScripts() {
    if (window.startTrollProblem) return Promise.resolve();
    if (tgLoading) return tgLoading;
    const load = src => new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = () => rej(new Error(src));
        document.head.appendChild(s);
    });
    tgLoading = load('games/troll-problem-data.js').then(() => load('games/troll-problem.js'));
    return tgLoading;
}

function openTrollProblem() {
    if (window.startTrollProblem) { startTrollProblem(); return; }
    const { body, win } = createAppWindow('sir, we have a troll problem', { icon: 'castle', width: 320 });
    body.innerHTML = '<div class="bj-loading">sharpening swords...</div>';
    tgLoadScripts().then(() => {
        closeAppWindow(win.id);
        startTrollProblem();
    }).catch(() => {
        body.innerHTML = '<div class="bj-loading">could not load the game files bradar</div>';
    });
}

// ===================================================================
// screensavers — five of them, picked in display properties
// ===================================================================
const SCREENSAVERS = {
    mystify: { name: 'mystify your mind', build: saverMystify },
    starfield: { name: 'starfield simulation', build: saverStarfield },
    pipes: { name: '3d pipes', build: saverPipes },
    flying: { name: 'flying windows', build: saverFlyingWindows },
    logo: { name: 'bouncing mrhakan', build: saverLogo },
    none: { name: '(none)', build: null }
};
const SCREENSAVER_IDLE_MS = 90000;
let screensaverTimer = null;
let screensaverRAF = null;

function getScreensaverId() {
    const id = localStorage.getItem('screensaver') || 'mystify';
    return SCREENSAVERS[id] ? id : 'mystify';
}

function initScreensaver() {
    const reset = () => {
        clearTimeout(screensaverTimer);
        if (getScreensaverId() === 'none') return;
        screensaverTimer = setTimeout(() => {
            if (document.getElementById('boot-screen') || document.getElementById('bsod-screen')) return;
            startScreensaver();
        }, SCREENSAVER_IDLE_MS);
    };
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(ev =>
        document.addEventListener(ev, reset, { passive: true }));
    reset();
}

function startScreensaver(forceId) {
    if (document.getElementById('screensaver')) return;
    const id = forceId || getScreensaverId();
    const saver = SCREENSAVERS[id] && SCREENSAVERS[id].build ? SCREENSAVERS[id] : SCREENSAVERS.mystify;

    const host = document.createElement('div');
    host.id = 'screensaver';
    const cv = document.createElement('canvas');
    host.appendChild(cv);
    document.body.appendChild(host);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = cv.getContext('2d');
    let w, h;
    const resize = () => {
        w = window.innerWidth; h = window.innerHeight;
        cv.width = w * dpr; cv.height = h * dpr;
        cv.style.width = `${w}px`; cv.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = saver.build(ctx, () => w, () => h);
    const loop = () => { frame(); screensaverRAF = requestAnimationFrame(loop); };
    screensaverRAF = requestAnimationFrame(loop);

    // wake on any input, a tick later so the click that started it doesn't kill it
    setTimeout(() => {
        const wake = () => {
            cancelAnimationFrame(screensaverRAF);
            window.removeEventListener('resize', resize);
            host.remove();
            ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(ev =>
                document.removeEventListener(ev, wake));
        };
        ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(ev =>
            document.addEventListener(ev, wake, { passive: true }));
    }, 400);
}

// two polygons bouncing around the screen, dragging a trail of past shapes
function saverMystify(ctx, getW, getH) {
    const makeShape = (hue) => ({
        hue,
        pts: Array.from({ length: 4 }, () => ({
            x: Math.random() * getW(), y: Math.random() * getH(),
            dx: (Math.random() * 2 + 1.4) * (Math.random() < .5 ? -1 : 1),
            dy: (Math.random() * 2 + 1.4) * (Math.random() < .5 ? -1 : 1)
        })),
        trail: []
    });
    const shapes = [makeShape(300), makeShape(150)];
    let t = 0;
    return () => {
        const w = getW(), h = getH();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        t += 0.4;
        shapes.forEach((s, si) => {
            s.pts.forEach(p => {
                p.x += p.dx; p.y += p.dy;
                if (p.x < 0 || p.x > w) { p.dx *= -1; p.x = Math.max(0, Math.min(p.x, w)); }
                if (p.y < 0 || p.y > h) { p.dy *= -1; p.y = Math.max(0, Math.min(p.y, h)); }
            });
            s.trail.push(s.pts.map(p => ({ x: p.x, y: p.y })));
            if (s.trail.length > 12) s.trail.shift();
            s.trail.forEach((poly, i) => {
                const hue = (s.hue + t + i * 6) % 360;
                ctx.strokeStyle = `hsl(${hue} 100% ${30 + (i / s.trail.length) * 45}%)`;
                ctx.lineWidth = si === 0 ? 2 : 1.5;
                ctx.beginPath();
                poly.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
                ctx.closePath();
                ctx.stroke();
            });
        });
    };
}

// the one that made everyone feel like they were on the enterprise
function saverStarfield(ctx, getW, getH) {
    const respawn = (s) => { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; };
    const stars = Array.from({ length: 700 }, () => {
        const s = {};
        respawn(s);
        s.z = Math.random();
        return s;
    });
    return () => {
        const w = getW(), h = getH(), cx = w / 2, cy = h / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        stars.forEach(s => {
            const pz = s.z;
            s.z -= 0.007;
            if (s.z <= 0.02) { respawn(s); return; }
            const x = cx + (s.x / s.z) * cx;
            const y = cy + (s.y / s.z) * cy;
            // a star that has flown past the edge is gone — recycle it now
            // instead of letting it drift off-screen for the next ten seconds
            if (x < 0 || x > w || y < 0 || y > h) { respawn(s); return; }
            const near = 1 - s.z;
            ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, 0.45 + near * 0.55)})`;
            ctx.lineWidth = Math.max(1, near * 3);
            ctx.beginPath();
            // far stars are dots, close ones streak — that's the warp effect
            ctx.moveTo(cx + (s.x / pz) * cx, cy + (s.y / pz) * cy);
            ctx.lineTo(x, y);
            ctx.stroke();
        });
    };
}

// pipes that crawl the screen and turn at random — the office legend
function saverPipes(ctx, getW, getH) {
    const CELL = 26;
    let cols, rows, grid, pipes;
    const COLORS = ['#00d0ff', '#ff3ea5', '#0df259', '#ffd400', '#ff6a00', '#b46cff'];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    const spawn = () => ({
        x: Math.floor(Math.random() * cols),
        y: Math.floor(Math.random() * rows),
        d: Math.floor(Math.random() * 4),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 0
    });
    const setup = () => {
        cols = Math.ceil(getW() / CELL);
        rows = Math.ceil(getH() / CELL);
        grid = new Set();
        pipes = [spawn(), spawn(), spawn()];
        ctx.fillStyle = '#0b0b16';
        ctx.fillRect(0, 0, getW(), getH());
    };
    setup();

    let tick = 0;
    return () => {
        tick++;
        // slow the crawl down so it reads as pipes, not static
        if (tick % 2) return;
        if (grid.size > cols * rows * 0.72) setup();

        pipes.forEach((p, i) => {
            const fromX = p.x * CELL + CELL / 2, fromY = p.y * CELL + CELL / 2;
            // turn now and then, and always turn if the way ahead is taken
            let tries = 0;
            let nd = p.d;
            while (tries < 8) {
                if (tries > 0 || Math.random() < 0.22) nd = Math.floor(Math.random() * 4);
                const nx = p.x + DIRS[nd][0], ny = p.y + DIRS[nd][1];
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !grid.has(`${nx},${ny}`)) break;
                tries++;
            }
            if (tries >= 8) { pipes[i] = spawn(); return; }
            const turned = nd !== p.d;
            p.d = nd;
            p.x += DIRS[nd][0];
            p.y += DIRS[nd][1];
            p.life++;
            grid.add(`${p.x},${p.y}`);
            const toX = p.x * CELL + CELL / 2, toY = p.y * CELL + CELL / 2;

            ctx.strokeStyle = p.color;
            ctx.lineWidth = 9;
            ctx.lineCap = 'round';
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();
            // a ball joint only where the pipe actually turns, like the real thing
            if (turned) {
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(fromX, fromY, 7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            if (p.life > 60 && Math.random() < 0.02) pipes[i] = spawn();
        });
    };
}

// windows logos flying at your face out of the void
function saverFlyingWindows(ctx, getW, getH) {
    const make = () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() * 0.9 + 0.1 });
    const flags = Array.from({ length: 55 }, make);
    const drawFlag = (x, y, size) => {
        const g = size / 2, gap = Math.max(1, size * 0.07);
        const quads = [['#ff3b30', 0, 0], ['#0df259', 1, 0], ['#00a2ff', 0, 1], ['#ffd400', 1, 1]];
        quads.forEach(([c, qx, qy]) => {
            ctx.fillStyle = c;
            ctx.fillRect(x + qx * (g + gap), y + qy * (g + gap), g, g);
        });
    };
    return () => {
        const w = getW(), h = getH(), cx = w / 2, cy = h / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        flags
            .sort((a, b) => b.z - a.z)
            .forEach(f => {
                f.z -= 0.006;
                if (f.z <= 0.04) { Object.assign(f, make()); f.z = 1; }
                const size = (1 / f.z) * 17;
                const x = cx + (f.x / f.z) * cx - size / 2;
                const y = cy + (f.y / f.z) * cy - size / 2;
                if (x < -size || x > w || y < -size || y > h) return;
                drawFlag(x, y, size);
            });
    };
}

// the original: the site logo bouncing around waiting to hit a corner
function saverLogo(ctx, getW, getH) {
    const img = new Image();
    img.src = 'src/troll/troll5.png';
    const colors = ['#0df259', '#ff00ff', '#ffff00', '#00ffff', '#ff6600'];
    let x = 80, y = 80, dx = 2.4, dy = 1.9, ci = 0, corners = 0;
    const W = 190, H = 130;
    return () => {
        const w = getW(), h = getH();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        x += dx; y += dy;
        let hitX = false, hitY = false;
        if (x <= 0 || x + W >= w) { dx *= -1; hitX = true; x = Math.max(0, Math.min(x, w - W)); }
        if (y <= 0 || y + H >= h) { dy *= -1; hitY = true; y = Math.max(0, Math.min(y, h - H)); }
        if (hitX || hitY) ci = (ci + 1) % colors.length;
        if (hitX && hitY) corners++;
        const c = colors[ci];
        if (img.complete && img.naturalWidth) {
            ctx.drawImage(img, x + W / 2 - 40, y, 80, 80);
        }
        ctx.fillStyle = c;
        ctx.font = 'bold 26px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = c;
        ctx.shadowBlur = 14;
        ctx.fillText('mrhakan 98', x + W / 2, y + H - 8);
        ctx.shadowBlur = 0;
        if (corners) {
            ctx.fillStyle = '#666';
            ctx.font = '12px monospace';
            ctx.fillText(`corner hits: ${corners}`, w / 2, h - 18);
        }
    };
}

// ===================================================================
// defrag.exe — does nothing, watched by millions
// ===================================================================
const DEFRAG_LEGEND = [
    ['df-used', 'used'],
    ['df-frag', 'fragmented'],
    ['df-free', 'free space'],
    ['df-read', 'reading'],
    ['df-write', 'writing'],
    ['df-bad', 'bad sector']
];

function openDefrag() {
    const COLS = 34, ROWS = 14, TOTAL = COLS * ROWS;
    const { body, win } = createAppWindow('defragmenting drive C:', { icon: 'storage', width: 430 });
    body.innerHTML = `
        <div class="df-grid" data-grid></div>
        <div class="df-status">
            <div class="df-bar bevel-in"><div class="df-bar-fill" data-fill></div></div>
            <div class="df-text" data-text>reading drive information...</div>
        </div>
        <div class="df-legend">${DEFRAG_LEGEND.map(([c, l]) =>
        `<span><i class="df-cell ${c}"></i>${l}</span>`).join('')}</div>
        <div class="df-btns">
            <button class="bevel-out sol-btn" data-act="pause">pause</button>
            <button class="bevel-out sol-btn" data-act="restart">restart</button>
        </div>`;

    const gridEl = body.querySelector('[data-grid]');
    const fill = body.querySelector('[data-fill]');
    const text = body.querySelector('[data-text]');
    let cells, timer, paused = false;

    const build = () => {
        // a believable mess: mostly used, a scatter of fragments and holes
        cells = Array.from({ length: TOTAL }, () => {
            const r = Math.random();
            if (r < 0.02) return 'df-bad';
            if (r < 0.30) return 'df-free';
            if (r < 0.62) return 'df-frag';
            return 'df-used';
        });
        gridEl.innerHTML = cells.map(c => `<i class="df-cell ${c}"></i>`).join('');
    };

    const paint = (i) => { gridEl.children[i].className = `df-cell ${cells[i]}`; };

    const progress = () => {
        const movable = cells.filter(c => c !== 'df-bad').length;
        const done = cells.filter(c => c === 'df-used').length;
        return movable ? Math.round((done / movable) * 100) : 100;
    };

    const step = () => {
        if (paused) return;
        // find the deepest fragment and the shallowest hole, then swap them
        const from = cells.lastIndexOf('df-frag');
        if (from === -1) {
            text.textContent = 'defragmentation complete. 0% fragmented. you may now stare at something else.';
            fill.style.width = '100%';
            clearInterval(timer);
            playSound('ding');
            unlockAchievement('defrag');
            return;
        }
        const to = cells.indexOf('df-free');
        cells[from] = 'df-read';
        paint(from);
        text.textContent = `reading cluster ${from * 512}...`;
        setTimeout(() => {
            if (to !== -1 && to < from) {
                cells[to] = 'df-write';
                paint(to);
                text.textContent = `writing cluster ${from * 512} → ${to * 512}`;
                setTimeout(() => {
                    cells[to] = 'df-used'; cells[from] = 'df-free';
                    paint(to); paint(from);
                    fill.style.width = `${progress()}%`;
                }, 110);
            } else {
                cells[from] = 'df-used';
                paint(from);
                fill.style.width = `${progress()}%`;
            }
        }, 110);
    };

    const start = () => {
        clearInterval(timer);
        build();
        fill.style.width = '0%';
        timer = setInterval(step, 260);
    };

    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
        playSound('click');
        if (b.dataset.act === 'restart') { paused = false; body.querySelector('[data-act="pause"]').textContent = 'pause'; start(); }
        else { paused = !paused; b.textContent = paused ? 'resume' : 'pause'; }
    });

    win._cleanup = () => clearInterval(timer);
    start();
}

// ===================================================================
// find: files — search every app, page, game and toy on this site
// ===================================================================
function siteSearchIndex() {
    return [
        ['about me', 'section', () => showSection('home'), 'home bio profile intro'],
        ['my work', 'section', () => showSection('github'), 'projects repos github portfolio'],
        ['cool links', 'section', () => showSection('links'), 'bookmarks friends sites'],
        ['guestbook', 'section', () => showSection('guestbook'), 'sign comment message'],
        ['devlog.txt', 'document', () => openDevlog(), 'blog posts writing journal news'],
        ['now.txt', 'document', () => openNowPage(), 'current lately status'],
        ['uses.txt', 'document', () => openUsesPage(), 'setup gear hardware software'],
        ['colophon.txt', 'document', () => openColophon(), 'built with credits tech'],
        ['changelog.txt', 'document', () => openChangelog(), 'versions history updates'],
        ['blogroll.txt', 'document', () => openFriends(), 'friends links webring'],
        ['88x31 buttons', 'document', () => openButtonWall(), 'badge banner link to me'],
        ['the shrine', 'document', () => openShrine(), 'favourites love'],
        ['my internet life', 'document', () => openInternetHistory(), 'timeline history nostalgia'],
        ['site map', 'document', () => openSiteMap(), 'index everything'],
        ['rss feed', 'document', () => window.open('feed.xml', '_blank', 'noopener'), 'subscribe atom xml'],
        ['jokerz 98', 'game', () => openBalatro(), 'balatro poker roguelike deckbuilder jokers blinds antes shop tarot planet spectral voucher'],
        ['sir, we have a troll problem', 'game', () => openTrollProblem(), 'tower defense td orcs trolls waves towers maze path lives upgrade crystals strategy'],
        ['solitaire', 'game', () => openSolitaire(), 'klondike cards patience'],
        ['minesweeper', 'game', () => openMinesweeper(), 'mines bombs flags'],
        ['snake', 'game', () => openSnake(), 'nokia arcade'],
        ['pong', 'game', () => openPong(), 'tennis arcade'],
        ['which track are you?', 'game', () => openQuiz(), 'quiz personality test'],
        ['achievements', 'game', () => openAchievements(), 'trophies unlocks'],
        ['magic 8-ball', 'toy', () => openMagic8Ball(), 'fortune answers'],
        ['visitor poll', 'toy', () => openPoll(), 'vote survey'],
        ['web ring', 'toy', () => openWebRing(), 'neighbours sites'],
        ['notepad', 'program', () => openNotepad(), 'text editor write'],
        ['calculator', 'program', () => openCalculator(), 'math sums'],
        ['ms-dos prompt', 'program', () => openTerminal(), 'cmd shell console command'],
        ['paint', 'program', () => openPaint(), 'draw mspaint canvas'],
        ['character map', 'program', () => openCharMap(), 'symbols unicode ascii'],
        ['clock', 'program', () => openClock(), 'time analog'],
        ['my computer', 'program', () => openMyComputer(), 'drives explorer files'],
        ['recycle bin', 'program', () => openRecycleBin(), 'trash deleted'],
        ['dial-up networking', 'program', () => openDialUp(), 'modem connect internet 56k'],
        ['task manager', 'program', () => openTaskManager(), 'processes kill ctrl alt del'],
        ['defrag.exe', 'program', () => openDefrag(), 'disk defragmenter drive c blocks'],
        ['display properties', 'settings', () => openControlPanel(), 'wallpaper theme screensaver background'],
        ['system properties', 'settings', () => openSystemProperties(), 'specs about pc'],
        ['equalizer', 'settings', () => openEqualizer(), 'audio bands sound'],
        ['oscilloscope', 'settings', () => openOscilloscope(), 'waveform visualiser'],
        ['site statistics', 'settings', () => openSiteStats(), 'hits visitors counter'],
        ['keyboard shortcuts', 'settings', () => showShortcuts(), 'keys hotkeys'],
        ['screensaver', 'settings', () => startScreensaver(), 'mystify starfield pipes flying windows idle'],
        ['reset all effects', 'settings', () => resetAllModes(), 'clear undo normal']
    ].map(([name, kind, act, keywords]) => ({ name, kind, act, keywords }));
}

function openFindFiles(initialQuery) {
    const { body } = createAppWindow('find: files containing text', { icon: 'search', width: 380 });
    const index = siteSearchIndex();
    body.innerHTML = `
        <div class="find-bar">
            <label>named:</label>
            <input class="bevel-in find-input" data-q placeholder="type anything..." autocomplete="off" spellcheck="false">
        </div>
        <div class="find-results bevel-in" data-results></div>
        <div class="find-foot" data-count></div>`;

    const input = body.querySelector('[data-q]');
    const results = body.querySelector('[data-results]');
    const count = body.querySelector('[data-count]');

    const search = () => {
        const q = input.value.trim().toLowerCase();
        const hits = q
            ? index.filter(e => e.name.toLowerCase().includes(q) || e.keywords.includes(q) ||
                q.split(/\s+/).every(w => (e.name + ' ' + e.keywords + ' ' + e.kind).includes(w)))
            : index;
        results.innerHTML = hits.length
            ? hits.map(e => `<button class="find-row" data-i="${index.indexOf(e)}">
                    <span class="find-name">${escapeHtml(e.name)}</span>
                    <span class="find-kind">${escapeHtml(e.kind)}</span>
                </button>`).join('')
            : '<div class="find-empty">no files found matching your search. try "game", "paint", "rss".</div>';
        count.textContent = `${hits.length} item(s) found`;
        results.querySelectorAll('.find-row').forEach(r => r.onclick = () => {
            playSound('navigate');
            index[+r.dataset.i].act();
        });
    };

    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { const f = results.querySelector('.find-row'); if (f) f.click(); }
    });
    if (initialQuery) input.value = initialQuery;
    search();
    setTimeout(() => input.focus(), 50);
}
