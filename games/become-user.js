// ===================================================================
// BECOME USER — engine
//
// walks the node graph in become-user-data.js and renders it. it knows
// nothing about the story: every scene, branch, ending and piece of
// dialogue lives in the data file, so the story can be rewritten without
// touching a line of this.
//
// the scene is a 2d canvas (backdrop layers + animated character shapes)
// and the dialogue, choices and timers are dom on top of it — which is
// what the genre's layout has always been, and which means the canvas
// scales cleanly when the window goes fullscreen.
// ===================================================================

const BU_SAVE = 'becomeuser-run-v1';
const BU_META = 'becomeuser-meta-v1';

let BUG = null;          // the run in progress
let buWin = null, buBody = null;
let buCtx = null, buCanvas = null;
let buRAF = null, buT0 = 0;
let buImgs = {};
let buTimer = null;      // active choice/qte deadline
let buType = null;       // typewriter state

// ===================================================================
// storage
// ===================================================================
function buLoadMeta() {
    try {
        const m = JSON.parse(localStorage.getItem(BU_META) || '{}');
        return {
            endings: Array.isArray(m.endings) ? m.endings : [],
            chapters: m.chapters && typeof m.chapters === 'object' ? m.chapters : {},
            choices: m.choices && typeof m.choices === 'object' ? m.choices : {},
            runs: m.runs || 0
        };
    } catch (e) { return { endings: [], chapters: {}, choices: {}, runs: 0 }; }
}
function buSaveMeta(m) { try { localStorage.setItem(BU_META, JSON.stringify(m)); } catch (e) { } }
function buSaveRun() {
    if (!BUG || BUG.screen !== 'play') return;
    try {
        localStorage.setItem(BU_SAVE, JSON.stringify({
            node: BUG.nodeId, flags: BUG.flags, stats: BUG.stats, chapter: BUG.chapter, path: BUG.path
        }));
    } catch (e) { }
}
function buClearRun() { try { localStorage.removeItem(BU_SAVE); } catch (e) { } }
function buHasRun() { try { return !!localStorage.getItem(BU_SAVE); } catch (e) { return false; } }

// ===================================================================
// flags + conditions
// ===================================================================
function buApplySet(set) {
    if (!set) return;
    for (const [k, v] of Object.entries(set)) {
        if (k.endsWith('+')) {
            const key = k.slice(0, -1);
            BUG.stats[key] = (BUG.stats[key] || 0) + Number(v);
        } else if (k.endsWith('-')) {
            const key = k.slice(0, -1);
            BUG.stats[key] = Math.max(0, (BUG.stats[key] || 0) - Number(v));
        } else {
            BUG.flags[k] = v;
        }
    }
}

function buCheck(cond) {
    if (!cond) return true;
    for (const [k, v] of Object.entries(cond)) {
        if (k === 'minTrust') { if ((BUG.stats.trust || 0) < v) return false; continue; }
        if (k === 'minAwake') { if ((BUG.stats.awake || 0) < v) return false; continue; }
        if (k === 'maxSuspicion') { if ((BUG.stats.suspicion || 0) > v) return false; continue; }
        if (k === 'anySaved') {
            const f = BUG.flags;
            if (!(f.saveScrn || f.saveAssist || f.saveBuddy || f.saveSelf)) return false;
            continue;
        }
        if (!!BUG.flags[k] !== !!v) return false;
    }
    return true;
}

// ===================================================================
// run lifecycle
// ===================================================================
function buNewRun(fromChapter) {
    const meta = buLoadMeta();
    BUG = {
        screen: 'play', meta,
        flags: {}, stats: { awake: 0, trust: 5, suspicion: 0 },
        chapter: fromChapter || 'c1',
        nodeId: null, node: null,
        path: [],            // node ids visited this run, for the flowchart
        phase: 'idle',
        choices: null, selected: -1,
        qte: null, inspect: null,
        deadline: 0, duration: 0
    };
    const ch = BU.CHAPTERS.find(c => c.id === BUG.chapter) || BU.CHAPTERS[0];
    buGoto(ch.entry);
}

function buResume() {
    const meta = buLoadMeta();
    let s;
    try { s = JSON.parse(localStorage.getItem(BU_SAVE) || 'null'); } catch (e) { s = null; }
    if (!s || !BU.NODES[s.node]) { buNewRun(); return; }
    BUG = {
        screen: 'play', meta,
        flags: s.flags || {}, stats: s.stats || { awake: 0, trust: 5, suspicion: 0 },
        chapter: s.chapter || 'c1', nodeId: null, node: null,
        path: Array.isArray(s.path) ? s.path : [],
        phase: 'idle', choices: null, selected: -1, qte: null, inspect: null, deadline: 0, duration: 0
    };
    buGoto(s.node, true);
}

