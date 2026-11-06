// ===================================================================
// PS1 WORLD — a map that is boxes standing on a floor
//
// It came out of wizardz-sim.js, and dungeonz-sim.js uses it too. Nothing in a
// world overhangs anything else, so the whole of it is a height map: "is that a
// wall" and "can they see me" are array lookups, and a bot finding its way is a
// flow field on a coarse grid. No page in it, so the tests can run it in node.
//
//   build({ x0, z0, w, d, cells, nav, outer, ground(x, z), boxes, rim })
//     x0, z0   the corner with the smallest x and z, in metres
//     w, d     how far it goes in x and z
//     cells    height samples per metre
//     nav      metres per cell of the bots' grid
//     outer    the height of anything solid you cannot climb
//     ground   the terrain under the boxes
//     boxes    [x, z, half width, half depth, height, ...] standing on it
//     rim      how far in from the edge the outer wall starts (default 1)
//     step     the biggest step a walker takes without jumping (default 0.45)
//     keep     how many flow fields to a fixed goal to keep (default 512)
// ===================================================================
(function () {
    'use strict';

    const { abs, max, min, floor, round, hypot, ceil } = Math;
    const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
    const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    const PROBES = [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]];

    function build(o) {
        const CELLS = o.cells || 4, NAV = o.nav || 1, OUTER = o.outer === undefined ? 12 : o.outer;
        const x0 = o.x0, z0 = o.z0, W = o.w, Dp = o.d;
        const rim = o.rim === undefined ? 1 : o.rim;
        const step = o.step === undefined ? 0.45 : o.step;
        const SX = round(W * CELLS) + 1, SZ = round(Dp * CELLS) + 1;
        const boxes = o.boxes || [];
        const height = new Float32Array(SX * SZ);
        for (let j = 0; j < SZ; j++) for (let i = 0; i < SX; i++) {
            const x = i / CELLS + x0, z = j / CELLS + z0;
            let h = o.ground(x, z);
            if (x < x0 + rim || x > x0 + W - rim || z < z0 + rim || z > z0 + Dp - rim) h = OUTER;
            for (const b of boxes) {
                if (abs(x - b[0]) <= b[2] && abs(z - b[1]) <= b[3]) h = max(h, b[4]);
            }
            height[j * SX + i] = h;
        }
        const at = (x, z) => {
            const i = round((x - x0) * CELLS), j = round((z - z0) * CELLS);
            if (i < 0 || j < 0 || i >= SX || j >= SZ) return OUTER;
            return height[j * SX + i];
        };
        // where a bot can walk. A cell with a drop or a wall inside its width is not one
        const NX = round(W / NAV), NZ = round(Dp / NAV);
        const passable = new Uint8Array(NX * NZ);
        const navH = new Float32Array(NX * NZ);
        for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
            const x = (i + 0.5) * NAV + x0, z = (j + 0.5) * NAV + z0;
            const h = at(x, z);
            navH[j * NX + i] = h;
            let ok = h < OUTER - 1;
            for (const [dx, dz] of PROBES) {
                if (abs(at(x + dx, z + dz) - h) > step) ok = false;
            }
            passable[j * NX + i] = ok ? 1 : 0;
        }
        const navCell = (x, z) => {
            const i = clamp(floor((x - x0) / NAV), 0, NX - 1), j = clamp(floor((z - z0) / NAV), 0, NZ - 1);
            return j * NX + i;
        };
        const cellX = c => ((c % NX) + 0.5) * NAV + x0;
        const cellZ = c => (floor(c / NX) + 0.5) * NAV + z0;

        // a breadth first walk out from a goal: f[cell] is the next cell towards it, -1 if
        // it cannot be reached. limit stops it that many steps out, for goals that move
        function fill(f, cell, limit) {
            // only what the last walk touched needs wiping, which for a short walk on a big map
            // is most of the cost
            if (f.touched) { const t = f.touched; for (let k = 0; k < f.nTouched; k++) f[t[k]] = -1; }
            else f.fill(-1);
            const queue = W_QUEUE.length >= NX * NZ ? W_QUEUE : (W_QUEUE = new Int32Array(NX * NZ));
            const depth = W_DEPTH.length >= NX * NZ ? W_DEPTH : (W_DEPTH = new Int32Array(NX * NZ));
            let head = 0, tail = 0;
            queue[tail++] = cell;
            depth[cell] = 0;
            f[cell] = cell;
            const cap = limit || 1e9;
            for (; head < tail; head++) {
                const c = queue[head];
                if (depth[c] >= cap) continue;
                const i = c % NX, j = (c - i) / NX;
                for (const [di, dj] of NEIGHBOURS) {
                    const a = i + di, b = j + dj;
                    if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
                    const n = b * NX + a;
                    if (f[n] !== -1 || !passable[n]) continue;
                    if (abs(navH[n] - navH[c]) > 0.5) continue;
                    if (di && dj && (!passable[j * NX + a] || !passable[b * NX + i])) continue;
                    f[n] = c;
                    depth[n] = depth[c] + 1;
                    queue[tail++] = n;
                }
            }
            if (limit) {
                if (!f.touched || f.touched.length < tail) f.touched = new Int32Array(max(tail, 1024));
                f.touched.set(queue.subarray(0, tail));
                f.nTouched = tail;
            }
            return f;
        }
        let W_QUEUE = new Int32Array(0), W_DEPTH = new Int32Array(0);
        // goals that never move get a field each, kept until there are too many of them
        const flows = new Map();
        const KEEP = o.keep || 512;
        function flowTo(cell) {
            let f = flows.get(cell);
            if (f) return f;
            if (flows.size >= KEEP) flows.delete(flows.keys().next().value);
            f = fill(new Int32Array(NX * NZ), cell, 0);
            flows.set(cell, f);
            return f;
        }
        function nearestPassable(cell) {
            if (passable[cell]) return cell;
            const i = cell % NX, j = (cell - i) / NX;
            for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
                const a = i + di, b = j + dj;
                if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
                if (passable[b * NX + a]) return b * NX + a;
            }
            return cell;
        }
        // the next place to head for, on the way from x, z to gx, gz. field: a field from
        // fill() to use instead of the kept ones, for a goal that moves
        function nextStep(x, z, gx, gz, field) {
            const from = nearestPassable(navCell(x, z)), goal = nearestPassable(navCell(gx, gz));
            if (from === goal) return { x: gx, z: gz };
            const f = field || flowTo(goal);
            let c = f[from];
            if (c === -1 || c === undefined) return { x: gx, z: gz, lost: true };
            // look a couple of cells ahead, or it walks like a chess piece
            const n2 = f[c];
            if (n2 !== -1 && n2 !== undefined) c = n2;
            return { x: cellX(c), z: cellZ(c) };
        }
        // can this be walked to from there? the check that a map is any good
        function canWalkBetween(ax, az, bx, bz) {
            const from = nearestPassable(navCell(ax, az)), goal = nearestPassable(navCell(bx, bz));
            const f = flowTo(goal);
            return from === goal || (f[from] !== -1 && f[from] !== undefined);
        }
        // nothing solid between two points, counting only the ground
        function clearLine(ax, ay, az, bx, by, bz, stepLen) {
            const d = hypot(bx - ax, by - ay, bz - az);
            const n = max(1, ceil(d / (stepLen || 0.4)));
            for (let k = 1; k < n; k++) {
                const u = k / n;
                if (at(ax + (bx - ax) * u, az + (bz - az) * u) > ay + (by - ay) * u) return false;
            }
            return true;
        }
        return {
            x0, z0, w: W, d: Dp, cells: CELLS, nav: NAV, outer: OUTER, sx: SX, sz: SZ, nx: NX, nz: NZ,
            height, at, passable, navH, navCell, cellX, cellZ,
            flows, flowTo, fill, nearestPassable, nextStep, canWalkBetween, clearLine,
            field: () => new Int32Array(NX * NZ)
        };
    }

    window.PS1_WORLD = { build };
})();
