// Compile raw 4x4 cutout kits into lossless, runtime-sized attachment atlases.
// Canvas crops and uniformly scales individual parts; no limbs are deformed.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let names = ['joe-cool', 'dusung', 'hothead', 'bebetrol', 'zirlak', 'hehe', 'nasiya', 'patron', 'sahur', 'oleey', 'yeter', 'pffft'];
if (process.env.ART_ONLY) names = names.filter(n => n === process.env.ART_ONLY);
const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname;
    if (name === '/prepare') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Cutout atlas preparation</title>'); return; }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(name));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'text/javascript'); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/prepare');
    let total = 0;
    for (const name of names) {
        const base64 = await page.evaluate(async name => {
            const image = new Image(); image.src = '/games/rift-rumble/art/cutout-' + name + '.png'; await image.decode();
            const atlas = document.createElement('canvas'); atlas.width = atlas.height = 512;
            const ac = atlas.getContext('2d'); ac.imageSmoothingEnabled = true; ac.imageSmoothingQuality = 'high';
            for (let part = 0; part < 16; part++) {
                const x = Math.round(part % 4 * image.naturalWidth / 4), y = Math.round(Math.floor(part / 4) * image.naturalHeight / 4);
                const w = Math.round((part % 4 + 1) * image.naturalWidth / 4) - x, h = Math.round((Math.floor(part / 4) + 1) * image.naturalHeight / 4) - y;
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(image, x, y, w, h, 0, 0, w, h);
                const pixels = c.getImageData(0, 0, w, h), d = pixels.data, labels = new Int32Array(w * h), queue = new Int32Array(w * h), groups = [];
                for (let start = 0; start < w * h; start++) {
                    if (labels[start] || d[start * 4 + 3] < 110) continue;
                    const id = groups.length + 1, g = { id, size: 0, l: w, t: h, r: 0, b: 0 };
                    let head = 0, tail = 1; queue[0] = start; labels[start] = id;
                    while (head < tail) {
                        const p = queue[head++], px = p % w, py = Math.floor(p / w); g.size++;
                        g.l = Math.min(g.l, px); g.r = Math.max(g.r, px); g.t = Math.min(g.t, py); g.b = Math.max(g.b, py);
                        for (let yy = Math.max(0, py - 1); yy <= Math.min(h - 1, py + 1); yy++) for (let xx = Math.max(0, px - 1); xx <= Math.min(w - 1, px + 1); xx++) {
                            const q = yy * w + xx;
                            if (!labels[q] && d[q * 4 + 3] >= 110) { labels[q] = id; queue[tail++] = q; }
                        }
                    }
                    groups.push(g);
                }
                groups.sort((a, b) => b.size - a.size);
                const main = groups[0]; if (!main) throw new Error(name + ': empty cutout ' + part);
                const keep = new Set(groups.filter(g => g.size >= Math.max(50, main.size * 0.004) && g.l < main.r + 25 && g.r > main.l - 25 && g.t < main.b + 25 && g.b > main.t - 25).map(g => g.id));
                let l = w, t = h, r = 0, b = 0;
                for (let p = 0; p < w * h; p++) {
                    if (!keep.has(labels[p])) { d[p * 4 + 3] = 0; continue; }
                    l = Math.min(l, p % w); r = Math.max(r, p % w); t = Math.min(t, Math.floor(p / w)); b = Math.max(b, Math.floor(p / w));
                }
                c.putImageData(pixels, 0, 0);
                const bw = r - l + 1, bh = b - t + 1, k = Math.min(116 / bw, 116 / bh);
                ac.drawImage(cv, l, t, bw, bh, part % 4 * 128 + (128 - bw * k) / 2, Math.floor(part / 4) * 128 + (128 - bh * k) / 2, bw * k, bh * k);
            }
            return atlas.toDataURL('image/png').split(',')[1];
        }, name);
        const bytes = Buffer.from(base64, 'base64'), file = 'rig-' + name + '.png';
        fs.writeFileSync(path.join(ROOT, 'games/rift-rumble/art', file), bytes); total += bytes.length;
        console.log(file + ': ' + Math.round(bytes.length / 1024) + ' KiB');
    }
    console.log(names.length + ' cutout atlases: ' + Math.round(total / 1024) + ' KiB total.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
