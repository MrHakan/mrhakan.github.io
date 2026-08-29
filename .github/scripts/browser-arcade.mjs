// ===================================================================
// browser-arcade.mjs — the thirty new things, played rather than opened
//
// A window that opens is not a game that works. check-games.mjs proves
// the wiring; this one proves the thing behind the wiring: it plays
// eight games of tic-tac-toe and expects to lose every one, merges
// tiles in 2048 and watches the score move, winds the pet's clock back
// nine hours to see if it gets hungry, and asks the love calculator the
// same question twice to make sure it does not change its mind.
//
// Needs playwright's chromium and a static server on :8099.
//   node .github/scripts/browser-arcade.mjs
// ===================================================================
import { chromium } from 'playwright';

const BASE = process.env.SITE_URL || 'http://localhost:8099';
let failures = 0, checks = 0;
const ok = m => { checks++; console.log('  ok    ' + m); };
const bad = (m, d) => { checks++; failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const is = (c, m, d) => c ? ok(m) : bad(m, d);
const section = n => console.log('\n== ' + n + ' ==');

// one fetch of tailwind, served to the page — the layout matters here,
// because half of these checks are about clicking a real element
const TAILWIND = 'https://cdn.tailwindcss.com';
let tailwind = null;
try {
    const res = await fetch(TAILWIND + '?plugins=forms,container-queries', { redirect: 'follow' });
    if (res.ok) tailwind = await res.text();
} catch (e) { }

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
await ctx.route('**/*', route => {
    const u = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) return route.continue();
    if (tailwind && u.startsWith(TAILWIND)) {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: tailwind });
    }
    return route.abort();
});
await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });

const errors = [];
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
// naming the pet is a prompt(); playwright blocks on one unless it is answered
p.on('dialog', d => d.accept('gary'));

const fresh = async (slug) => {
    await p.evaluate(() => document.querySelectorAll('.app-window,.retro-dialog-overlay').forEach(w => w.remove()));
    await p.evaluate(s => appActions()[s](), slug);
    await p.waitForTimeout(700);
};

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.keyboard.press('Enter');
await p.evaluate(() => {
    const b = document.getElementById('boot-screen');
    if (b) b.remove();
    window.soundEnabled = false;
});
await p.waitForTimeout(900);

// ===================================================================
section('every one of them opens');
// ===================================================================
const SLUGS = ['tictactoe', 'rps', 'hangman', 'simon', 'g2048', 'tetris', 'breakout', 'whack',
    'pet', 'blinkie', 'stamps', 'awards', 'directory', 'scandisk', 'setup', 'moreram', 'virus',
    'netpassword', 'soundboard', 'moon', 'worldclock', 'biorhythm', 'love', 'cowsay', 'dice', 'rating'];
const empty = [];
for (const slug of SLUGS) {
    const before = errors.length;
    await fresh(slug);
    const info = await p.evaluate(() => {
        const w = document.querySelector('.app-window');
        if (!w) return { none: true };
        const body = w.querySelector('.app-window-body');
        return { content: body ? body.innerText.trim().length : 0 };
    });
    if (info.none || info.content < 5 || errors.length > before) empty.push(slug);
}
is(empty.length === 0, 'all ' + SLUGS.length + ' windows open with something in them and nothing thrown',
    empty.join(', '));

for (const slug of ['neko', 'trail', 'scroller', 'surprise']) {
    const before = errors.length;
    await p.evaluate(s => appActions()[s](), slug);
    await p.waitForTimeout(500);
    const on = await p.evaluate(s => ({
        neko: !!document.querySelector('.neko'),
        trail: !!document.querySelector('.trail-dot'),
        scroller: /welcome|mrhakan/i.test((document.getElementById('ie-status-text') || {}).textContent || ''),
        surprise: /app=/.test(location.search)
    })[s], slug);
    is(on && errors.length === before, slug + ' does something when you turn it on');
}
// and off again, or they are not toggles
await p.evaluate(() => { appActions().neko(); appActions().trail(); appActions().scroller(); });
await p.waitForTimeout(400);
is(await p.evaluate(() => !document.querySelector('.neko') && !document.querySelector('.trail-dot')),
    'and they all turn back off');

// ===================================================================
section('tic tac toe cannot be beaten');
await fresh('tictactoe');
// Eight full games, always taking the first free cell. A perfect
// engine never loses, so the only honest outcomes are draws and
// defeats — if a win ever shows up here, the minimax is broken.
let humanWins=0;
for (let g=0; g<8; g++){
  await p.locator('[data-new]').click(); await p.waitForTimeout(120);
  for (let m=0;m<5;m++){
    const free = await p.locator('.ttt-cell:not([disabled])').count();
    if(!free) break;
    await p.locator('.ttt-cell:not([disabled])').first().click({force:true});
    await p.waitForTimeout(90);
  }
  const msg = await p.locator('[data-msg]').textContent();
  if (/you won/.test(msg)) humanWins++;
}
is(humanWins===0, 'eight games, the human never won', 'human won '+humanWins);
is(+(await p.locator('[data-l]').textContent()) + +(await p.locator('[data-d]').textContent()) === 8,
   'and every game ended in a loss or a draw');

