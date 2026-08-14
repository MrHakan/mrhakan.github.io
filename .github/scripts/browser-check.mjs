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
const errors = [];

async function boot(tag) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(tag + ': ' + e.message));
    p.on('console', m => {
        const t = m.text();
        // the cdn bits (tailwind, google fonts) are not part of this test
        if (m.type() === 'error' && !/ERR_|404|504|Failed to load resource/.test(t)) errors.push(tag + ' console: ' + t);
    });
    await p.goto(BASE, { waitUntil: 'load' });
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
} catch (e) {
    bad('the run fell over', e.stack || e.message);
}

section('page errors');
expect(!errors.length, 'no javascript errors on any page', errors.slice(0, 8).join('\n        '));

await browser.close();
console.log('\n' + '='.repeat(58));
console.log(failures ? failures + ' browser checks failed' : 'all browser checks passed');
process.exit(failures ? 1 : 0);
