// ===================================================================
// browser-echoes.mjs — play "echoes of the tide" in a real browser
//
// check-echoes.mjs proves the rules are sound with no DOM in the room.
// This one proves the game is playable: boot the desktop, open the RPG,
// roll a character, sail, fight whatever is in the corridor, put a line
// in the water, and take something off the anvil — clicking real
// buttons the whole way, and failing on the first JavaScript error.
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

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
// the welcome popup evicts whatever dialog is on screen 1.4s after boot
await ctx.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) { } });
const errors = [];

const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !/ERR_|404|504|Failed to load resource/.test(t)) errors.push('console: ' + t);
});

// click a button in the game window by its visible text
async function click(text, opts) {
    const o = opts || {};
    const btn = page.locator('.et-body button', { hasText: text }).first();
    await btn.waitFor({ timeout: o.timeout || 8000 });
    await btn.click();
    await page.waitForTimeout(o.wait || 260);
}
const has = async text => (await page.locator('.et-body', { hasText: text }).count()) > 0;
const state = () => page.evaluate(() => {
    const raw = localStorage.getItem('ECHOES_OF_THE_TIDE_SAVE');
    return raw ? JSON.parse(raw) : null;
});

try {
    section('the game opens');
    await page.goto(BASE, { waitUntil: 'load' });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.soundEnabled = false; localStorage.removeItem('ECHOES_OF_THE_TIDE_SAVE'); localStorage.removeItem('ECHOES_OF_THE_TIDE_SAVE_BACKUP'); });
    await page.evaluate(() => window.openEchoes());
    await page.waitForSelector('.et-body', { timeout: 15000 });
    ok('the window opens and the game files load');
    expect(await has('echoes of the tide'), 'the character sheet is on screen');
    expect(await page.locator('#et-seed').count() === 1, 'it asks for a seed');
    await page.screenshot({ path: SHOTS + '/echoes-1-create.png' });

    section('rolling a character');
    await page.fill('#et-name', 'ci dredger');
    await page.fill('#et-seed', '20260823');
    // spend the three free points on Might
    for (let i = 0; i < 3; i++) {
        await page.locator('.et-stats button[data-a="cre+"][data-x="might"]').first().click();
        await page.waitForTimeout(90);
    }
    const spent = await page.locator('.et-main', { hasText: '2 of 5 free points left' }).count();
    expect(spent > 0, 'the free attribute points are spendable');
    // spending a point re-renders the sheet; the typed name must survive it
    expect(await page.inputValue('#et-name') === 'ci dredger' && await page.inputValue('#et-seed') === '20260823',
        'and spending them does not wipe the name and seed you typed');
    await click('take the boat out', { wait: 900 });
    expect(await has('The Rust Shallows'), 'the run starts in the Rust Shallows');
    expect(await has('Act 1'), 'act one is on the board');
    const s0 = await state();
    expect(s0 && s0.save_version && s0.checksum, 'it saved immediately, with a version and a checksum');
    expect(s0 && s0.nemesis_roster && s0.nemesis_roster.length === 17, 'the admiralty of 17 was born', s0 && s0.nemesis_roster ? String(s0.nemesis_roster.length) : 'no roster');
    await page.screenshot({ path: SHOTS + '/echoes-2-harbour.png' });

    section('the drowned lords are on the wall');
    await click('the full roster');
    expect(await has('Deck Captain'), 'the roster screen renders');
    const lordRows = await page.locator('.et-nem-full').count();
    expect(lordRows === 17, 'seventeen lords listed', String(lordRows));
    expect(await has('"'), 'each one has a war-cry');
    await page.screenshot({ path: SHOTS + '/echoes-3-lords.png' });
    await click('back');

    section('a voyage, and whatever is in the corridor');
    await click('take a voyage', { wait: 500 });
    expect(await has('floor 1 /'), 'the dungeon deals a node');
    let fought = false, nodes = 0;
    while (nodes++ < 14 && !fought) {
        if (await page.locator('.et-body button', { hasText: 'strike' }).count()) { fought = true; break; }
        const take = page.locator('.et-body button[data-a="node"]').first();
        if (!await take.count()) break;
        await take.click();
        await page.waitForTimeout(420);
    }
    expect(fought, 'a voyage runs into a fight within fourteen nodes');
    if (fought) {
        await page.screenshot({ path: SHOTS + '/echoes-4-fight.png' });
        const foe = await page.locator('.et-foe-name').first().textContent();
        let rounds = 0;
        while (rounds++ < 40) {
            const strike = page.locator('.et-body button', { hasText: 'strike' }).first();
            if (!await strike.count() || await strike.isDisabled()) break;
            await strike.click();
            await page.waitForTimeout(150);
        }
        const over = await page.locator('.et-body button[data-a="fight-done"]').count();
        expect(over > 0, 'the fight resolves one way or the other', 'foe was ' + foe);
        expect(rounds < 40, 'and it resolves in under forty rounds', String(rounds));
        const done = page.locator('.et-body button[data-a="fight-done"]').first();
        console.log('        outcome: ' + (await done.textContent().catch(() => '?')));
        await done.click();
        await page.waitForTimeout(450);
    }
    // back out to the harbour whichever screen we landed on
    if (await page.locator('.et-body button[data-a="leave"]').count()) await click('put back in to harbour', { wait: 400 });
    expect(await has('take a voyage'), 'and you get back to the harbour');

    section('the deep-forge');
    await click('the deep-forge');
    expect(await has('Rig Hook'), 'the pattern list shows what you can afford');
    await page.locator('.et-pattern[data-a="forge"]').first().click();
    await page.waitForTimeout(400);
    expect(await page.locator('#et-canvas').count() === 1, 'the heat & quench minigame is on a canvas');
    await page.screenshot({ path: SHOTS + '/echoes-5-forge.png' });
    // heat, then three strikes
    for (let i = 0; i < 5; i++) {
        const hit = page.locator('.et-body button[data-a="forge-hit"]').first();
        if (!await hit.count()) break;
        await page.waitForTimeout(500);
        await hit.click();
        await page.waitForTimeout(220);
    }
    expect(await has('put it on') || await has('forge again'), 'something comes off the anvil');
    const forged = await page.locator('.et-item b').first().textContent();
    console.log('        forged: ' + forged);
    await click('put it on', { wait: 300 });
    expect(await has('take a voyage'), 'and putting it on returns you to the harbour');

    section('a line in the water');
    {
        await click('put a line in', { wait: 500 });
        // pick the first castable spot for the current tide
        const spot = page.locator('.et-pattern[data-a="cast"]').first();
        if (await spot.count()) { await spot.click(); await page.waitForTimeout(600); }
        if (await page.locator('.et-body button[data-a="reel"]').count()) {
            expect(true, 'the dredging minigame opens');
            await page.screenshot({ path: SHOTS + '/echoes-6-dredge.png' });
            // hold the line until something happens
            const reel = page.locator('.et-body button[data-a="reel"]').first();
            const box = await reel.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            for (let i = 0; i < 200 && await page.locator('.et-body button[data-a="reel"]').count(); i++) {
                await page.waitForTimeout(250);
            }
            await page.mouse.up();
            await page.waitForTimeout(500);
            // landed, snapped, escaped, or it was fishing back and is now a fight
            const resolved = await has('take a voyage') || await page.locator('.et-body button[data-a="act:strike"]').count() > 0;
            expect(resolved, 'and the line resolves — landed, snapped, or it turned into a fight');
        } else {
            expect(await has('nothing is biting'), 'nothing was biting, which is a legal outcome');
        }
    }

    section('it survives a reload');
    const before = await state();
    await page.reload({ waitUntil: 'load' });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await page.evaluate(() => window.openEchoes());
    await page.waitForSelector('.et-body', { timeout: 15000 });
    expect(await has('ci dredger'), 'the character comes back after a reload');
    expect(await has('The Rust Shallows'), 'in the realm they were left in');
    const after = await state();
    expect(before && after && before.player.seed === after.player.seed, 'and on the same seed');
    await page.screenshot({ path: SHOTS + '/echoes-7-reloaded.png' });

    section('the codex and the skill trees render');
    await click('skills');
    expect(await has('Marrow-Smith') && await has('Tide-Weaver') && await has('Harpooner'),
        'all three trees are on the page');
    await click('back');
    await click('codex');
    expect(await has('The Great Submersion'), 'the codex has its first entry');
    await click('back');
    await click('chart');
    expect(await has('The Whispering Reefs'), 'the chart shows the realms you cannot reach yet');
    await click('back');
} catch (e) {
    bad('the run fell over', e.stack || e.message);
    await page.screenshot({ path: SHOTS + '/echoes-crash.png' }).catch(() => { });
}

section('page errors');
expect(!errors.length, 'no javascript errors while playing', errors.slice(0, 8).join('\n        '));

await browser.close();
console.log('\n' + '='.repeat(58));
console.log(failures ? failures + ' browser checks failed' : 'all echoes browser checks passed');
process.exit(failures ? 1 : 0);