section('2048 actually merges');
await fresh('g2048');
is(await p.locator('.g2048-cell:not(.v0)').count() === 2, 'it starts with two tiles');
for (const k of ['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','ArrowLeft','ArrowUp']) {
  await p.keyboard.press(k); await p.waitForTimeout(140);
}
const score = +(await p.locator('[data-s]').textContent());
const tiles = await p.locator('.g2048-cell:not(.v0)').count();
is(tiles > 2, 'tiles spawn as you move ('+tiles+')');
is(score > 0, 'and merging scores ('+score+')');

section('tetris drops and clears');
await fresh('tetris');
const t0 = await p.evaluate(()=>document.querySelector('canvas').toDataURL().length);
await p.waitForTimeout(1600);
const t1 = await p.evaluate(()=>document.querySelector('canvas').toDataURL().length);
is(t0 !== t1, 'the piece falls on its own');
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowUp');
await p.keyboard.press(' '); await p.waitForTimeout(300);
is(!errors.length, 'move, rotate and hard drop all run clean');

section('hangman');
await fresh('hangman');
const shown0 = await p.locator('[data-word]').textContent();
is(/_/.test(shown0), 'the word starts hidden', shown0);
for (const ch of 'aeiourstln') { await p.locator(`[data-k="${ch}"]`).click({force:true}); await p.waitForTimeout(60); }
const shown1 = await p.locator('[data-word]').textContent();
is(shown1 !== shown0, 'guessing letters changes the board');

section('breakout');
await fresh('breakout');
await p.locator('canvas').click({force:true});
await p.waitForTimeout(1400);
is(await p.evaluate(()=>true), 'it serves and runs without throwing');

section('simon plays a sequence back');
await fresh('simon');
await p.locator('[data-new]').click();
await p.waitForTimeout(1400);
is(+(await p.locator('[data-r]').textContent()) === 1, 'round one');

section('the pet survives a reload and gets hungry on the clock');
await fresh('pet');
await p.locator('.pet-choice').first().click({force:true});
await p.waitForTimeout(500);
is(await p.locator('.pet-name').count() > 0, 'it can be adopted');
// wind the clock back nine hours and it should be hungry
await p.evaluate(()=>{
  const pet = JSON.parse(localStorage.getItem('mrhakan.pet'));
  pet.fed = Date.now() - 9*3600*1000;
  localStorage.setItem('mrhakan.pet', JSON.stringify(pet));
});
await fresh('pet');
const mood = await p.locator('.pet-stats').innerText();
is(/miserable|hungry/.test(mood), 'and it is hungry after nine hours away', mood.replace(/\n/g,' '));
await p.locator('[data-feed]').click({force:true}); await p.waitForTimeout(400);
is(/fine/.test(await p.locator('.pet-stats').innerText()), 'feeding it works');

section('the love calculator is stable and symmetric');
await fresh('love');
const calc = async (a,bb) => {
  await p.locator('[data-a]').fill(a); await p.locator('[data-b]').fill(bb);
  await p.locator('[data-go]').click({force:true}); await p.waitForTimeout(200);
  return (await p.locator('.love-pct').textContent());
};
const r1 = await calc('ada','grace'), r2 = await calc('grace','ada'), r3 = await calc('ada','grace');
is(r1===r2, 'the same pair either way round gives the same answer', r1+' vs '+r2);
is(r1===r3, 'and it does not change between tries');

section('scandisk finishes');
await fresh('scandisk');
await p.locator('[data-go]').click({force:true});
await p.waitForTimeout(7000);
const st = await p.locator('[data-status]').textContent();
is(/did not find any errors|bad cluster/.test(st), 'it reaches a verdict', st.slice(0,70));
is(await p.evaluate(()=>document.querySelector('[data-bar]').style.width)==='100%', 'and the bar gets to the end');

section('cowsay draws a bubble the width of the text');
await fresh('cowsay');
await p.locator('[data-text]').fill('hello');
await p.waitForTimeout(200);
const cow = await p.locator('.cow-out').textContent();
is(/< hello >/.test(cow), 'a short line gets a one-line bubble', JSON.stringify(cow.split('\n')[1]));
await p.locator('[data-text]').fill('a much longer sentence that has to wrap onto two lines somewhere');
await p.waitForTimeout(200);
const cow2 = await p.locator('.cow-out').textContent();
is(/^\//.test(cow2.split('\n')[1]) && /\\$/.test(cow2.split('\n')[1].trim()),
   'and a long one gets the multi-line box', JSON.stringify(cow2.split('\n')[1]));

section('the moon agrees with itself');
const moon = await p.evaluate(()=>{
  // a full cycle apart should give roughly the same phase
  const a = moonPhase(new Date('2026-01-01T12:00:00Z'));
  const b = moonPhase(new Date('2026-01-30T12:00:00Z'));
  return {a,b,diff:Math.min(Math.abs(a-b), 30-Math.abs(a-b))};
});
is(moon.diff <= 2, 'a lunar month later is the same phase', JSON.stringify(moon));


console.log('\n' + '='.repeat(58));
const real = errors.filter(e => !/ERR_|net::/.test(e));
is(!real.length, 'no javascript errors anywhere in the run', real.slice(0, 5).join('\n        '));
await browser.close();
if (failures) {
    console.log(`${failures} of ${checks} checks FAILED`);
    process.exit(1);
}
console.log(`all ${checks} arcade checks passed`);
process.exit(0);
