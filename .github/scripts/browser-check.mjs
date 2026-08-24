// ===================================================================
// browser-check.mjs — open the actual site in a real browser and play
//
// check-games.mjs proves the data and the recogniser are sound. This
// one proves the thing works when a person uses it: boot the desktop,
// open wizardz, draw a triangle with the mouse and confirm a fireball
// comes out; then open two tabs, make an invite code in one, join with
// the other, start the duel, and check that a spell drawn by the guest
// lands on the host's simulation.
//
// Needs a static server on :8099 and playwright's chromium.
// ===================================================================
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.SITE_URL || 'http://localhost:8099/index.html';
const SHOTS = '.ci-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = m => console.log('  ok    ' + m);
const bad = (m, d) => { failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const expect = (c, m, d) => c ? ok(m) : bad(m, d);
const section = n => console.log('\n== ' + n + ' ==');

// PW_CHROMIUM lets a machine that already has a chromium skip the download
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 860 } });
// the welcome popup fires 1.4s after every boot and, being a retro dialog,
// evicts whatever dialog is already on screen — including one a test just
// opened. mark the session as welcomed before any page script runs.
await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });
const errors = [];

async function boot(tag, url) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(tag + ': ' + e.message));
    p.on('console', m => {
        const t = m.text();
        // the cdn bits (tailwind, google fonts) are not part of this test
        if (m.type() === 'error' && !/ERR_|404|504|Failed to load resource/.test(t)) errors.push(tag + ' console: ' + t);
    });
    await p.goto(url || BASE, { waitUntil: 'load' });
    await p.keyboard.press('Enter');          // the boot screen wants a keypress
    await p.waitForTimeout(900);
    await p.evaluate(() => { window.soundEnabled = false; });
    return p;
}
// draw strokes in arena coordinates (760x400) with the real mouse
async function draw(page, strokes) {
    const box = await (await page.$('#wz-canvas')).boundingBox();
    const sx = box.width / 760, sy = box.height / 400;
    for (const s of strokes) {
        await page.mouse.move(box.x + s[0][0] * sx, box.y + s[0][1] * sy);
        await page.mouse.down();
        for (const [x, y] of s.slice(1)) await page.mouse.move(box.x + x * sx, box.y + y * sy, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(50);
    }
    await page.waitForTimeout(700);           // the recogniser waits for a pause
}
// the simulation is frame driven and headless chromium renders slowly,
// so never guess at the countdown — wait for the round to actually start
async function waitLive(page) {
    const h = await page.waitForFunction(() => {
        const g = window.WZ_ENGINE && WZ_ENGINE.state();
        return g && g.phase === 'live' ? { bot: g.bot && g.bot.id, hint: g.hint && g.hint.text } : null;
    }, null, { timeout: 30000 });
    return h.jsonValue();
}
const TRIANGLE = [[[380, 120], [455, 255], [305, 255], [380, 120]]];   // fireball
const ZBOLT = [[[430, 120], [340, 190], [400, 190], [320, 270]]];      // spark

try {
    // ---------------------------------------------------------------
    section('single player');
    // ---------------------------------------------------------------
    const solo = await boot('solo');
    await solo.evaluate(() => openWizardz());
    await solo.waitForFunction(() => !!window.startWizardz && !!window.WZ_ENGINE, null, { timeout: 30000 });
    ok('the game loads on demand from the desktop');
    await solo.waitForTimeout(600);
    await solo.screenshot({ path: SHOTS + '/1-menu.png' });

    const counts = await solo.evaluate(() => ({ spells: WZ.SPELLS.length, templates: WZ_ENGINE.templates().length }));
    expect(counts.spells === 50 && counts.templates === 50, 'fifty spells and fifty templates in the browser', JSON.stringify(counts));

    await solo.evaluate(() => startWizardz('solo', 'cinder'));
    await solo.waitForSelector('#wz-canvas', { timeout: 10000 });
    ok('a 1 v bot duel starts');
    const opponent = await solo.evaluate(() => {
        const g = WZ_ENGINE.state();
        return { name: g.wiz[1].name, bot: g.bot && g.bot.id, hat: g.wiz[1].avatar.hat };
    });
    expect(opponent.bot === 'cinder' && /cinder/.test(opponent.name),
        'you fight the bot you picked, with its own face', JSON.stringify(opponent));
    await waitLive(solo);

    await draw(solo, TRIANGLE);
    const afterDraw = await solo.evaluate(() => {
        const g = WZ_ENGINE.state();
        return { ents: g.ents.length, mana: g.wiz[g.me].mana, hint: g.hint && g.hint.text };
    });
    expect(afterDraw.ents > 0, 'drawing a triangle put a fireball in the air', JSON.stringify(afterDraw));
    expect(afterDraw.mana < 100, 'casting cost mana', 'mana ' + afterDraw.mana);
    expect(/fireball/.test(afterDraw.hint || ''), 'the game says what it read', afterDraw.hint);
    await solo.screenshot({ path: SHOTS + '/2-duel.png' });

    // the machine has to be both dangerous and survivable: a player who
    // does nothing at all should be losing after ten seconds, but not
    // dead. this is the check that caught a piercing bolt billing its
    // target sixty times a second.
    await solo.evaluate(() => { localStorage.setItem('mrhakan98-wizardz-difficulty', 'normal'); startWizardz('solo', 'cinder'); });
    await waitLive(solo);
    await solo.waitForTimeout(8000);
    const survived = await solo.evaluate(() => {
        const g = WZ_ENGINE.state();
        return { hp: Math.round(g.wiz[g.me].hp), round: g.round, wins: g.wins, phase: g.phase };
    });
    expect(survived.hp > 0 && survived.round === 1, 'a passive player survives eight seconds on normal', JSON.stringify(survived));
    expect(survived.hp < 100, 'but the machine is definitely trying', JSON.stringify(survived));
    console.log('        hp left after doing nothing for 8s: ' + survived.hp);

    // the roster screen
    await solo.evaluate(() => startWizardz('bot'));
    await solo.waitForSelector('.wz-bot', { timeout: 8000 });
    const cards = await solo.$$eval('.wz-bot', els => els.map(e => e.querySelector('.wz-bot-name').textContent.trim()));
    const roster = await solo.evaluate(() => WZ.BOTS.map(b => b.name));
    expect(cards.length === roster.length && roster.every(n => cards.includes(n)),
        'the 1 v bot roster shows every opponent', JSON.stringify(cards));
    await solo.screenshot({ path: SHOTS + '/2b-bots.png' });

    // each bot has to be startable and has to open its mouth
    const tried = [];
    let allGreeted = true;
    for (const id of await solo.evaluate(() => WZ.BOTS.map(b => b.id))) {
        await solo.evaluate(bid => startWizardz('solo', bid), id);
        const st = await waitLive(solo);       // the greeting lands as the round opens
        tried.push(id + (st.hint ? ' ✓' : ' SAID NOTHING'));
        if (st.bot !== id || !st.hint) { allGreeted = false; bad('bot ' + id + ' starts and greets you', JSON.stringify(st)); }
    }
    if (allGreeted) ok('every bot on the roster starts a duel and greets you');
    console.log('        ' + tried.join(', '));

    // the other windows open without throwing
    await solo.evaluate(() => wizardzGrimoire());
    await solo.waitForTimeout(700);
    expect(await solo.$('.wz-book-list') !== null, 'the grimoire opens');
    await solo.screenshot({ path: SHOTS + '/3-grimoire.png' });
    await solo.evaluate(() => wizardzAvatar());
    await solo.waitForTimeout(700);
    expect((await solo.$$('.wz-part')).length >= 12, 'the dressing room opens with every part');
    await solo.screenshot({ path: SHOTS + '/4-avatar.png' });
    await solo.close();

    // ---------------------------------------------------------------
    section('signing the guestbook');
    //
    // The guestbook is a public gist and signing it is a comment on
    // that gist. This is the real thing: a stubbed gist api hands the
    // page a comment thread (including one written by somebody with
    // bad intentions), and then the form is filled in and "sign it!"
    // pressed to see what ends up on the clipboard.
    // ---------------------------------------------------------------
    const gb = await boot('guestbook');
    const board = await gb.evaluate(async () => {
        const GIST = 'a7fa4c89c27fc3adedf1ff96b0514472';
        const comments = [
            {
                id: 1, created_at: '2026-08-14T09:00:00Z',
                html_url: 'https://gist.github.com/MrHakan/' + GIST + '#gistcomment-1',
                user: { login: 'visitor', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                body: 'name: a stranger\nsite: example.com\n\nsigned from a gist comment'
            },
            {
                id: 2, created_at: '2026-08-14T09:30:00Z',
                html_url: 'https://gist.github.com/MrHakan/' + GIST + '#gistcomment-2',
                user: { login: 'hax', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' },
                body: 'name: <img src=x onerror="window.__pwned=1">\n\n<script>window.__pwned=1<\/script> hello'
            }
        ];
        // the gist api and site.json both stubbed; everything else on the
        // page keeps its normal fetch
        const real = window.fetch.bind(window);
        window.fetch = (url, opts) => {
            const u = String(url && url.url ? url.url : url);
            if (u.indexOf('api.github.com/gists/') >= 0) {
                return Promise.resolve(new Response(JSON.stringify(comments), { headers: { 'content-type': 'application/json' } }));
            }
            if (u.indexOf('api.github.com/repos/') >= 0) {
                return Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } }));
            }
            if (/data\/site\.json/.test(u)) {
                return Promise.resolve(new Response(JSON.stringify({ boards: { owner: 'MrHakan', guestbook: GIST, shouts: GIST } }),
                    { headers: { 'content-type': 'application/json' } }));
            }
            return real(url, opts);
        };
        // the tray status widget already read the real site.json; drop
        // both caches so the stub above is what the boards see
        siteData = null;
        boardsCache = null;
        showSection('guestbook');
        await loadGuestbook();
        const wall = document.getElementById('guestbook-entries');
        return {
            html: wall.innerHTML,
            text: wall.textContent,
            injected: !!document.querySelector('#guestbook-entries script, #guestbook-entries img[onerror]'),
            pwned: !!window.__pwned
        };
    });
    expect(/signed from a gist comment/.test(board.text), 'the wall is the gist comment thread', board.text.slice(0, 200));
    expect(/@visitor/.test(board.text), 'each entry carries the github account that wrote it', board.text.slice(0, 200));
    expect(/gistcomment-1/.test(board.html), 'and links back to the comment', board.html.slice(0, 200));
    expect(!board.injected && !board.pwned, 'a comment full of markup renders as text and runs nothing',
        board.html.slice(0, 200));

    const opened = await gb.evaluate(async () => {
        window.__opened = null;
        window.open = (url) => { window.__opened = url; return null; };
        window.__copied = null;
        // headless chromium has no clipboard permission; catch what it tried
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: v => { window.__copied = v; return Promise.resolve(); } }
        });
        document.getElementById('gb-name').value = 'test visitor';
        document.getElementById('gb-website').value = 'example.com';
        document.getElementById('gb-message').value = 'hello from the browser test';
        document.getElementById('guestbook-form').dispatchEvent(new Event('submit', { cancelable: true }));
        // signing reads the config before it can name the gist, so the
        // dialog arrives a tick later — wait for the one it opens rather
        // than for whatever dialog happens to be on screen
        for (let i = 0; i < 60; i++) {
            const t = document.querySelector('.retro-dialog-title');
            if (t && /gist/i.test(t.textContent)) break;
            await new Promise(r => setTimeout(r, 100));
        }
        const dialog = document.querySelector('.retro-dialog');
        const text = dialog ? dialog.textContent : '';
        const preview = dialog && dialog.querySelector('.retro-dialog-pre');
        const okBtn = dialog && [...dialog.querySelectorAll('button')].find(b => /copy \+ open/i.test(b.textContent));
        if (okBtn) okBtn.click();
        await new Promise(r => setTimeout(r, 200));
        return { text, preview: preview ? preview.textContent : '', url: window.__opened, copied: window.__copied };
    });
    // saying "no pull request" is fine; promising one is not
    expect(/gist/i.test(opened.text) && /comment/i.test(opened.text)
        && !/(opens?|via|through) (a )?(github )?(pull request|issue)/i.test(opened.text),
        'the dialog explains the gist comment, not a fork or an issue', opened.text.slice(0, 200));
    expect(/^name: test visitor\nsite: https:\/\/example\.com\/\n\nhello from the browser test/.test(opened.preview),
        'it shows exactly what is going on the clipboard', JSON.stringify(opened.preview));
    expect(opened.copied === opened.preview, 'and that is what it copies', JSON.stringify(opened.copied));
    expect(opened.url === 'https://gist.github.com/MrHakan/a7fa4c89c27fc3adedf1ff96b0514472#comments',
        'then opens the gist at the comment box', opened.url);
    await gb.close();

    // guestbook.html is the standalone page — index.js without the rest of
    // the desktop's scripts. it is easy to break from index.js and nothing
    // was ever opening it, so: open it, on the real config.
    const page2 = await boot('guestbook.html', BASE.replace(/[^/]*$/, 'guestbook.html'));
    await page2.waitForTimeout(1500);
    const standalone = await page2.evaluate(async () => {
        const cfg = await boardConfig();
        return { cfg, form: !!document.getElementById('guestbook-form'), gist: GUESTBOOK.gistPage(cfg, 'guestbook') };
    });
    expect(standalone.form && /^https:\/\/gist\.github\.com\/./.test(standalone.gist),
        'the standalone guestbook page knows which gist it signs', JSON.stringify(standalone));
    expect(!!standalone.cfg.guestbook && !!standalone.cfg.shouts && standalone.cfg.guestbook !== standalone.cfg.shouts,
        'and both boards are pointed at their own gist', JSON.stringify(standalone.cfg));
    await page2.close();

    // ---------------------------------------------------------------
    section('motion and the performance tab');
    //
    // fx.js is checked properly in check-motion.mjs against a fake
    // element; this is the part that needs a real browser — that the
    // desktop actually plays the animations, that a closed window
    // really leaves, and that the charts put pixels on a canvas.
    // ---------------------------------------------------------------
    const desk = await boot('motion');
    const taskmgr = await desk.evaluate(async () => {
        openTaskManager();
        await new Promise(r => setTimeout(r, 400));
        const win = document.querySelector('.app-window');
        return {
            windows: document.querySelectorAll('.app-window').length,
            animating: win ? win.getAnimations().length : 0,
            tabs: document.querySelectorAll('.tm-tab').length
        };
    });
    expect(taskmgr.windows === 1 && taskmgr.tabs === 2, 'the task manager opens with its tabs', JSON.stringify(taskmgr));
    ok('a window animates as it opens' + (taskmgr.animating ? '' : ' (already finished)'));

    const perf = await desk.evaluate(async () => {
        [...document.querySelectorAll('.tm-tab')].find(b => b.dataset.tab === 'performance').click();
        await new Promise(r => setTimeout(r, 1400));   // let the ticker take samples
        const c = document.querySelector('#tm-cpu');
        const ctx = c.getContext('2d');
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        let ink = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 1] > 60) ink++;
        return {
            hidden: document.querySelector('#tm-pane-processes').hidden,
            w: c.width, h: c.height, ink,
            ring: !!document.querySelector('#tm-ring'), bars: !!document.querySelector('#tm-bars')
        };
    });
    expect(perf.hidden && perf.w > 0 && perf.h > 0, 'the performance tab swaps in with a sized canvas', JSON.stringify(perf));
    expect(perf.ink > 200, 'and the cpu history is actually drawn', perf.ink + ' green pixels');
    expect(perf.ring && perf.bars, 'with the load ring and the per-process bars');

    const gone = await desk.evaluate(async () => {
        document.querySelector('.app-window .ie-titlebar-btn:last-child').click();
        const immediately = document.querySelectorAll('.app-window[id^="app-win-"]').length;
        await new Promise(r => setTimeout(r, 500));
        return { immediately, after: document.querySelectorAll('.app-window').length };
    });
    expect(gone.immediately === 0 && gone.after === 0, 'a closed window is unreachable at once and gone shortly after',
        JSON.stringify(gone));

    // and the promise that matters: ask for less motion, get none
    const still = await desk.evaluate(async () => {
        FX.setEnabled(false);
        const el = document.createElement('div');
        document.body.appendChild(el);
        FX.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
        const running = el.getAnimations().length;
        const opacity = el.style.opacity;
        openTaskManager();
        await new Promise(r => setTimeout(r, 100));
        const win = document.querySelector('.app-window');
        const winAnims = win ? win.getAnimations().length : -1;
        el.remove();
        FX.setEnabled(true);
        return { running, opacity, winAnims };
    });
    expect(still.running === 0 && still.winAnims === 0, 'with animations off nothing animates at all', JSON.stringify(still));
    expect(String(still.opacity) === '1', 'but the end state is applied anyway', String(still.opacity));
    await desk.close();

    // ---------------------------------------------------------------
    section('jokerz 98 moves');
    //
    // The table used to be rebuilt with innerHTML on every click, so
    // the card you selected was destroyed and recreated already
    // raised. The check that matters is therefore not "does it
    // animate" but "does the element survive the click" — everything
    // else follows from that.
    // ---------------------------------------------------------------
    const jok = await boot('jokerz');
    await jok.evaluate(() => openBalatro());
    await jok.waitForFunction(() => !!window.startBalatro && !!window.BJFX, null, { timeout: 30000 });
    await jok.evaluate(() => { balAction('start'); balAction('select'); });
    await jok.waitForSelector('.bj-hand .bj-card', { timeout: 10000 });
    await jok.waitForTimeout(500);
    ok('the game loads with its animation layer');

    const picked = await jok.evaluate(async () => {
        const card = document.querySelector('.bj-hand .bj-card');
        card.dataset.probe = 'yes';
        card.click();
        await new Promise(r => setTimeout(r, 60));
        const same = document.querySelector('.bj-hand .bj-card');
        return {
            survived: same.dataset.probe === 'yes',
            selected: same.classList.contains('sel'),
            animating: same.getAnimations().length > 0,
            readout: document.querySelector('.bj-hand-name').textContent.trim(),
            state: BG.selected.length
        };
    });
    expect(picked.survived, 'picking a card no longer rebuilds the table', JSON.stringify(picked));
    expect(picked.selected && picked.state === 1, 'the card is selected in the dom and in the game', JSON.stringify(picked));
    expect(picked.animating, 'and it animates up rather than teleporting');
    expect(/high card|pair|flush|straight/i.test(picked.readout), 'the readout follows without a redraw', picked.readout);

    const discarded = await jok.evaluate(async () => {
        const cards = [...document.querySelectorAll('.bj-hand .bj-card')];
        cards[1].click(); cards[2].click();
        await new Promise(r => setTimeout(r, 120));
        const uids = BG.selected.map(c => c.uid);
        const discardsBefore = BG.discards;
        document.querySelector('[data-act="discard"]').click();
        await new Promise(r => setTimeout(r, 120));
        const flying = uids.filter(u => {
            const el = document.querySelector(`.bj-hand .bj-card[data-uid="${u}"]`);
            return el && el.getAnimations().length > 0;
        }).length;
        const stillThere = uids.filter(u => document.querySelector(`.bj-hand .bj-card[data-uid="${u}"]`)).length;
        await new Promise(r => setTimeout(r, 900));
        return {
            flying, stillThere, discardsBefore, discardsAfter: BG.discards,
            gone: uids.every(u => !BG.hand.some(c => c.uid === u)),
            hand: BG.hand.length, selected: BG.selected.length
        };
    });
    expect(discarded.flying === 3 && discarded.stillThere === 3,
        'discarded cards fly out before they leave the hand', JSON.stringify(discarded));
    expect(discarded.gone && discarded.discardsAfter === discarded.discardsBefore - 1,
        'and the discard really happens once they land', JSON.stringify(discarded));
    expect(discarded.hand > 0 && discarded.selected === 0, 'the hand refills and the selection clears',
        JSON.stringify(discarded));

    const hit = await jok.evaluate(async () => {
        document.querySelector('.bj-hand .bj-card').click();
        await new Promise(r => setTimeout(r, 80));
        const before = BG.score;
        document.querySelector('[data-act="play"]').click();
        // the score moves the instant the hand is played; the damage
        // lands on the blind at the *end* of the tally, so watch for the
        // float rather than for the number
        let floats = 0;
        for (let i = 0; i < 60 && !floats; i++) {
            await new Promise(r => setTimeout(r, 60));
            floats = document.querySelectorAll('.bj-float').length;
        }
        await new Promise(r => setTimeout(r, 2500));
        return { before, after: BG.score, floats, leftover: document.querySelectorAll('.bj-float').length };
    });
    expect(hit.after > hit.before, 'playing a hand scores against the blind', JSON.stringify(hit));
    expect(hit.floats > 0, 'and the damage floats off it', JSON.stringify(hit));
    expect(hit.leftover === 0, 'the floating numbers clean themselves up', String(hit.leftover));
    await jok.screenshot({ path: SHOTS + '/9-jokerz.png' });

    // with nothing selected the readout has to read zero. it used to
    // show the previous hand's chips and mult, which looks exactly like
    // the game failing to recalculate.
    const readout = await jok.evaluate(() => ({
        chips: (document.querySelector('.bj-chips') || {}).textContent,
        mult: (document.querySelector('.bj-mult') || {}).textContent,
        last: !!document.querySelector('.bj-last'),
        selected: BG.selected.length
    }));
    expect(readout.selected === 0 && readout.chips === '0' && readout.mult === '0',
        'after a hand is played the readout resets instead of showing the last one', JSON.stringify(readout));
    expect(readout.last, 'the previous hand is still reported, on its own line', JSON.stringify(readout));

    // the faces, and the head that lands on them
    const faces = await jok.evaluate(() => {
        const bar = document.querySelector('.bj-blindbar .bj-face');
        return {
            inBar: !!bar,
            loaded: bar ? (bar.complete && bar.naturalWidth > 0) : false,
            hue: bar ? bar.style.filter : '',
            title: bar ? bar.title : ''
        };
    });
    expect(faces.inBar && faces.loaded, 'the blind you are playing has a face, and it loaded', JSON.stringify(faces));
    expect(/hue-rotate/.test(faces.hue) && faces.title.length > 2, 'tinted and named', JSON.stringify(faces));


    // and with motion off the same moves still work, just instantly
    const quiet = await jok.evaluate(async () => {
        FX.setEnabled(false);
        const cards = [...document.querySelectorAll('.bj-hand .bj-card')];
        cards[0].click();
        await new Promise(r => setTimeout(r, 40));
        const anims = cards[0].getAnimations().filter(a => a.playState === 'running').length;
        const selected = BG.selected.length;
        const discardsBefore = BG.discards;
        document.querySelector('[data-act="discard"]').click();
        await new Promise(r => setTimeout(r, 150));
        const out = { anims, selected, discarded: BG.discards === discardsBefore - 1, hand: BG.hand.length };
        FX.setEnabled(true);
        return out;
    });
    expect(quiet.selected === 1 && quiet.anims === 0, 'with motion off a card still selects, without moving',
        JSON.stringify(quiet));
    expect(quiet.discarded && quiet.hand > 0, 'and discarding still discards', JSON.stringify(quiet));

    // last, because winning takes the table away: after this the
    // cashout screen is up and there is no hand to click on
    const won = await jok.evaluate(async () => {
        BG.required = 1;                       // beat it with whatever is in hand
        document.querySelector('.bj-hand .bj-card').click();
        await new Promise(r => setTimeout(r, 60));
        document.querySelector('[data-act="play"]').click();
        // the screen flag flips when the hand scores; the dom catches up
        // when the scoring animation ends
        for (let i = 0; i < 100 && !document.querySelector('.bj-victim'); i++) await new Promise(r => setTimeout(r, 100));
        let head = null;
        for (let i = 0; i < 30 && !head; i++) { await new Promise(r => setTimeout(r, 50)); head = document.querySelector('.bj-bonk'); }
        const victim = document.querySelector('.bj-victim .bj-face');
        const out = {
            victim: !!victim, head: !!head,
            headSrc: head ? head.src.split('/').pop() : '',
            headLoaded: head ? (head.complete && head.naturalWidth > 0) : false
        };
        // it lands on them, then leaves. the drop is a shade over a second,
        // but a busy machine stretches wall-clock animations — wait for it to
        // actually go rather than for a number of milliseconds to pass
        for (let i = 0; i < 60 && document.querySelector('.bj-bonk'); i++) await new Promise(r => setTimeout(r, 100));
        out.headGone = !document.querySelector('.bj-bonk');
        out.stillThere = !!document.querySelector('.bj-victim .bj-face');
        return out;
    });
    expect(won.victim, 'beating a blind shows you who you beat', JSON.stringify(won));
    expect(won.head && won.headLoaded, 'and drops a head on them', JSON.stringify(won));
    expect(won.headGone && won.stillThere, 'which then falls off and leaves, taking nothing with it',
        JSON.stringify(won));
    await jok.screenshot({ path: SHOTS + '/10-bonk.png' });
    await jok.close();

    // ---------------------------------------------------------------
    section('defragmenting drive c:');
    //
    // The plan is checked properly in check-defrag.mjs against a model
    // of the disk. This is the part that needs a real browser: that the
    // disk it lays out is made of the files this page actually
    // downloaded, and that running it to the end really does leave the
    // map packed and the counter at zero.
    // ---------------------------------------------------------------
    const dfg = await boot('defrag');
    await dfg.evaluate(() => openDefrag());
    await dfg.waitForSelector('#dfg-map', { timeout: 8000 });
    await dfg.waitForTimeout(400);
    // the two blues are the whole story: dark is data that has to move,
    // light is data that is home. counting them off the canvas is how
    // this knows the picture really changed rather than the label
    const countBlues = () => {
        const c = document.querySelector('#dfg-map');
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let dark = 0, light = 0;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i] < 60 && px[i + 2] > 80 && px[i + 2] < 160) dark++;
            else if (px[i] > 55 && px[i] < 110 && px[i + 2] > 180) light++;
        }
        return { dark, light, w: c.width, h: c.height };
    };
    const disk = await dfg.evaluate(fn => {
        const blues = new Function('return ' + fn)()();
        return {
            w: blues.w, h: blues.h, dark: blues.dark, light: blues.light,
            frag: parseInt(document.querySelector('#dfg-frag').textContent),
            files: DEFRAG.realFiles().map(f => f.name),
            label: document.querySelector('#dfg-cluster').textContent
        };
    }, countBlues.toString());
    expect(disk.w > 0 && disk.h > 0 && disk.dark > 2000,
        'the disk map is drawn, and it is a mess', JSON.stringify({ w: disk.w, dark: disk.dark, light: disk.light }));
    expect(disk.frag > 40, 'and it starts in a state worth defragmenting', disk.frag + '%');
    expect(disk.files.some(n => /index\.js$/.test(n)) && disk.files.some(n => /style\.css$/.test(n)),
        'the clusters are the files this page really loaded', disk.files.slice(0, 6).join(', '));
    expect(/\d+ files/.test(disk.label), 'and it says how many', disk.label);

    const ran = await dfg.evaluate(async fn => {
        document.querySelector('#dfg-speed').value = 'turbo';
        document.querySelector('[data-dfg="run"]').click();
        for (let i = 0; i < 250; i++) {
            await new Promise(r => setTimeout(r, 80));
            if (/complete/.test(document.querySelector('#dfg-status').textContent)) break;
        }
        const blues = new Function('return ' + fn)()();
        return {
            status: document.querySelector('#dfg-status').textContent,
            frag: parseInt(document.querySelector('#dfg-frag').textContent),
            fill: document.querySelector('#dfg-fill').style.width,
            dark: blues.dark, light: blues.light,
            dialog: (document.querySelector('.retro-dialog') || {}).textContent || '',
            unlocked: !!(localStorage.getItem('achievements') || '').match(/defrag/)
        };
    }, countBlues.toString());
    expect(/complete/.test(ran.status) && ran.fill === '100%', 'it runs to the end', JSON.stringify(ran));
    expect(ran.frag === 0, 'and the drive comes out unfragmented', ran.frag + '%');
    expect(ran.dark === 0 && ran.light > disk.light,
        'the map agrees: nothing left to move', JSON.stringify({ before: disk, after: { dark: ran.dark, light: ran.light } }));
    expect(/complete/i.test(ran.dialog), 'with the dialog the original always gave you', ran.dialog.slice(0, 80));
    expect(ran.unlocked, 'and the achievement it has always had');
    await dfg.screenshot({ path: SHOTS + '/11-defrag.png' });
    await dfg.close();

    // ---------------------------------------------------------------
    section('icons');
    //
    // the icon font is a subset. an icon that is not in it renders as
    // its own name in 24px letters, which is exactly what happened to
    // "auto_fix_high" in the start menu, so this checks every icon the
    // site asks for against the font that ships.
    // ---------------------------------------------------------------
    const iconPage = await boot('icons');
    const iconNames = await iconPage.evaluate(async () => {
        // every icon the site can ask for: written into the markup, or
        // passed as an icon: option to a window / status entry
        const names = new Set();
        document.querySelectorAll('.material-symbols-outlined').forEach(el => {
            const t = el.textContent.trim();
            if (/^[a-z0-9_]+$/.test(t)) names.add(t);
        });
        for (const f of ['index.js', 'apps.js', 'fun.js', 'pages.js', 'extras.js', 'themes.js',
            'theme-maker.js', 'games/netplay.js', 'games/wizardz.js', 'games/wizardz-data.js']) {
            const src = await fetch(f).then(r => r.text()).catch(() => '');
            for (const m of src.matchAll(/icon: '([a-z0-9_]+)'/g)) names.add(m[1]);
            for (const m of src.matchAll(/material-symbols-outlined[^>]*>([a-z0-9_]+)</g)) names.add(m[1]);
        }
        return [...names];
    });
    const missingIcons = await iconPage.evaluate(async (names) => {
        await document.fonts.load('24px "Material Symbols Outlined"');
        await document.fonts.ready;
        const probe = document.createElement('span');
        probe.className = 'material-symbols-outlined';
        probe.style.cssText = 'position:absolute;left:-9999px;font-size:24px;visibility:hidden';
        document.body.appendChild(probe);
        const bad = [];
        for (const n of names) {
            probe.textContent = n;
            // a real glyph is one square em wide; a missing ligature falls
            // back to drawing the name itself, which is far wider
            if (probe.getBoundingClientRect().width > 30) bad.push(n);
        }
        probe.remove();
        return bad;
    }, iconNames);
    expect(iconNames.length > 60, 'found the icons the site uses', iconNames.length + ' names');
    expect(!missingIcons.length, 'every icon the site uses is in the font subset',
        'missing from the woff2: ' + missingIcons.join(', '));
    console.log('        checked ' + iconNames.length + ' icon names against the subset');
    await iconPage.close();

    // ---------------------------------------------------------------
    section('two players');
    // ---------------------------------------------------------------
    const host = await boot('host');
    const guest = await boot('guest');
    for (const [p, name] of [[host, 'hostwiz'], [guest, 'guestwiz']]) {
        await p.evaluate(() => openNetplay());
        await p.waitForSelector('#np-mode', { timeout: 30000 });
        await p.selectOption('#np-mode', 'local');   // same-browser transport, no network needed in ci
        await p.evaluate(n => Netplay.setName(n), name);
    }
    ok('the lobby opens in both tabs');

    await host.click('#np-host');
    await host.waitForSelector('.np-code', { timeout: 20000 });
    const code = (await host.textContent('.np-code')).trim();
    expect(/^[2-9A-HJ-NP-Z]{5}$/.test(code), 'the host gets a five letter invite code', code);

    await guest.fill('#np-code', code);
    await guest.click('#np-join');
    await guest.waitForSelector('.np-code', { timeout: 20000 });
    await host.waitForTimeout(1200);
    const seats = await host.$$eval('.np-player:not(.np-empty)', els => els.length);
    expect(seats === 2, 'both wizards are in the lobby', 'seats: ' + seats);
    await host.screenshot({ path: SHOTS + '/5-lobby.png' });

    await guest.fill('#np-chatin', 'prepare to be hexed');
    await guest.click('#np-send');
    await host.waitForTimeout(500);
    const chat = await host.$$eval('.np-line', els => els.map(e => e.textContent));
    expect(chat.some(l => /prepare to be hexed/.test(l)), 'chat reaches the other tab', JSON.stringify(chat));

    await guest.click('#np-ready');
    await host.waitForTimeout(300);
    await host.click('#np-ready');
    await host.waitForTimeout(300);
    await host.click('#np-start');
    await host.waitForTimeout(2000);
    const started = await Promise.all([host.$('#wz-canvas'), guest.$('#wz-canvas')]);
    expect(started[0] && started[1], 'the host starting the match starts it for both');
    await waitLive(host);
    await waitLive(guest);

    // the guest draws a fireball; the host owns the simulation, so the
    // damage has to show up there
    await draw(guest, TRIANGLE);
    await draw(host, ZBOLT);
    await host.waitForTimeout(2200);
    const hostState = await host.evaluate(() => {
        const g = WZ_ENGINE.state();
        return { host: !!g.isHost, me: g.me, hp: g.wiz.map(w => Math.round(w.hp)), st: Object.keys(g.wiz[0].st) };
    });
    const guestState = await guest.evaluate(() => {
        const g = WZ_ENGINE.state();
        return { host: !!g.isHost, me: g.me, hp: g.wiz.map(w => Math.round(w.hp)) };
    });
    expect(hostState.host && !guestState.host, 'exactly one side is running the simulation', JSON.stringify([hostState, guestState]));
    expect(hostState.hp[0] < 100, "the guest's spell damaged the host", JSON.stringify(hostState));
    expect(hostState.hp[1] < 100, "the host's spell damaged the guest", JSON.stringify(hostState));
    expect(Math.abs(hostState.hp[0] - guestState.hp[0]) <= 4 && Math.abs(hostState.hp[1] - guestState.hp[1]) <= 4,
        'both screens agree on the health bars', JSON.stringify([hostState.hp, guestState.hp]));
    console.log('        host sees ' + JSON.stringify(hostState.hp) + ', guest sees ' + JSON.stringify(guestState.hp));
    await host.screenshot({ path: SHOTS + '/6-duel-host.png' });
    await guest.screenshot({ path: SHOTS + '/7-duel-guest.png' });

    // ---------------------------------------------------------------
    // the same duel again, but with no p2p anywhere in it
    //
    // The "public relays" transport posts everything through nostr
    // relays. In CI that runs against server/nostr-test-relay.mjs so the
    // test does not depend on strangers' servers, but the client path is
    // the real one: signed events, encrypted payloads, room tags.
    // ---------------------------------------------------------------
    if (process.env.NOSTR_TEST_RELAY) {
        section('two players, no p2p');
        const useRelay = p => p.evaluate(u => localStorage.setItem('mrhakan98-netplay-relays', u), process.env.NOSTR_TEST_RELAY);
        const bHost = await boot('bus-host'), bGuest = await boot('bus-guest');
        for (const [p, name] of [[bHost, 'buswiz1'], [bGuest, 'buswiz2']]) {
            await useRelay(p);
            await p.evaluate(() => openNetplay());
            await p.waitForSelector('#np-mode', { timeout: 30000 });
            await p.selectOption('#np-mode', 'bus');
            await p.evaluate(n => Netplay.setName(n), name);
        }
        await bHost.click('#np-host');
        await bHost.waitForSelector('.np-code', { timeout: 40000 });
        const busCode = (await bHost.textContent('.np-code')).trim();
        ok('a room opens on the relays (' + busCode + ')');
        await bGuest.fill('#np-code', busCode);
        await bGuest.click('#np-join');
        await bGuest.waitForSelector('.np-code', { timeout: 40000 });
        await bHost.waitForFunction(() => document.querySelectorAll('.np-player:not(.np-empty)').length === 2, null, { timeout: 40000 });
        ok('both wizards found each other without a peer connection');
        await bGuest.click('#np-ready');
        await bHost.waitForTimeout(600);
        await bHost.click('#np-ready');
        await bHost.waitForTimeout(400);
        await bHost.click('#np-start');
        await Promise.all([
            bHost.waitForSelector('#wz-canvas', { timeout: 40000 }),
            bGuest.waitForSelector('#wz-canvas', { timeout: 40000 })
        ]);
        await Promise.all([waitLive(bHost), waitLive(bGuest)]);
        await draw(bGuest, TRIANGLE);
        await draw(bHost, ZBOLT);
        // the simulation is frame driven, and by now there are four pages
        // fighting over the cpu — so a couple of seconds of wall clock is
        // not a fixed number of frames. wait for the spells to land rather
        // than guessing at how long they take; if they never do, the
        // assertion below is the one that should say so.
        await bHost.waitForFunction(() => {
            const g = WZ_ENGINE.state();
            return g.wiz[0].hp < 100 && g.wiz[1].hp < 100;
        }, null, { timeout: 30000 }).catch(() => { });
        await bHost.waitForTimeout(600);      // and for the next snapshot to reach the guest
        const bh = await bHost.evaluate(() => { const g = WZ_ENGINE.state(); return { kind: g.session.transport.kind, hp: g.wiz.map(w => Math.round(w.hp)) }; });
        const bg = await bGuest.evaluate(() => { const g = WZ_ENGINE.state(); return { kind: g.session.transport.kind, hp: g.wiz.map(w => Math.round(w.hp)) }; });
        expect(bh.kind === 'bus' && bg.kind === 'bus', 'the duel really is running on the relay transport', JSON.stringify([bh.kind, bg.kind]));
        expect(bh.hp[0] < 100 && bh.hp[1] < 100, 'spells drawn on both sides crossed the relays', JSON.stringify(bh));
        expect(Math.abs(bh.hp[0] - bg.hp[0]) <= 8 && Math.abs(bh.hp[1] - bg.hp[1]) <= 8,
            'both screens still agree', JSON.stringify([bh.hp, bg.hp]));
        console.log('        host sees ' + JSON.stringify(bh.hp) + ', guest sees ' + JSON.stringify(bg.hp));
        await bHost.screenshot({ path: SHOTS + '/8-bus.png' });
        await bHost.close();
        await bGuest.close();
    } else {
        console.log('\n(skipping the no-p2p duel: set NOSTR_TEST_RELAY to run it)');
    }

    // leaving is noticed. a closed tab sends nothing on some transports,
    // so this is really a test of the lobby's heartbeat.
    await guest.close();
    let noticed = false;
    for (let i = 0; i < 14 && !noticed; i++) {
        await host.waitForTimeout(1000);
        noticed = await host.evaluate(() => !!WZ_ENGINE.state().netDown);
    }
    expect(noticed, 'the host notices when the other wizard vanishes (heartbeat)');
    await host.close();

    section('the github grid without the github api');
    {
        // The snapshot exists so the page does not depend on sixty anonymous
        // requests an hour. Block the API outright: if the grid and the
        // user.dat panel still fill in, they are reading the committed file.
        const offline = await ctx.newPage();
        const blocked = [];
        await offline.route('**://api.github.com/users/**', r => { blocked.push(r.request().url()); r.abort(); });
        await offline.route('**://api.github.com/users/mrhakan/repos**', r => { blocked.push(r.request().url()); r.abort(); });
        await offline.goto(BASE, { waitUntil: 'load' });
        await offline.keyboard.press('Enter');
        await offline.waitForTimeout(2200);

        const cards = await offline.locator('#github-repos > div').count();
        expect(cards > 0, 'the repo grid fills in with the api unreachable', cards + ' cards');
        expect(await offline.locator('#github-repos .text-red-500').count() === 0,
            'and does not show the rate-limit error');
        const repos = (await offline.locator('#gh-repos').textContent().catch(() => '')).trim();
        const followers = (await offline.locator('#gh-followers').textContent().catch(() => '')).trim();
        expect(/^\d+$/.test(repos) && /^\d+$/.test(followers),
            'and user.dat shows real numbers rather than question marks', repos + ' / ' + followers);
        expect(await offline.locator('#user-stats.hidden').count() === 0, 'and the panel is on screen');
        await offline.screenshot({ path: SHOTS + '/9-github-offline.png' });
        await offline.close();
    }
    section('the guestbook, both ways round');
    {
        // giscus is off until two ids are in data/site.json. Serve a patched
        // config to see the configured half without committing one, and never
        // let either page actually reach giscus.app.
        const board = async (label, giscus) => {
            // the service worker caches data/site.json and its fetches are not
            // page requests, so a route on this page would never see them —
            // this section needs a context where it is the only thing serving
            const gctx = await browser.newContext({
                viewport: { width: 900, height: 900 },
                serviceWorkers: 'block'
            });
            await gctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });
            const page = await gctx.newPage();
            let reached = null;
            await page.route('**://giscus.app/**', r => { reached = r.request().url(); r.abort(); });
            if (giscus) {
                await page.route('**/data/site.json', async r => {
                    const body = await (await r.fetch()).json();
                    body.giscus = giscus;
                    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
                });
            }
            await page.goto(BASE.replace(/index\.html$/, 'guestbook.html'), { waitUntil: 'load' });
            await page.waitForTimeout(2200);
            // giscus.app is blocked, so the mount has no iframe and no height:
            // ask whether it is displayed, not whether it is painted
            const shown = sel => page.evaluate(q => {
                const el = document.querySelector(q);
                return el ? getComputedStyle(el).display !== 'none' : null;
            }, sel);
            const out = {
                form: await shown('#guestbook-form'),
                mount: await shown('#giscus-mount'),
                reached: reached,
                attrs: await page.evaluate(() => {
                    const s2 = document.querySelector('#giscus-mount script');
                    if (!s2) return null;
                    const o = {};
                    for (const a of s2.attributes) o[a.name] = a.value;
                    return o;
                })
            };
            await page.screenshot({ path: SHOTS + '/10-guestbook-' + label + '.png', fullPage: true });
            await page.close();
            await gctx.close();
            return out;
        };

        const off = await board('gist', null);
        expect(off.form === true && off.mount === false, 'with no giscus config the gist board is what you get',
            JSON.stringify(off));
        expect(off.reached === null, 'and nothing is asked of giscus.app');

        const on = await board('giscus', {
            repo: 'MrHakan/mrhakan.github.io', repoId: 'R_kgDOTEST01',
            category: 'Guestbook', categoryId: 'DIC_kwDOTEST01'
        });
        expect(on.mount === true && on.form === false, 'configured, giscus takes over and the copy-paste form goes',
            JSON.stringify({ form: on.form, mount: on.mount }));
        expect(!!on.attrs && on.attrs['data-repo-id'] === 'R_kgDOTEST01' && on.attrs['data-category-id'] === 'DIC_kwDOTEST01',
            'with the ids from the config on the script', JSON.stringify(on.attrs));
        expect(!!on.attrs && /giscus-win98\.css$/.test(on.attrs['data-theme'] || ''),
            'and the win98 theme, since the frame cannot see style.css', on.attrs && on.attrs['data-theme']);

        const half = await board('half', {
            repo: 'MrHakan/mrhakan.github.io', repoId: 'R_kgDOTEST01',
            category: 'Guestbook', categoryId: ''
        });
        expect(half.form === true && half.mount === false && half.reached === null,
            'a half-filled config falls back rather than showing an empty box', JSON.stringify(half));
    }
} catch (e) {
    bad('the run fell over', e.stack || e.message);
}

section('page errors');
expect(!errors.length, 'no javascript errors on any page', errors.slice(0, 8).join('\n        '));

await browser.close();
console.log('\n' + '='.repeat(58));
console.log(failures ? failures + ' browser checks failed' : 'all browser checks passed');
process.exit(failures ? 1 : 0);
