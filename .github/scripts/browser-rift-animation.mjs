// Verify actual decoded cutout attachments and record continuous rig motion.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SHOTS = path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><base href="/"><title>Brawlz cutout review</title><style>body{margin:0;background:#152b42;color:#dce8ed;font:14px Tahoma}header{padding:12px 20px;display:flex;gap:18px;align-items:center}select,button{padding:7px;background:#2e4b66;color:#fff;border:1px solid #8cc4c4;border-radius:4px}canvas{display:block;width:100%;max-width:1280px;margin:auto}span{color:#9fbfc9;font-size:12px}</style><header><b>Brawlz 98 / cutout rig review</b><select id="action"><option>run</option><option>light</option><option>heavy</option><option>up</option><option>down</option><option>special</option><option>jump</option><option>idle</option><option>dodge</option><option>hurt</option></select><button id="pause">Pause</button><label><input id="bones" type="checkbox"> Show bones</label><span id="ready">Loading cutouts…</span></header><canvas id="stage" width="1280" height="900" aria-label="Twelve animated cutout fighters"></canvas><script src="/games/rift-rumble/rift-data.js"></script><script src="/games/rift-rumble/rift-animation.js"></script><script src="/games/rift-rumble/rift-art.js"></script><script>
window.review={tick:0,paused:false,action:'run',debug:false};const tracks=Array.from({length:12},()=>RIFT_ANIM.create()),c=document.getElementById('stage').getContext('2d');let last=performance.now();
document.getElementById('action').onchange=e=>{review.action=e.target.value};document.getElementById('pause').onclick=e=>{review.paused=!review.paused;e.target.textContent=review.paused?'Resume':'Pause'};document.getElementById('bones').onchange=e=>review.debug=e.target.checked;
function loop(now){requestAnimationFrame(loop);const dt=Math.min(.04,(now-last)/1000);last=now;if(!review.paused)review.tick+=dt*60;const action=review.action;
c.fillStyle='#152b42';c.fillRect(0,0,1280,900);document.getElementById('ready').textContent=RIFT_ART.ready()?'12 fighters / 16 rigid parts each':'Loading cutouts…';
for(let i=0;i<12;i++){const p={x:review.tick*5,travel:review.tick*5,vx:action==='run'?5:0,vy:0,grounded:action!=='jump',stun:action==='hurt'?10:0,dodge:action==='dodge'?12-review.tick%12:0,attack:null,character:i};
if(['light','heavy','special','up','down'].includes(action)){const kind=action==='up'||action==='down'?'heavy':action,s=kind==='special'&&RIFT.FIGHTERS[i].specialMelee||RIFT.ATTACKS[kind];p.attack={kind,dir:action==='up'||action==='down'?action:'side',age:review.tick%s.duration};}
if(action==='jump')p.vy=Math.sin(review.tick/60*4)*12;const a=RIFT_ANIM.update(tracks[i],p,review.tick,{paused:review.paused});const bx=i%4*320,by=Math.floor(i/4)*300;
c.fillStyle='#203e56';c.fillRect(bx+8,by+8,304,284);c.strokeStyle='#78b5b2';c.beginPath();c.moveTo(bx+30,by+246);c.lineTo(bx+290,by+246);c.stroke();
RIFT_ART.paint(c,bx+160,by+246,i,{scale:2.5,animation:a,debug:review.debug,facing:review.facing||1});c.fillStyle='#f1dfab';c.textAlign='center';c.font='bold 17px Tahoma';c.fillText(RIFT.FIGHTERS[i].name,bx+160,by+35);c.fillStyle='#9db9c6';c.font='12px Tahoma';c.fillText(a.action+' / '+(typeof a.phase==='number'?a.phase.toFixed(2):a.phase),bx+160,by+274);}}
requestAnimationFrame(loop);</script></html>`;
const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname;
    if (name === '/review') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html); }
    const file = path.resolve(ROOT, '.' + decodeURIComponent(name));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'text/javascript' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/review');
    await page.waitForFunction(() => RIFT_ART.ready(), null, { timeout: 60000 });
    await page.selectOption('#action', 'idle'); await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SHOTS, 'brawlz-idle-review.png') });
    await page.evaluate(() => review.facing = -1); await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SHOTS, 'brawlz-idle-mirrored.png') });
    await page.evaluate(() => review.facing = 1);
    await page.selectOption('#action', 'run'); await page.waitForTimeout(250);
    const result = await page.evaluate(() => {
        const metrics = RIFT_ART.metrics(), cv = document.createElement('canvas'); cv.width = 240; cv.height = 200;
        const c = cv.getContext('2d', { willReadFrequently: true }), reports = [];
        const hash = data => { let h = 2166136261; for (let n = 0; n < data.length; n++) h = Math.imul(h ^ data[n], 16777619); return h >>> 0; };
        for (let character = 0; character < 12; character++) {
            const run = new Set(), clipped = [], belowFloor = [];
            for (let sample = 0; sample < 60; sample++) {
                const p = { character, grounded: true, vx: 5, vy: 0, travel: sample / 60 * RIFT_ANIM.profile(character).stride };
                if (sample >= 30) { p.vx = 0; p.attack = { kind: 'heavy', dir: 'side', age: (sample - 30) / 30 * 47 }; }
                const state = RIFT_ANIM.sample(p, sample), animation = { pose: state.pose, bones: RIFT_ANIM.solve(state.pose) };
                c.clearRect(0, 0, 240, 200); RIFT_ART.paint(c, 120, 160, character, { scale: 1, animation });
                const pixels = c.getImageData(0, 0, 240, 200).data; let count = 0, bad = 0, floor = 0;
                for (let y = 0; y < 200; y++) for (let x = 0; x < 240; x++) if (pixels[(y * 240 + x) * 4 + 3] > 96) { count++; if (x < 5 || x > 234 || y < 5 || y > 194) bad++; if (y > 163) floor++; }
                if (sample < 30) run.add(hash(pixels));
                if (bad || count < 300) clipped.push(sample);
                if (floor) belowFloor.push(sample);
            }
            reports.push({ name: RIFT.FIGHTERS[character].name, continuousRunSamples: run.size, clipped, belowFloor });
        }
        // A far-side forearm crossing the chest must remain visible over the
        // jacket, while its upper arm remains on the far side.
        const orders = [0, 0.5].map(phase => {
            const p = { character: 0, grounded: true, vx: 5, vy: 0, travel: phase * RIFT_ANIM.STRIDE };
            const pose = RIFT_ANIM.sample(p, 0).pose, order = [], original = c.drawImage;
            c.drawImage = function (image, sx, sy, ...args) { order.push(Math.floor(sy / 128) * 4 + Math.floor(sx / 128)); return original.call(this, image, sx, sy, ...args); };
            RIFT_ART.paint(c, 120, 160, 0, { scale: 1, animation: { pose, bones: RIFT_ANIM.solve(pose) } });
            c.drawImage = original; return order;
        });
        const idleOrders = Array.from({ length: 12 }, (_, character) => {
            const pose = RIFT_ANIM.sample({ character, grounded: true }, 0, true).pose, order = [], original = c.drawImage;
            c.drawImage = function (image, sx, sy, ...args) { order.push(Math.floor(sy / 128) * 4 + Math.floor(sx / 128)); return original.call(this, image, sx, sy, ...args); };
            RIFT_ART.paint(c, 120, 160, character, { scale: 1, animation: { pose, bones: RIFT_ANIM.solve(pose) } });
            c.drawImage = original; return order;
        });
        return { metrics, reports, orders, idleOrders };
    });
    fs.writeFileSync(path.join(SHOTS, 'brawlz-animation-report.json'), JSON.stringify(result, null, 2));
    assert.ok(result.orders[0].indexOf(6) < result.orders[0].indexOf(1), 'far upper arm stays behind the jacket');
    for (const part of [7, 13]) {
        assert.ok(result.orders[0].indexOf(part) > result.orders[0].indexOf(1), 'forward-swinging forearm/hand draws across the chest');
        assert.ok(result.orders[1].indexOf(part) < result.orders[1].indexOf(1), 'backward-swinging forearm/hand moves behind the torso');
    }
    for (const character of [1, 4, 9]) for (const part of [7, 13]) assert.ok(result.idleOrders[character].indexOf(part) > result.idleOrders[character].indexOf(0), 'face gestures stay over the head');
    for (const character of [0, 1, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const order = result.idleOrders[character];
        assert.ok(order.indexOf(3) > order.indexOf(1) && order.indexOf(3) < order.indexOf(12), 'the prop is visible above the torso and below the gripping hand');
    }
    for (const [i, r] of result.reports.entries()) {
        assert.equal(result.metrics[i].parts, 16, r.name + ': sixteen separate attachments');
        assert.ok(r.continuousRunSamples >= 28, r.name + ': continuous rig motion rather than repeated frames');
        assert.deepEqual(r.clipped, [], r.name + ': complete visible silhouettes');
        assert.deepEqual(r.belowFloor, [], r.name + ': no floor penetration');
        console.log('  ok    ' + r.name + ': 16 attachments, continuous motion, no clipping or floor penetration');
    }
    await page.screenshot({ path: path.join(SHOTS, 'brawlz-run-review.png') });
    await page.check('#bones'); await page.screenshot({ path: path.join(SHOTS, 'brawlz-bones-review.png') }); await page.uncheck('#bones');
    for (const action of ['heavy', 'jump']) { await page.selectOption('#action', action); await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, 'brawlz-' + action + '-review.png') }); }
    const canRecord = await page.evaluate(() => !!window.MediaRecorder && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'));
    if (canRecord) {
        await page.evaluate(() => {
            window.recorded = []; window.recorder = new MediaRecorder(document.querySelector('#stage').captureStream(60), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2200000 });
            recorder.ondataavailable = e => recorded.push(e.data); recorder.start();
        });
        for (const action of ['idle', 'run', 'heavy', 'up', 'jump']) { await page.selectOption('#action', action); await page.waitForTimeout(1700); }
        const base64 = await page.evaluate(() => new Promise(resolve => {
            recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(recorded, { type: recorder.mimeType })); }; recorder.stop();
        }));
        fs.writeFileSync(path.join(SHOTS, 'brawlz-cutout-review.webm'), Buffer.from(base64, 'base64'));
    }
    fs.writeFileSync(path.join(SHOTS, 'brawlz-animation-review.html'), html.replaceAll('src="/games/', 'src="../games/'));
    assert.deepEqual(errors, []);
    console.log('Brawlz: 12 cutout rigs passed asset checks. Review the recorded movement for visual quality.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
