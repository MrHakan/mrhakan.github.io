// ===================================================================
// defrag.js — Disk Defragmenter
//
// The one Windows 98 accessory everybody actually watched. It did
// nothing you could feel and you sat through it anyway, because the
// little coloured squares shuffling themselves into order was the most
// satisfying thing on the machine.
//
// This one defragments a real disk: `performance.getEntriesByType`
// knows every file this page has actually downloaded and how many bytes
// each one weighed, so the clusters on screen are this website. Hover
// one and it tells you which file lives there. The fragmentation is
// invented — the browser is not going to let anyone move anything — but
// the map is not.
// ===================================================================

(function () {
    'use strict';

    const COLS = 48, ROWS = 22;
    const TOTAL = COLS * ROWS;
    const FILL = 0.62;             // how much of the disk is in use

    // cluster states, in the palette the original used
    const FREE = 0, PLACED = 1, MOVE = 2, READ = 3, WRITE = 4, LOCKED = 5, BAD = 6;
    const COLOR = {
        [FREE]: '#e9e9e9',
        [PLACED]: '#4a7fe0',
        [MOVE]: '#152a6e',
        [READ]: '#12c95a',
        [WRITE]: '#ffd400',
        [LOCKED]: '#8a8a8a',
        [BAD]: '#c0392b'
    };
    const LEGEND = [
        [PLACED, 'data that does not need to move'],
        [MOVE, 'fragmented data'],
        [FREE, 'free space'],
        [READ, 'reading'],
        [WRITE, 'writing'],
        [LOCKED, 'unmovable'],
        [BAD, 'bad cluster']
    ];
    // the site's own scaffolding does not get shuffled about, the same
    // way the real one refused to move the swap file
    const UNMOVABLE = /(^\/?$|index\.html|\/sw\.js|style\.css)/;

    const SPEEDS = { slow: 26, normal: 90, turbo: 420 };   // clusters a second

    // ---------- what is actually on this disk ----------
    // the browser already knows: every resource it fetched, with the
    // real byte count. no extra requests, and it cannot lie.
    function realFiles() {
        const out = [];
        try {
            const seen = {};
            (performance.getEntriesByType('resource') || []).forEach(r => {
                const size = r.decodedBodySize || r.transferSize || 0;
                if (!size) return;
                let name;
                try { name = new URL(r.name).pathname; } catch (e) { name = String(r.name); }
                if (/^data:/.test(r.name) || seen[name]) return;
                seen[name] = true;
                out.push({ name: name, bytes: size });
            });
            const doc = performance.getEntriesByType('navigation')[0];
            if (doc && doc.decodedBodySize) out.unshift({ name: location.pathname, bytes: doc.decodedBodySize });
        } catch (e) { /* fall through to the stand-in below */ }
        if (out.length > 4) return out;
        // a browser that will not say, or a page opened from a file://
        return [
            { name: '/index.html', bytes: 96000 }, { name: '/style.css', bytes: 140000 },
            { name: '/index.js', bytes: 92000 }, { name: '/apps.js', bytes: 38000 },
            { name: '/extras.js', bytes: 44000 }, { name: '/fun.js', bytes: 34000 },
            { name: '/games/wizardz.js', bytes: 120000 }, { name: '/games/balatro.js', bytes: 96000 },
            { name: '/sw.js', bytes: 4000 }
        ];
    }

    // ---------- laying it out badly on purpose ----------
    // every file is scattered across the disk in pieces, which is what a
    // fragmented drive is. seeded so a reload gives the same mess.
    function makeDisk(files, seed) {
        let s = seed >>> 0 || 12345;
        const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

        const totalBytes = files.reduce((a, f) => a + f.bytes, 0) || 1;
        const clusterBytes = Math.max(512, Math.ceil(totalBytes / (TOTAL * FILL)));
        const cells = new Array(TOTAL).fill(FREE);
        const owner = new Array(TOTAL).fill(-1);

        const laid = files.map(f => ({
            name: f.name, bytes: f.bytes,
            want: Math.max(1, Math.round(f.bytes / clusterBytes)),
            locked: UNMOVABLE.test(f.name), got: []
        }));

        // The scaffolding of the site goes down first, in one piece, at
        // the front — a system area, the way the files a real defrag
        // refused to touch sat where they sat. Scattering unmovable
        // clusters across the whole disk would be more dramatic and
        // would also make a tidy disk impossible: nothing can ever be
        // packed around a third of a drive that will not move.
        let head = 0;
        laid.filter(f => f.locked).forEach(f => {
            for (let k = 0; k < f.want && head < TOTAL; k++, head++) {
                cells[head] = LOCKED;
                owner[head] = laid.indexOf(f);
                f.got.push(head);
            }
        });

        // everything else is thrown across what is left, which is what
        // being fragmented means
        const free = [];
        for (let i = head; i < TOTAL; i++) free.push(i);
        for (let i = free.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const t = free[i]; free[i] = free[j]; free[j] = t;
        }
        let cursor = 0;
        const take = () => (cursor < free.length ? free[cursor++] : -1);
        laid.forEach((f, fi) => {
            if (f.locked) return;
            for (let k = 0; k < f.want; k++) {
                const at = take();
                if (at < 0) break;
                cells[at] = MOVE;
                owner[at] = fi;
                f.got.push(at);
            }
        });
        // a couple of bad clusters, because every disk had them
        for (let k = 0; k < 3; k++) {
            const at = take();
            if (at >= 0) { cells[at] = BAD; owner[at] = -2; }
        }
        return { cells: cells, owner: owner, files: laid, clusterBytes: clusterBytes };
    }

    // Where everything should end up: each movable file in one run,
    // files in order, packed from the front, stepping over anything that
    // cannot move.
    //
    // This has to be planned against a disk that is *moving*. The first
    // version worked out every move from the original layout, which is
    // wrong the moment a cluster lands on a slot some later move still
    // thinks it owns — the disk ends up full of holes with clusters
    // missing. So the plan is a sequence of swaps, simulated as it is
    // built: whatever was in the destination goes back to where the
    // arriving cluster came from, which is what a real defragmenter has
    // to do too.
    function plan(disk) {
        const cells = disk.cells.slice();
        const owner = disk.owner.slice();
        const blocked = i => cells[i] === LOCKED || cells[i] === BAD;
        const moves = [];

        // where each file's clusters are sitting right now
        const pool = {};
        for (let i = 0; i < TOTAL; i++) {
            if (owner[i] >= 0 && !blocked(i)) (pool[owner[i]] = pool[owner[i]] || []).push(i);
        }

        // a file is placed as a whole: find the first stretch of good
        // clusters long enough to hold it, the way a real defragmenter
        // leaves a gap in front of a bad patch rather than splitting a
        // file across it
        const fits = (start, count) => {
            let n = 0, i = start;
            while (i < TOTAL && n < count) {
                if (blocked(i)) return -1;
                n++; i++;
            }
            return n === count ? start : -1;
        };
        // ...but only if the gap that leaves is small. Skipping forty
        // percent of a drive to avoid splitting one enormous file in two
        // is not tidying up, it is vandalism, and the real one would
        // have written straight across the bad patch too.
        const MAX_GAP = 24;
        const roomFrom = (start, count) => {
            for (let i = start; i + count <= TOTAL; i++) {
                if (blocked(i)) continue;
                if (i - start > MAX_GAP) return -1;
                if (fits(i, count) >= 0) return i;
            }
            return -1;
        };

        let at = 0;
        const groups = [];
        disk.files.forEach((f, fi) => { if (!f.locked && f.got.length) groups.push({ fi: fi, n: f.got.length }); });
        groups.forEach(g => {
            const start = roomFrom(at, g.n);
            // nothing on this disk is big enough to hold it in one piece,
            // so fall back to wherever it will go
            at = start >= 0 ? start : at;
            for (let k = 0; k < g.n; k++) {
                while (at < TOTAL && blocked(at)) at++;
                if (at >= TOTAL) return;
                const want = g.fi;
                const here = pool[want] || [];
                if (owner[at] === want) {
                    here.splice(here.indexOf(at), 1);
                    cells[at] = PLACED;
                    at++;
                    continue;
                }
                let src = -1;
                for (let j = 0; j < here.length; j++) if (here[j] !== at) { src = here[j]; break; }
                if (src < 0) { at++; continue; }
                moves.push({ file: want, from: src, to: at });
                const wasOwner = owner[at], wasCell = cells[at];
                owner[at] = want; cells[at] = PLACED;
                owner[src] = wasOwner; cells[src] = wasOwner >= 0 ? wasCell : FREE;
                here.splice(here.indexOf(src), 1);
                if (wasOwner >= 0) {
                    const other = pool[wasOwner];
                    const k2 = other.indexOf(at);
                    if (k2 >= 0) other[k2] = src;
                }
                at++;
            }
        });
        return moves;
    }

    // Read straight off the disk rather than off any bookkeeping, so it
    // cannot drift out of step with what is on screen.
    //
    // Clusters that cannot hold data — bad ones, and the system area —
    // are skipped rather than counted as a break. A file written either
    // side of a bad cluster is not fragmented, it is a file with a hole
    // in the middle of it, and no amount of defragmenting will close it.
    function fragmentation(disk) {
        const runs = {}, seen = {};
        let prev = -1;
        for (let i = 0; i < TOTAL; i++) {
            if (disk.cells[i] === BAD) continue;
            const o = disk.owner[i];
            if (o < 0) { prev = -1; continue; }
            seen[o] = true;
            if (o !== prev) runs[o] = (runs[o] || 0) + 1;
            prev = o;
        }
        const files = Object.keys(seen);
        if (!files.length) return 0;
        const total = files.reduce((a, k) => a + runs[k], 0);
        return Math.max(0, Math.min(99, Math.round((1 - files.length / total) * 100)));
    }

    // ---------- the window ----------
    function openDefrag() {
        const { body, win, id } = createAppWindow('disk defragmenter', { icon: 'storage', width: 520 });
        body.classList.add('dfg-body');
        body.innerHTML = `
            <div class="dfg-head">
                <span>Drive <b>C:</b></span>
                <span class="dfg-frag" id="dfg-frag"></span>
                <span class="dfg-cluster" id="dfg-cluster"></span>
            </div>
            <canvas id="dfg-map" class="dfg-map bevel-in"></canvas>
            <div class="dfg-bar bevel-in"><div class="dfg-fill" id="dfg-fill"></div></div>
            <div class="dfg-status" id="dfg-status">ready. this drive has not been defragmented since 1998.</div>
            <div class="dfg-actions">
                <button class="bevel-out dfg-btn" data-dfg="run">defragment</button>
                <button class="bevel-out dfg-btn" data-dfg="pause" disabled>pause</button>
                <button class="bevel-out dfg-btn" data-dfg="stop" disabled>stop</button>
                <label class="dfg-speed">speed
                    <select id="dfg-speed" class="dfg-select">
                        <option value="slow">slow</option>
                        <option value="normal" selected>normal</option>
                        <option value="turbo">turbo</option>
                    </select>
                </label>
            </div>
            <details class="dfg-legend"><summary>legend</summary>
                <div class="dfg-legend-rows">${LEGEND.map(([k, label]) =>
            `<span><i style="background:${COLOR[k]}"></i>${label}</span>`).join('')}</div>
            </details>`;

        const canvas = body.querySelector('#dfg-map');
        const fillEl = body.querySelector('#dfg-fill');
        const statusEl = body.querySelector('#dfg-status');
        const fragEl = body.querySelector('#dfg-frag');
        const clusterEl = body.querySelector('#dfg-cluster');
        const speedEl = body.querySelector('#dfg-speed');

        let disk = makeDisk(realFiles(), Date.now() & 0xffff);
        let moves = plan(disk);
        const totalMoves = moves.length;
        let done = 0, running = false, finished = false, raf = 0, carry = 0, last = 0;

        fragEl.textContent = fragmentation(disk) + '% fragmented';
        clusterEl.textContent = (disk.clusterBytes / 1024).toFixed(1) + 'K clusters · ' +
            disk.files.length + ' files';

        // ---------- drawing ----------
        function draw() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = canvas.clientWidth || 480;
            const cw = Math.floor((w / COLS) * dpr) / dpr;      // whole device pixels per cell
            const ch = cw;
            const width = cw * COLS, height = ch * ROWS;
            if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
                canvas.width = Math.round(width * dpr);
                canvas.height = Math.round(height * dpr);
                canvas.style.height = height + 'px';
            }
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#c8c8c8';
            ctx.fillRect(0, 0, width, height);
            for (let i = 0; i < TOTAL; i++) {
                const x = (i % COLS) * cw, y = Math.floor(i / COLS) * ch;
                ctx.fillStyle = COLOR[disk.cells[i]];
                ctx.fillRect(x, y, cw - 1, ch - 1);
            }
        }

        // ---------- the work ----------
        function step() {
            if (done >= totalMoves) { finish(); return false; }
            const m = moves[done];
            // the head reads the cluster at its old address and writes it
            // to the new one; whatever was living there goes back the
            // other way, which is why nothing is ever lost
            disk.cells[m.from] = READ;
            disk.cells[m.to] = WRITE;
            const wasOwner = disk.owner[m.to], wasCell = disk.cells[m.to];
            disk.owner[m.to] = m.file;
            disk.cells[m.to] = PLACED;
            disk.owner[m.from] = wasOwner;
            disk.cells[m.from] = wasOwner >= 0 ? (wasCell === WRITE ? MOVE : wasCell) : FREE;
            done++;
            const pct = Math.round((done / totalMoves) * 100);
            fillEl.style.width = pct + '%';
            statusEl.textContent = `moving cluster ${m.from} → ${m.to} · ${disk.files[m.file].name}`;
            fragEl.textContent = fragmentation(disk) + '% fragmented';
            return true;
        }

        function loop(now) {
            if (!running) return;
            if (!last) last = now;
            const dt = Math.min(0.25, (now - last) / 1000);
            last = now;
            carry += dt * SPEEDS[speedEl.value || 'normal'];
            let n = Math.floor(carry);
            carry -= n;
            while (n-- > 0) { if (!step()) return; }
            draw();
            raf = requestAnimationFrame(loop);
        }

        function setButtons() {
            body.querySelector('[data-dfg="run"]').disabled = running || finished;
            body.querySelector('[data-dfg="pause"]').disabled = !running;
            body.querySelector('[data-dfg="stop"]').disabled = !running && !done;
        }
        function start() {
            if (running || finished) return;
            running = true; last = 0;
            statusEl.textContent = 'defragmenting drive C:';
            setButtons();
            playSound('click');
            raf = requestAnimationFrame(loop);
        }
        function pause() {
            running = false;
            cancelAnimationFrame(raf);
            statusEl.textContent = 'paused at ' + Math.round((done / (totalMoves || 1)) * 100) + '%';
            setButtons();
            playSound('click');
        }
        function stop() {
            running = false;
            cancelAnimationFrame(raf);
            statusEl.textContent = 'stopped. the disk is exactly as confused as you left it.';
            setButtons();
            playSound('error');
        }
        function finish() {
            running = false;
            finished = true;
            cancelAnimationFrame(raf);
            // anything still marked as needing a move is already home
            for (let i = 0; i < TOTAL; i++) if (disk.cells[i] === MOVE) disk.cells[i] = PLACED;
            draw();
            fillEl.style.width = '100%';
            fragEl.textContent = fragmentation(disk) + '% fragmented';
            statusEl.textContent = 'defragmentation of drive C: is complete.';
            setButtons();
            playSound('ding');
            if (typeof unlockAchievement === 'function') unlockAchievement('defrag');
            showRetroDialog({
                title: 'disk defragmenter',
                lines: [
                    'defragmentation of drive C: is complete.',
                    `${totalMoves} clusters moved. your website is now in alphabetical order, spiritually.`,
                    'this did not make anything faster. it never did.'
                ],
                okLabel: 'ok',
                cancelLabel: 'do it again',
                onOk: () => { }
            });
            const overlay = document.querySelector('.retro-dialog-overlay');
            const again = overlay && [...overlay.querySelectorAll('.retro-dialog-btn')]
                .find(b => /do it again/i.test(b.textContent));
            if (again) again.onclick = () => { overlay.remove(); reset(); };
        }
        function reset() {
            disk = makeDisk(realFiles(), (Date.now() ^ (done * 7919)) & 0xffff);
            moves = plan(disk);
            done = 0; finished = false; running = false; carry = 0; last = 0;
            fillEl.style.width = '0%';
            fragEl.textContent = fragmentation(disk) + '% fragmented';
            statusEl.textContent = 'ready.';
            setButtons();
            draw();
        }

        body.querySelectorAll('[data-dfg]').forEach(b => {
            b.onclick = () => ({ run: start, pause: pause, stop: stop })[b.dataset.dfg]();
        });

        // hovering a cluster says whose it is — the point of the whole
        // exercise being that these are real files
        canvas.onmousemove = e => {
            const r = canvas.getBoundingClientRect();
            const cx = Math.floor(((e.clientX - r.left) / r.width) * COLS);
            const cy = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
            const i = cy * COLS + cx;
            if (i < 0 || i >= TOTAL) return;
            const o = disk.owner[i];
            canvas.title = o === -2 ? 'bad cluster'
                : o >= 0 ? `cluster ${i} · ${disk.files[o].name} (${Math.round(disk.files[o].bytes / 1024)}K)`
                    : `cluster ${i} · free`;
        };

        const onResize = () => draw();
        window.addEventListener('resize', onResize);
        const prev = win._cleanup;
        win._cleanup = () => {
            running = false;
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
            prev && prev();
        };

        setButtons();
        // the canvas has no width until it is in the layout
        requestAnimationFrame(draw);
        return { id: id, body: body };
    }

    window.openDefrag = openDefrag;
    // the pieces are exported so the test suite can lay out a disk and
    // defragment it without a browser
    window.DEFRAG = {
        COLS, ROWS, TOTAL, FREE, PLACED, MOVE, READ, WRITE, LOCKED, BAD,
        COLOR, LEGEND, SPEEDS, UNMOVABLE, realFiles, makeDisk, plan, fragmentation
    };
})();