function buGoto(id, skipSet) {
    buStopTimer();
    const node = BU.NODES[id];
    if (!node) { console.warn('become user: missing node', id); buFinishChapter(); return; }

    // conditional redirects run before anything else the node does
    if (node.goto) {
        for (const g of node.goto) {
            if (buCheck(g.if)) { buGoto(g.to, skipSet); return; }
        }
    }

    BUG.nodeId = id;
    BUG.node = node;
    if (node.ch) BUG.chapter = node.ch;
    if (!skipSet) buApplySet(node.set);
    if (!BUG.path.includes(id)) BUG.path.push(id);
    BUG.meta.choices[id] = true;

    BUG.choices = null; BUG.qte = null; BUG.inspect = null; BUG.selected = -1;

    if (node.type === 'line') {
        BUG.phase = 'line';
        buStartType(node.text);
    } else if (node.type === 'choice') {
        BUG.phase = 'choice';
        BUG.choices = (node.options || []).filter(o => buCheck(o.req));
        buStartTimer(node.time || 10000);
        buStartType(node.prompt || '');
    } else if (node.type === 'qte') {
        BUG.phase = 'qte';
        BUG.qte = { keys: node.keys.slice(), at: 0, wrong: 0 };
        buStartTimer(node.time || 6000);
        buStartType(node.prompt || '');
    } else if (node.type === 'inspect') {
        BUG.phase = 'inspect';
        BUG.inspect = {
            found: [], need: node.need || 1,
            spots: (node.spots || []).filter(s => buCheck(s.req)),
            reading: null
        };
        buStartType(node.prompt || '');
    } else if (node.type === 'chapter') {
        buFinishChapter();
        return;
    } else if (node.type === 'resolve') {
        buResolveEnding();
        return;
    }
    buSaveRun();
    buRender();
}

function buAdvance() {
    const n = BUG.node;
    if (!n) return;
    if (BUG.phase === 'line') {
        if (buType && !buType.done) { buType.i = buType.text.length; buType.done = true; buRenderText(); return; }
        buGoto(n.next);
    }
}

// ---------- timers ----------
function buStartTimer(ms) {
    BUG.duration = ms;
    BUG.deadline = performance.now() + ms;
}
function buStopTimer() { BUG.deadline = 0; BUG.duration = 0; }
function buTimeLeft() {
    if (!BUG || !BUG.deadline) return 1;
    return Math.max(0, (BUG.deadline - performance.now()) / BUG.duration);
}

// ---------- typewriter ----------
function buStartType(text) {
    buType = { text: String(text || ''), i: 0, done: false, last: performance.now() };
}
function buTickType(now) {
    if (!buType || buType.done) return false;
    const speed = 22;                       // ms per character
    let changed = false;
    while (now - buType.last > speed && buType.i < buType.text.length) {
        buType.i++; buType.last += speed; changed = true;
    }
    if (buType.i >= buType.text.length) { buType.done = true; changed = true; }
    return changed;
}

// ===================================================================
// choices / qte / inspect
// ===================================================================
function buPickChoice(i) {
    if (BUG.phase !== 'choice' || !BUG.choices || !BUG.choices[i]) return;
    const opt = BUG.choices[i];
    buStopTimer();
    BUG.meta.choices[BUG.nodeId + '#' + i] = true;
    buApplySet(opt.set);
    if (typeof playSound === 'function') playSound('click');
    buGoto(opt.to);
}

function buChoiceTimeout() {
    if (BUG.phase !== 'choice') return;
    buStopTimer();
    if (typeof playSound === 'function') playSound('error');
    buGoto(BUG.node.timeout || (BUG.choices[0] && BUG.choices[0].to));
}

function buQteKey(key) {
    if (BUG.phase !== 'qte' || !BUG.qte) return;
    const want = BUG.qte.keys[BUG.qte.at];
    const hit = key === want || key.toLowerCase() === String(want).toLowerCase();
    if (hit) {
        BUG.qte.at++;
        if (typeof playSound === 'function') playSound('click');
        if (BUG.qte.at >= BUG.qte.keys.length) {
            buStopTimer();
            buGoto(BUG.node.to);
            return;
        }
    } else {
        BUG.qte.wrong++;
        // a wrong key costs time rather than failing outright, so a slip is
        // recoverable but not free
        BUG.deadline -= 700;
        if (typeof playSound === 'function') playSound('error');
    }
    buRender();
}

function buQteTimeout() {
    if (BUG.phase !== 'qte') return;
    buStopTimer();
    if (typeof playSound === 'function') playSound('error');
    buGoto(BUG.node.fail || BUG.node.to);
}

function buInspectClick(sx, sy) {
    if (BUG.phase !== 'inspect' || !BUG.inspect) return;
    const ins = BUG.inspect;
    if (ins.reading) { ins.reading = null; buRender(); return; }
    for (let i = 0; i < ins.spots.length; i++) {
        const s = ins.spots[i];
        if (ins.found.includes(i)) continue;
        if (Math.hypot(sx - s.x, sy - s.y) <= s.r + 6) {
            ins.found.push(i);
            buApplySet(s.set);
            ins.reading = s;
            if (typeof playSound === 'function') playSound('ding');
            buSaveRun();
            buRender();
            return;
        }
    }
}

function buInspectDone() {
    if (BUG.phase !== 'inspect') return;
    if (BUG.inspect.found.length < BUG.inspect.need) return;
    buGoto(BUG.node.to);
}

