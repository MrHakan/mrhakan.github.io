// Visual consistency checks against the actual decoded textures and baked frames.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), SHOTS = path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><base href="/"><title>Brawlz animation review</title><style>body{margin:0;background:#152b42;color:#dce8ed;font:14px Tahoma}header{padding:12px 20px;display:flex;gap:20px;align-items:center}select,button{padding:7px;background:#2e4b66;color:#fff;border:1px solid #8cc4c4;border-radius:4px}canvas{display:block;width:100%;max-width:1280px;margin:auto}span{color:#9fbfc9;font-size:12px}</style><header><b>Brawlz 98 / animation review</b><select id="action"><option>run</option><option>light</option><option>heavy</option><option>special</option><option>jump</option><option>idle</option><option>dodge</option><option>hurt</option></select><button id="pause">Pause</button><span id="ready">Preparing fixed rigs…</span></header><canvas id="stage" width="1280" height="900" aria-label="Twelve animated fighters"></canvas><script src="/games/rift-rumble/rift-data.js"></script><script src="/games/rift-rumble/rift-animation.js"></script><script src="/games/rift-rumble/rift-art.js"></script><script>
window.review={tick:0,paused:false,action:'run'};const tracks=Array.from({length:12},()=>RIFT_ANIM.create()),c=document.getElementById('stage').getContext('2d');let last=performance.now();
document.getElementById('action').onchange=e=>{review.action=e.target.value};document.getElementById('pause').onclick=e=>{review.paused=!review.paused;e.target.textContent=review.paused?'Resume':'Pause'};
function loop(now){requestAnimationFrame(loop);const dt=Math.min(.04,(now-last)/1000);last=now;if(!review.paused)review.tick+=dt*60;const action=review.action;
c.fillStyle='#152b42';c.fillRect(0,0,1280,900);document.getElementById('ready').textContent=RIFT_ART.ready()?'12 fixed identities / 600 baked frames':'Preparing fixed rigs…';
for(let i=0;i<12;i++){let x=review.tick*5;const p={x,vx:action==='run'?5:0,vy:0,grounded:action!=='jump',stun:action==='hurt'?10:0,dodge:action==='dodge'?12-review.tick%12:0,attack:null,character:i};
if(['light','heavy','special'].includes(action)){const s=action==='special'&&RIFT.FIGHTERS[i].specialMelee||RIFT.ATTACKS[action];p.attack={kind:action,age:review.tick%s.duration};}
if(action==='jump')p.vy=Math.sin(review.tick/60*4)*12;const a=RIFT_ANIM.update(tracks[i],p,review.tick,{paused:review.paused});const bx=i%4*320,by=Math.floor(i/4)*300;
c.fillStyle='#203e56';c.fillRect(bx+8,by+8,304,284);c.strokeStyle='#78b5b2';c.beginPath();c.moveTo(bx+30,by+246);c.lineTo(bx+290,by+246);c.stroke();
RIFT_ART.paint(c,bx+160,by+246,i,{scale:2.5,animation:a});c.fillStyle='#f1dfab';c.textAlign='center';c.font='bold 17px Tahoma';c.fillText(RIFT.FIGHTERS[i].name,bx+160,by+35);c.fillStyle='#9db9c6';c.font='12px Tahoma';c.fillText(a.action+' / frame '+a.frame,bx+160,by+274);}}
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
    const result = await page.evaluate(() => {
        const metrics = RIFT_ART.metrics(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
        const c = canvas.getContext('2d', { willReadFrequently: true }), reports = [];
        const pixels = (i, frame) => { c.clearRect(0, 0, 160, 160); RIFT_ART.paint(c, 80, 112, i, { scale: 1, animation: { frame } }); return c.getImageData(0, 0, 160, 160).data; };
        const hash = data => { let h = 2166136261; for (let n = 0; n < data.length; n++) h = Math.imul(h ^ data[n], 16777619); return h >>> 0; };
        for (let i = 0; i < 12; i++) {
            const hashes = new Set(), bottoms = [], badFrames = [], faces = new Set();
            for (let frame = 0; frame < 50; frame++) {
                const d = pixels(i, frame), p = RIFT_ANIM.pose(frame), face = [];
                let bottom = -1, clipped = 0;
                for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) if (d[(y * 160 + x) * 4 + 3] > 96) { bottom = y; if (x < 9 || x > 150 || y < 5 || y > 146) clipped++; }
                if (frame >= 5 && frame <= 12) { hashes.add(hash(d)); bottoms.push(bottom); }
                if (bottom > 113 || clipped) badFrames.push(frame);
                const fx = 74 + Math.round(p.lean), fy = 112 + Math.floor(metrics[i].neck) - 18 + Math.round(p.lift + p.crouch);
                for (let y = fy; y < fy + 8; y++) for (let x = fx; x < fx + 12; x++) for (let k = 0; k < 4; k++) face.push(d[(y * 160 + x) * 4 + k]);
                faces.add(hash(face));
            }
            reports.push({ name: RIFT.FIGHTERS[i].name, distinctRunFrames: hashes.size, bottoms, badFrames, faceVariants: faces.size });
        }
        return { metrics, reports };
    });
    fs.writeFileSync(path.join(SHOTS, 'brawlz-animation-report.json'), JSON.stringify(result, null, 2));
    for (const [i, r] of result.reports.entries()) {
        assert.equal(result.metrics[i].frames, 50, r.name + ': all states baked');
        assert.equal(r.distinctRunFrames, 8, r.name + ': eight visibly distinct run frames');
        assert.ok(r.bottoms.every(y => y >= 108 && y <= 113), r.name + ': a foot stays on the floor ' + r.bottoms);
        assert.equal(r.badFrames.length, 0, r.name + ': no clipping or floor penetration ' + r.badFrames);
        assert.equal(r.faceVariants, 1, r.name + ': identical face pixels in every pose');
        console.log('  ok    ' + r.name + ': eight run frames, fixed floor, 50 complete poses; face variants ' + r.faceVariants);
    }
    await page.screenshot({ path: path.join(SHOTS, 'brawlz-run-review.png') });
    for (const action of ['heavy', 'jump']) { await page.selectOption('#action', action); await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, 'brawlz-' + action + '-review.png') }); }
    await page.evaluate(() => {
        const cv = document.createElement('canvas'); cv.id = 'filmstrip'; cv.width = 1280; cv.height = 720;
        Object.assign(cv.style, { position: 'fixed', left: '0', top: '0', zIndex: '9999', width: '1280px', height: '720px' }); document.body.appendChild(cv);
        const c = cv.getContext('2d'); c.fillStyle = '#152b42'; c.fillRect(0, 0, 1280, 720);
        for (let row = 0; row < 4; row++) for (let k = 0; k < 8; k++) {
            const fighter = row < 2 ? 0 : 7, frame = row % 2 ? 25 + k : 5 + k, x = k * 160 + 80, y = row * 180 + 148;
            c.fillStyle = '#25465c'; c.fillRect(k * 160 + 4, row * 180 + 4, 152, 170);
            c.strokeStyle = '#80b9b0'; c.beginPath(); c.moveTo(k * 160 + 8, y); c.lineTo(k * 160 + 152, y); c.stroke();
            RIFT_ART.paint(c, x, y, fighter, { scale: 1.6, animation: { frame } });
            c.fillStyle = '#f3dfb1'; c.font = '11px Tahoma'; c.textAlign = 'center'; c.fillText(RIFT.FIGHTERS[fighter].name + ' / ' + (row % 2 ? 'attack ' : 'run ') + (k + 1), x, y + 19);
        }
    });
    await page.locator('#filmstrip').screenshot({ path: path.join(SHOTS, 'brawlz-animation-filmstrip.png') });
    await page.locator('#filmstrip').evaluate(el => el.remove());
    const canRecord = await page.evaluate(() => !!window.MediaRecorder && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'));
    if (canRecord) {
        await page.evaluate(() => {
            window.recorded = []; window.recorder = new MediaRecorder(document.querySelector('#stage').captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 1600000 });
            recorder.ondataavailable = e => recorded.push(e.data); recorder.start();
        });
        for (const action of ['run', 'heavy', 'jump']) { await page.selectOption('#action', action); await page.waitForTimeout(1500); }
        const base64 = await page.evaluate(() => new Promise(resolve => {
            recorder.onstop = () => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(recorded, { type: recorder.mimeType })); }; recorder.stop();
        }));
        fs.writeFileSync(path.join(SHOTS, 'brawlz-animation-review.webm'), Buffer.from(base64, 'base64'));
    }
    fs.writeFileSync(path.join(SHOTS, 'brawlz-animation-review.html'), html.replaceAll('src="/games/', 'src="../games/'));
    assert.deepEqual(errors, []);
    console.log('Brawlz: all 12 animated rigs passed visual frame checks.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