// ===================================================================
// chapter / ending resolution
// ===================================================================
function buFinishChapter() {
    const node = BUG.node && BUG.node.type === 'chapter' ? BUG.node : null;
    BUG.meta.chapters[BUG.chapter] = true;
    buSaveMeta(BUG.meta);
    BUG.screen = 'chapterEnd';
    BUG.chapterCard = node ? { title: node.title, text: node.text } : { title: '', text: '' };
    buStopTimer();
    buSaveRun();
    if (typeof unlockAchievement === 'function' && BUG.chapter === 'c1') unlockAchievement('become_user');
    buRender();
}

function buNextChapter() {
    const i = BU.CHAPTERS.findIndex(c => c.id === BUG.chapter);
    const next = BU.CHAPTERS[i + 1];
    if (!next) { buResolveEnding(); return; }
    BUG.chapter = next.id;
    BUG.screen = 'play';
    buGoto(next.entry);
}

function buResolveEnding() {
    const end = BU.ENDINGS.find(e => buCheck(e.if)) || BU.ENDINGS[BU.ENDINGS.length - 1];
    BUG.ending = end;
    BUG.screen = 'ending';
    BUG.meta.runs++;
    if (!BUG.meta.endings.includes(end.id)) BUG.meta.endings.push(end.id);
    BU.CHAPTERS.forEach(c => BUG.meta.chapters[c.id] = true);
    buSaveMeta(BUG.meta);
    buClearRun();
    buStopTimer();
    if (typeof unlockAchievement === 'function') {
        unlockAchievement('become_user_end');
        if (BUG.meta.endings.length >= 4) unlockAchievement('become_user_all');
    }
    buRender();
}

// ===================================================================
// scene rendering
// ===================================================================
function buImg(src) {
    if (!buImgs[src]) { const i = new Image(); i.src = src; buImgs[src] = i; }
    return buImgs[src];
}

function buDrawBackdrop(ctx, layers, t) {
    layers.forEach(L => {
        if (L.t === 'grad') {
            const g = ctx.createLinearGradient(0, 0, 0, BU.H);
            g.addColorStop(0, L.from); g.addColorStop(1, L.to);
            ctx.fillStyle = g; ctx.fillRect(0, 0, BU.W, BU.H);
        } else if (L.t === 'grid') {
            ctx.strokeStyle = L.color; ctx.lineWidth = 1;
            for (let x = 0; x <= BU.W; x += L.size) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, BU.H); ctx.stroke(); }
            for (let y = 0; y <= BU.H; y += L.size) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(BU.W, y); ctx.stroke(); }
        } else if (L.t === 'window') {
            ctx.fillStyle = '#c0c0c0';
            ctx.fillRect(L.x, L.y, L.w, L.h);
            ctx.fillStyle = '#000080';
            ctx.fillRect(L.x + 3, L.y + 3, L.w - 6, 16);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px "MS Sans Serif", Tahoma, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(L.title, L.x + 7, L.y + 15);
            ctx.fillStyle = '#fff';
            ctx.fillRect(L.x + 6, L.y + 23, L.w - 12, L.h - 30);
            if (L.body === 'text') {
                ctx.fillStyle = '#8a8a8a';
                for (let i = 0; i < 7; i++) {
                    const w = (L.w - 30) * (0.45 + ((i * 37) % 50) / 100);
                    ctx.fillRect(L.x + 12, L.y + 34 + i * 14, w, 3);
                }
                // the cursor, blinking at the end of an unfinished sentence
                if (Math.floor(t / 500) % 2 === 0) {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(L.x + 12 + (L.w - 30) * 0.52, L.y + 130, 2, 10);
                }
            } else if (L.body === 'progress') {
                ctx.fillStyle = '#000';
                ctx.font = '10px "MS Sans Serif", Tahoma, sans-serif';
                ctx.fillText('Copying files...', L.x + 14, L.y + 44);
                ctx.strokeStyle = '#808080';
                ctx.strokeRect(L.x + 14, L.y + 56, L.w - 40, 14);
                ctx.fillStyle = '#000080';
                const p = 0.94 + 0.03 * Math.sin(t / 900);
                for (let i = 0; i < Math.floor((L.w - 44) * p / 8); i++) {
                    ctx.fillRect(L.x + 16 + i * 8, L.y + 58, 6, 10);
                }
            }
        } else if (L.t === 'taskbar') {
            ctx.fillStyle = '#c0c0c0';
            ctx.fillRect(0, BU.H - 22, BU.W, 22);
            ctx.fillStyle = '#fff'; ctx.fillRect(0, BU.H - 22, BU.W, 2);
            ctx.fillStyle = '#000';
            ctx.font = 'bold 10px "MS Sans Serif", Tahoma, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Start', 10, BU.H - 8);
        } else if (L.t === 'sectors') {
            const cols = 32, rows = 14, cw = BU.W / cols, chh = 150 / rows;
            for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
                const n = (x * 7 + y * 13 + Math.floor(t / 700)) % 11;
                const bad = L.bad && x === 19 && y === 6;
                ctx.fillStyle = bad ? '#ff4a4a' : n < 5 ? '#1e5f7a' : n < 8 ? '#134454' : '#0b2d38';
                ctx.fillRect(20 + x * (cw - 0.6) * 0.62, 100 + y * chh, (cw - 0.6) * 0.62 - 2, chh - 2);
            }
        } else if (L.t === 'stars') {
            for (let i = 0; i < 90; i++) {
                const a = (i * 2654435761) % 1000 / 1000;
                const b = (i * 40503) % 1000 / 1000;
                const x = (a * BU.W + t * (0.01 + a * 0.02)) % BU.W;
                const y = b * BU.H;
                const s = a > 0.85 ? 2 : 1;
                ctx.fillStyle = `rgba(220,210,255,${0.25 + b * 0.6})`;
                ctx.fillRect(x, y, s, s);
            }
        } else if (L.t === 'rain') {
            ctx.font = '11px "Courier New", monospace';
            for (let c = 0; c < 26; c++) {
                const x = 8 + c * 24;
                const speed = 40 + ((c * 53) % 60);
                const y = ((t / 1000) * speed + c * 37) % (BU.H + 60);
                for (let k = 0; k < 5; k++) {
                    ctx.fillStyle = `rgba(80,255,140,${0.5 - k * 0.1})`;
                    ctx.fillText(String.fromCharCode(48 + ((c * 7 + k * 3 + Math.floor(t / 120)) % 2)), x, y - k * 13);
                }
            }
        } else if (L.t === 'clock') {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.font = 'bold 82px "Courier New", monospace';
            ctx.textAlign = 'center';
            const sec = 48 + Math.floor(t / 1000) % 12;
            ctx.fillText(`23:59:${String(sec).padStart(2, '0')}`, BU.W / 2, 150);
        } else if (L.t === 'scanlines') {
            ctx.fillStyle = 'rgba(0,0,0,0.16)';
            for (let y = 0; y < BU.H; y += 3) ctx.fillRect(0, y, BU.W, 1);
        } else if (L.t === 'vignette') {
            const g = ctx.createRadialGradient(BU.W / 2, BU.H / 2, BU.H * 0.3, BU.W / 2, BU.H / 2, BU.H * 0.85);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,0.55)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, BU.W, BU.H);
        }
    });
}

function buDrawActor(ctx, a, t, speaking) {
    const def = BU.CHARS[a.id];
    if (!def) return;
    const s = a.s || 1;
    const bob = Math.sin(t / 700 + a.x) * 3;
    const x = a.x, y = a.y + bob;
    ctx.save();
    if (a.faded) ctx.globalAlpha = 0.5;

    // glow when this character is the one talking
    if (speaking) {
        ctx.shadowColor = def.color;
        ctx.shadowBlur = 22;
    }

    const bodyW = 54 * s, bodyH = 66 * s;
    ctx.fillStyle = def.dark;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;

    if (def.shape === 'clip') {
        // a rounded window pane — the helper is a dialog box that learned to walk
        ctx.beginPath();
        ctx.roundRect(x - bodyW / 2, y - bodyH / 2, bodyW, bodyH, 8 * s);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = def.color;
        ctx.fillRect(x - bodyW / 2 + 3, y - bodyH / 2 + 3, bodyW - 6, 9 * s);
    } else if (def.shape === 'blocks') {
        // a grid of allocation blocks, shuffling
        const n = 4;
        const bw = bodyW / n;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const lit = ((i * 3 + j * 5 + Math.floor(t / 260)) % 7) < 3;
            ctx.fillStyle = lit ? def.color : def.dark;
            ctx.fillRect(x - bodyW / 2 + i * bw + 1, y - bodyH / 2 + j * (bodyH / n) + 1, bw - 2, bodyH / n - 2);
        }
        ctx.strokeRect(x - bodyW / 2, y - bodyH / 2, bodyW, bodyH);
    } else if (def.shape === 'stars') {
        // a constellation that only holds together while you look at it
        ctx.beginPath();
        ctx.arc(x, y, bodyW / 2, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        for (let i = 0; i < 9; i++) {
            const ang = t / 1400 + i * (Math.PI * 2 / 9);
            const r = bodyW / 2 - 6 - (i % 3) * 5;
            ctx.fillStyle = def.color;
            ctx.fillRect(x + Math.cos(ang) * r - 1, y + Math.sin(ang) * r - 1, 2.5, 2.5);
        }
    }

    // the site's own emoji art, used as a face
    if (def.face) {
        const img = buImg(def.face);
        if (img.complete && img.naturalWidth) {
            const fs = 30 * s;
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y + 2 * s, fs / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = def.color;
            ctx.fill();
            ctx.globalCompositeOperation = 'multiply';
            ctx.drawImage(img, x - fs / 2, y + 2 * s - fs / 2, fs, fs);
            ctx.restore();
            ctx.strokeStyle = def.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(x, y + 2 * s, fs / 2, 0, Math.PI * 2); ctx.stroke();
        }
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = speaking ? '#fff' : 'rgba(255,255,255,0.5)';
    ctx.font = `bold ${9 * Math.max(0.9, s)}px "MS Sans Serif", Tahoma, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(def.name, x, y + bodyH / 2 + 14);
    ctx.restore();
}

function buDraw(t) {
    if (!buCtx || !BUG || !BUG.node) return;
    const ctx = buCtx;
    const node = BUG.node;
    ctx.clearRect(0, 0, BU.W, BU.H);
    buDrawBackdrop(ctx, BU.BACKDROPS[node.bg] || BU.BACKDROPS.black, t);

    const speaker = node.speaker;
    (node.actors || []).forEach(a => buDrawActor(ctx, a, t, a.id === speaker));

    // inspect hotspots
    if (BUG.phase === 'inspect' && BUG.inspect) {
        BUG.inspect.spots.forEach((s, i) => {
            const found = BUG.inspect.found.includes(i);
            const pulse = 1 + Math.sin(t / 380 + i) * 0.12;
            ctx.strokeStyle = found ? 'rgba(120,220,140,0.85)' : 'rgba(255,255,255,0.75)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (found ? 1 : pulse), 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = found ? 'rgba(120,220,140,0.16)' : 'rgba(255,255,255,0.10)';
            ctx.fill();
            if (found) {
                ctx.fillStyle = '#9df0b0';
                ctx.font = 'bold 13px "MS Sans Serif", Tahoma, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('✓', s.x, s.y + 5);
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 15px "MS Sans Serif", Tahoma, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('?', s.x, s.y + 5);
            }
        });
    }

    // the timer bar lives on the canvas so it reads as part of the scene
    if (BUG.deadline) {
        const p = buTimeLeft();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, BU.W, 6);
        ctx.fillStyle = p > 0.5 ? '#7ee06a' : p > 0.25 ? '#ffd400' : '#ff5a5a';
        ctx.fillRect(0, 0, BU.W * p, 6);
    }
}

// ===================================================================
// the loop
// ===================================================================
function buLoop(now) {
    if (!BUG || !buCanvas || !document.body.contains(buCanvas)) { buRAF = null; return; }
    buRAF = requestAnimationFrame(buLoop);
    const t = now - buT0;

    if (buTickType(now)) buRenderText();

    if (BUG.deadline && now >= BUG.deadline) {
        if (BUG.phase === 'choice') buChoiceTimeout();
        else if (BUG.phase === 'qte') buQteTimeout();
    }
    buDraw(t);
}
function buLoopStart() {
    if (buRAF) return;
    buT0 = performance.now();
    buRAF = requestAnimationFrame(buLoop);
}
function buLoopStop() { if (buRAF) cancelAnimationFrame(buRAF); buRAF = null; }

// ===================================================================
// ui
// ===================================================================
function startBecomeUser() {
    if (buWin && document.body.contains(buWin)) { buWin.style.display = 'flex'; return; }
    const { body, win } = createAppWindow('become user', { icon: 'movie', width: 660 });
    buWin = win; buBody = body;
    body.classList.add('bu-body');
    const meta = buLoadMeta();
    BUG = { screen: 'menu', meta, flags: {}, stats: {}, path: [] };
    buRender();
    buBindKeys();
}

let buKeyHandler = null;
function buBindKeys() {
    if (buKeyHandler) document.removeEventListener('keydown', buKeyHandler);
    buKeyHandler = (e) => {
        if (!BUG || !buWin || !document.body.contains(buWin)) {
            document.removeEventListener('keydown', buKeyHandler); buKeyHandler = null; return;
        }
        if (BUG.screen !== 'play') return;
        if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
        if (BUG.phase === 'qte') { e.preventDefault(); buQteKey(e.key); return; }
        if (BUG.phase === 'line' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); buAdvance(); return; }
        if (BUG.phase === 'choice' && /^[1-5]$/.test(e.key)) { e.preventDefault(); buPickChoice(+e.key - 1); }
    };
    document.addEventListener('keydown', buKeyHandler);
}

function buRender() {
    if (!buBody || !BUG) return;
    ({
        menu: buRenderMenu, play: buRenderPlay, chapterEnd: buRenderChapterEnd,
        ending: buRenderEnding, flow: buRenderFlow, chapters: buRenderChapters
    })[BUG.screen === 'play' ? 'play' : BUG.screen](buBody);
}

function buRenderMenu(host) {
    buLoopStop();
    const m = BUG.meta;
    const done = BU.CHAPTERS.filter(c => m.chapters[c.id]).length;
    host.innerHTML = `
        <div class="bu-menu">
            <div class="bu-title">BECOME USER</div>
            <div class="bu-sub">an interactive drama in nine chapters</div>
            <p class="bu-pitch">It is 1999. Three programs on one home computer start noticing that they are running.
                On the first of January the machine gets a patch that replaces everything written before 1997.<br><br>
                Your choices are timed. What you miss, you miss. Any of them can be lost for good.</p>
            <div class="bu-cast">
                ${BU.PLAYABLE.map(id => {
        const c = BU.CHARS[id];
        return `<div class="bu-cast-card" style="--c:${c.color}">
                        <div class="bu-cast-name">${escapeHtml(c.name)}</div>
                        <div class="bu-cast-role">${escapeHtml(c.role)}</div>
                        <div class="bu-cast-blurb">${escapeHtml(c.blurb)}</div>
                    </div>`;
    }).join('')}
            </div>
            <div class="bu-menu-btns">
                ${buHasRun() ? '<button class="bevel-out bu-btn bu-primary" id="bu-resume">continue</button>' : ''}
                <button class="bevel-out bu-btn${buHasRun() ? '' : ' bu-primary'}" id="bu-new">new story</button>
                <button class="bevel-out bu-btn" id="bu-chapters">chapters (${done}/9)</button>
                <button class="bevel-out bu-btn" id="bu-endings">endings (${m.endings.length}/${BU.ENDINGS.length})</button>
            </div>
            <p class="bu-legal">an original story. characters, setting and dialogue written for this site.</p>
        </div>`;
    const r = host.querySelector('#bu-resume');
    if (r) r.onclick = () => { buResume(); buLoopStart(); };
    host.querySelector('#bu-new').onclick = () => {
        if (buHasRun()) {
            showRetroDialog({
                title: 'new story', lines: ['this throws away the run you have in progress.'],
                okLabel: 'start over', cancelLabel: 'nevermind',
                onOk: () => { buClearRun(); buNewRun(); buLoopStart(); }
            });
        } else { buNewRun(); buLoopStart(); }
    };
    host.querySelector('#bu-chapters').onclick = () => { BUG.screen = 'chapters'; buRender(); };
    host.querySelector('#bu-endings').onclick = () => { BUG.screen = 'flow'; buRender(); };
}

function buRenderChapters(host) {
    const m = BUG.meta;
    host.innerHTML = `
        <div class="bu-page">
            <div class="bu-page-head"><strong>chapters</strong>
                <button class="bevel-out bu-mini" id="bu-back">back</button></div>
            <p class="bu-hint">replay any chapter you have reached. a replayed chapter starts with a clean slate, so the story around it may not match the run you remember.</p>
            <div class="bu-chlist">
                ${BU.CHAPTERS.map(c => {
        const open = c.id === 'c1' || m.chapters[c.id];
        const ch = BU.CHARS[c.char];
        return `<button class="bevel-out bu-chcard${open ? '' : ' locked'}" data-ch="${c.id}" ${open ? '' : 'disabled'} style="--c:${ch.color}">
                        <span class="bu-chn">${c.n}</span>
                        <span class="bu-chtitle">${open ? escapeHtml(c.title) : '— — —'}</span>
                        <span class="bu-chwho">${escapeHtml(ch.name)}</span>
                        <span class="bu-chdate">${c.date}</span>
                    </button>`;
    }).join('')}
            </div>
        </div>`;
    host.querySelector('#bu-back').onclick = () => { BUG.screen = 'menu'; buRender(); };
    host.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
        buClearRun(); buNewRun(b.dataset.ch); buLoopStart();
    });
}

function buRenderFlow(host) {
    const m = BUG.meta;
    host.innerHTML = `
        <div class="bu-page">
            <div class="bu-page-head"><strong>endings</strong>
                <button class="bevel-out bu-mini" id="bu-back">back</button></div>
            <p class="bu-hint">${m.endings.length} of ${BU.ENDINGS.length} found across ${m.runs} finished ${m.runs === 1 ? 'run' : 'runs'}.</p>
            <div class="bu-endlist">
                ${BU.ENDINGS.map(e => {
        const got = m.endings.includes(e.id);
        return `<div class="bu-endcard bevel-in ${got ? 'got tone-' + e.tone : 'locked'}">
                        <div class="bu-endname">${got ? escapeHtml(e.title) : '???'}</div>
                        <div class="bu-endtext">${got ? escapeHtml(e.text.split('\n')[0]) : 'not reached yet.'}</div>
                    </div>`;
    }).join('')}
            </div>
        </div>`;
    host.querySelector('#bu-back').onclick = () => { BUG.screen = 'menu'; buRender(); };
}

function buRenderPlay(host) {
    const node = BUG.node;
    if (!node) return;
    const ch = BU.CHAPTERS.find(c => c.id === BUG.chapter) || BU.CHAPTERS[0];
    const pov = BU.CHARS[node.char || ch.char] || BU.CHARS.assist;

    if (!host.querySelector('#bu-canvas')) {
        host.innerHTML = `
            <div class="bu-hud">
                <span class="bu-ch">CH ${ch.n} · ${escapeHtml(ch.title)}</span>
                <span class="bu-date">${ch.date}</span>
                <span class="bu-pov" id="bu-pov"></span>
                <span class="bu-stats" id="bu-stats"></span>
                <button class="bevel-out bu-mini" id="bu-quit">menu</button>
            </div>
            <canvas id="bu-canvas" class="bu-canvas bevel-in" width="${BU.W}" height="${BU.H}"></canvas>
            <div class="bu-stage" id="bu-stage"></div>`;
        buCanvas = host.querySelector('#bu-canvas');
        buCtx = buCanvas.getContext('2d');
        buCanvas.addEventListener('click', (e) => {
            const r = buCanvas.getBoundingClientRect();
            const sx = (e.clientX - r.left) * (BU.W / r.width);
            const sy = (e.clientY - r.top) * (BU.H / r.height);
            if (BUG.phase === 'inspect') buInspectClick(sx, sy);
            else if (BUG.phase === 'line') buAdvance();
        });
        host.querySelector('#bu-quit').onclick = () => {
            buLoopStop(); buSaveRun();
            BUG.screen = 'menu'; BUG.meta = buLoadMeta(); buRender();
        };
    } else {
        const hud = host.querySelector('.bu-ch');
        if (hud) hud.textContent = `CH ${ch.n} · ${ch.title}`;
        const d = host.querySelector('.bu-date');
        if (d) d.textContent = ch.date;
    }

    const povEl = host.querySelector('#bu-pov');
    if (povEl) { povEl.textContent = pov.name; povEl.style.color = pov.color; }
    const statsEl = host.querySelector('#bu-stats');
    if (statsEl) {
        statsEl.innerHTML = BU.STATS.map(s => {
            const v = BUG.stats[s.k] || 0;
            const p = Math.max(0, Math.min(1, v / s.max));
            return `<span class="bu-stat" title="${s.label}: ${v}">
                <span class="bu-stat-label">${s.label}</span>
                <span class="bu-stat-bar"><span style="width:${(p * 100).toFixed(0)}%;background:${s.color}"></span></span>
            </span>`;
        }).join('');
    }
    buRenderStage();
    buLoopStart();
}

function buRenderStage() {
    const stage = buBody && buBody.querySelector('#bu-stage');
    if (!stage || !BUG.node) return;
    const node = BUG.node;
    const sp = BU.CHARS[node.speaker];

    if (BUG.phase === 'line') {
        stage.innerHTML = `
            <div class="bu-box bevel-in" id="bu-box">
                ${sp && sp.name ? `<div class="bu-speaker" style="color:${sp.color}">${escapeHtml(sp.name)}</div>` : ''}
                <div class="bu-text" id="bu-text"></div>
                <div class="bu-next">click, or space ▸</div>
            </div>`;
        stage.querySelector('#bu-box').onclick = () => buAdvance();

    } else if (BUG.phase === 'choice') {
        stage.innerHTML = `
            <div class="bu-box bevel-in">
                <div class="bu-prompt" id="bu-text"></div>
            </div>
            <div class="bu-choices">
                ${BUG.choices.map((o, i) => `
                    <button class="bevel-out bu-choice" data-i="${i}">
                        <span class="bu-key">${i + 1}</span>
                        <span class="bu-ctext">${escapeHtml(o.text)}</span>
                        ${o.tag ? `<span class="bu-tag">${escapeHtml(o.tag)}</span>` : ''}
                    </button>`).join('')}
            </div>`;
        stage.querySelectorAll('[data-i]').forEach(b => b.onclick = () => buPickChoice(+b.dataset.i));

    } else if (BUG.phase === 'qte') {
        const q = BUG.qte;
        stage.innerHTML = `
            <div class="bu-box bevel-in">
                <div class="bu-prompt" id="bu-text"></div>
            </div>
            <div class="bu-qte">
                ${q.keys.map((k, i) => `<span class="bu-qkey${i < q.at ? ' hit' : i === q.at ? ' now' : ''}">${escapeHtml(buKeyLabel(k))}</span>`).join('')}
            </div>
            <div class="bu-qte-hint">${q.at >= q.keys.length ? '' : 'press them in order · a wrong key costs time'}</div>
            <div class="bu-qte-touch">
                ${[...new Set(q.keys)].map(k => `<button class="bevel-out bu-qbtn" data-k="${escapeHtml(k)}">${escapeHtml(buKeyLabel(k))}</button>`).join('')}
            </div>`;
        stage.querySelectorAll('[data-k]').forEach(b => b.onclick = () => buQteKey(b.dataset.k));

    } else if (BUG.phase === 'inspect') {
        const ins = BUG.inspect;
        stage.innerHTML = `
            <div class="bu-box bevel-in">
                <div class="bu-prompt" id="bu-text"></div>
                ${ins.reading ? `<div class="bu-found"><strong>${escapeHtml(ins.reading.label)}</strong><br>${escapeHtml(ins.reading.text)}</div>` : ''}
            </div>
            <div class="bu-inspect-bar">
                <span>${ins.found.length} / ${ins.spots.length} examined · ${ins.need} needed</span>
                <button class="bevel-out bu-btn${ins.found.length >= ins.need ? ' bu-primary' : ''}" id="bu-done"
                    ${ins.found.length >= ins.need ? '' : 'disabled'}>move on</button>
            </div>`;
        const d = stage.querySelector('#bu-done');
        if (d) d.onclick = () => buInspectDone();
    }
    buRenderText();
}

function buKeyLabel(k) {
    return ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'SPACE' })[k] || String(k).toUpperCase();
}

function buRenderText() {
    const el = buBody && buBody.querySelector('#bu-text');
    if (!el || !buType) return;
    el.textContent = buType.text.slice(0, buType.i);
    if (!buType.done) el.classList.add('typing'); else el.classList.remove('typing');
}

function buRenderChapterEnd(host) {
    buLoopStop();
    const card = BUG.chapterCard || { title: '', text: '' };
    const ch = BU.CHAPTERS.find(c => c.id === BUG.chapter) || BU.CHAPTERS[0];
    const i = BU.CHAPTERS.findIndex(c => c.id === BUG.chapter);
    const next = BU.CHAPTERS[i + 1];

    // the flowchart: every node this chapter can reach, and which ones you hit
    const chNodes = Object.entries(BU.NODES).filter(([, n]) => n.ch === BUG.chapter);
    const decisions = chNodes.filter(([, n]) => n.type === 'choice' || n.type === 'qte');
    host.innerHTML = `
        <div class="bu-page bu-chend">
            <div class="bu-chend-title">CHAPTER ${ch.n} COMPLETE</div>
            <div class="bu-chend-name">${escapeHtml(card.title)}</div>
            <p class="bu-chend-text">${escapeHtml(card.text)}</p>

            <div class="bu-flow-head">what happened · what could have</div>
            <div class="bu-flow">
                ${decisions.map(([id, n]) => {
        const opts = (n.options || []);
        const taken = opts.findIndex((o, k) => BUG.meta.choices[id + '#' + k] && BUG.path.includes(o.to));
        return `<div class="bu-flownode">
                        <div class="bu-flowq">${escapeHtml(n.prompt || 'quick reflex')}</div>
                        <div class="bu-flowopts">
                            ${n.type === 'qte'
                ? `<span class="bu-flowopt ${BUG.path.includes(n.to) ? 'took' : 'missed'}">${BUG.path.includes(n.to) ? 'held it' : 'slipped'}</span>`
                : opts.map((o, k) => {
                    const took = BUG.path.includes(o.to) && k === taken;
                    const known = BUG.meta.choices[id + '#' + k];
                    return `<span class="bu-flowopt ${took ? 'took' : known ? 'known' : 'missed'}">${took || known ? escapeHtml(o.text) : '— — — — —'}</span>`;
                }).join('')}
                        </div>
                    </div>`;
    }).join('')}
            </div>

            <div class="bu-chend-btns">
                ${next ? `<button class="bevel-out bu-btn bu-primary" id="bu-next">chapter ${next.n} · ${escapeHtml(next.title)}</button>`
            : `<button class="bevel-out bu-btn bu-primary" id="bu-next">see how it ends</button>`}
                <button class="bevel-out bu-btn" id="bu-menu">menu</button>
            </div>
        </div>`;
    host.querySelector('#bu-next').onclick = () => { buNextChapter(); };
    host.querySelector('#bu-menu').onclick = () => { BUG.screen = 'menu'; BUG.meta = buLoadMeta(); buRender(); };
}

function buRenderEnding(host) {
    buLoopStop();
    const e = BUG.ending;
    const survivors = [];
    if (!BUG.flags.assistGone || BUG.flags.assistHidden || BUG.flags.saveAssist) survivors.push('ASSIST.EXE');
    if (!BUG.flags.betrayed || BUG.flags.saveSelf) survivors.push('DEFRAG.SYS');
    if (BUG.flags.saveScrn || !BUG.flags.betrayed) survivors.push('SCRNSVR.SCR');
    if (BUG.flags.buddyAlive && !BUG.flags.buddyDead) survivors.push('BUDDY.EXE');

    host.innerHTML = `
        <div class="bu-page bu-endpage tone-${e.tone}">
            <div class="bu-endlabel">ENDING</div>
            <div class="bu-endtitle">${escapeHtml(e.title)}</div>
            <p class="bu-endbody">${e.text.split('\n').map(l => escapeHtml(l)).join('<br>')}</p>
            <div class="bu-endstats">
                ${BU.STATS.map(s => `<span><b>${s.label}</b> ${BUG.stats[s.k] || 0}</span>`).join('')}
                <span><b>SCENES SEEN</b> ${BUG.path.length}</span>
                <span><b>ENDINGS FOUND</b> ${BUG.meta.endings.length}/${BU.ENDINGS.length}</span>
            </div>
            ${survivors.length ? `<p class="bu-survivors">still on the disk: ${escapeHtml([...new Set(survivors)].join(', '))}</p>` : '<p class="bu-survivors">nothing written before 1997 remains.</p>'}
            <div class="bu-chend-btns">
                <button class="bevel-out bu-btn bu-primary" id="bu-again">run it again</button>
                <button class="bevel-out bu-btn" id="bu-menu">menu</button>
            </div>
        </div>`;
    host.querySelector('#bu-again').onclick = () => { buClearRun(); buNewRun(); buLoopStart(); };
    host.querySelector('#bu-menu').onclick = () => { BUG.screen = 'menu'; BUG.meta = buLoadMeta(); buRender(); };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buCheck: () => { }, };
}
