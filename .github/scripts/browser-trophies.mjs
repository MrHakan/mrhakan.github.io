// ===================================================================
// browser-trophies.mjs — the trophy room, the install, and the cable out
//
//   node .github/scripts/browser-trophies.mjs
//
// The trophy room is opened the way a person opens it, a game hands out
// an achievement and the room is checked for it, and then the room is
// opened on an empty browser and on one whose saves are all broken.
//
// The install half asks Chrome itself what it thinks of the manifest
// (the same question Lighthouse asks), and then the cable comes out:
// a visitor who has been here once reloads with no network, and every
// game is opened to see which of them still work.
//
// It brings its own server on localhost, because a service worker only
// registers on https or localhost, and nothing leaves the machine.
// ===================================================================
import * as playwright from 'playwright';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.TROPHY_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, { recursive: true });

let checks = 0, failures = 0;
const expect = (cond, msg, detail) => {
    checks++;
    if (cond) console.log('  ok    ' + msg + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : ''));
    else { failures++; console.log('  FAIL  ' + msg + (detail !== undefined ? '\n        ' + detail : '')); }
};
const section = n => console.log('\n== ' + n + ' ==');

// ---------- a server that answers the way github pages does ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'text/xml',
    '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(ROOT, clean);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(ROOT, '404.html'))); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, 'localhost', r));
const BASE = 'http://localhost:' + server.address().port;

const browser = await playwright.chromium.launch();
const errors = [];

// komarev's counter, waust.at, fonts and every other server: refused, so a
// test run is never a visit
async function context(options = {}, { sw = false, welcomed = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: sw ? 'allow' : 'block', ...options });
    await ctx.route('**/*', route => {
        const u = route.request().url();
        return u.startsWith(BASE) && !/komarev\.com|waust\.at/.test(u) ? route.continue() : route.abort();
    });
    if (welcomed) await ctx.addInitScript(() => {
        try { sessionStorage.setItem('welcomed', '1'); sessionStorage.setItem('booted', '1'); } catch (e) { }
    });
    return ctx;
}
async function open(ctx, url = '/', { storage } = {}) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(url + ': ' + e.message));
    p.on('dialog', d => d.dismiss());
    if (storage) {
        await p.goto(BASE + '/robots.txt');
        await p.evaluate(s => { localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }, storage);
    }
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.evaluate(() => {
        const boot = document.getElementById('boot-screen');
        if (boot) boot.remove();
        window.soundEnabled = false;
    });
    await p.waitForTimeout(200);
    return p;
}
const room = p => p.evaluate(() => {
    const r = document.querySelector('.app-window .tr-room');
    if (!r) return null;
    const win = r.closest('.app-window');
    return {
        line: (r.querySelector('.tr-line') || {}).textContent || '',
        status: (r.querySelector('.tr-status') || {}).textContent || '',
        tab: (r.querySelector('.tr-tab.on') || {}).textContent || '',
        shelves: [...r.querySelectorAll('.tr-shelf')].map(s => ({
            id: s.dataset.shelf, count: s.querySelector('.tr-shelf-count').textContent,
            got: [...s.querySelectorAll('.tr-plaque.got')].map(b => b.dataset.id),
            recs: s.querySelector('.tr-recs').textContent.replace(/\s+/g, ' ').trim()
        })),
        rows: [...r.querySelectorAll('.tr-row')].map(x => ({ id: x.dataset.id, got: x.classList.contains('got'), text: x.textContent.replace(/\s+/g, ' ').trim() })),
        table: [...r.querySelectorAll('.tr-table tbody tr')].map(x => x.textContent.replace(/\s+/g, ' ').trim()),
        styled: getComputedStyle(r.querySelector('.tr-case') || r).backgroundImage.includes('gradient'),
        width: win.getBoundingClientRect().width, right: win.getBoundingClientRect().right,
        scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
});
const waitRoom = p => p.waitForFunction(() => {
    const r = document.querySelector('.app-window .tr-room .tr-case, .app-window .tr-room .tr-list, .app-window .tr-room .tr-table, .app-window .tr-room .tr-none');
    return !!r && getComputedStyle(document.querySelector('.tr-room')).fontFamily.includes('Tahoma');
}, null, { timeout: 15000 });

// ===================================================================
section('the trophy room opens from the desktop');
// ===================================================================
{
    const ctx = await context();
    const p = await open(ctx);
    const before = await p.evaluate(() => performance.getEntriesByType('resource').some(e => /trophies\.(js|css)/.test(e.name)));
    expect(!before, 'nothing of it is downloaded until it is asked for');
    // the desktop icon, clicked like a person clicks it
    await p.click('#desk-sidebar nav button:has-text("trophy room")');
    await waitRoom(p);
    await p.waitForTimeout(600);
    let r = await room(p);
    expect(!!r, 'the desktop icon opens it');
    expect(r && r.styled, 'with its own stylesheet, loaded with it');
    expect(r && /of \d+/.test(r.line) && r.shelves.length >= 5, 'a total and the shelves', r && r.line);
    expect(await p.evaluate(() => /[?&]app=trophies/.test(location.search)), 'and the address bar says ?app=trophies');
    const toast = await p.evaluate(() => (document.querySelector('.achv-toast .achv-name') || {}).textContent);
    expect(toast === 'curator', 'opening it for the first time is an achievement of its own', toast);
    await p.screenshot({ path: SHOTS + '/trophy-01-first-visit.png' });

    // from the start menu, it comes forward instead of opening twice
    await p.evaluate(() => toggleStartMenu(new MouseEvent('click')));
    await p.click('#start-menu .start-sub:has(.has-sub:has-text("games")) .has-sub');
    await p.click('#start-menu button:has-text("trophy room")');
    await p.waitForTimeout(300);
    expect(await p.evaluate(() => document.querySelectorAll('.app-window .tr-room').length) === 1, 'the start menu entry brings the same room forward');

    // a game hands one out: dungeonz, from its own menu
    await p.evaluate(() => startMenuAction('dungeonz'));
    await p.waitForFunction(() => !!document.querySelector('.dz-dungeons'), null, { timeout: 30000 });
    await p.waitForTimeout(400);
    const dz = await p.evaluate(() => (getUnlocked() || {}).dungeonz > 0);
    expect(dz, 'opening dungeonz 98 unlocks torchbearer');
    const dzToast = await p.evaluate(() => ([...document.querySelectorAll('.achv-toast .achv-name')].pop() || {}).textContent);
    expect(dzToast === 'torchbearer', 'and says so in a toast', dzToast);
    // the toast takes you to the room
    await p.evaluate(() => document.querySelectorAll('.achv-toast').forEach((t, i, all) => i < all.length - 1 && t.remove()));
    await p.click('.achv-toast');
    await p.waitForTimeout(400);
    r = await room(p);
    const dzShelf = r && r.shelves.find(s => s.id === 'dungeonz');
    expect(!!dzShelf && dzShelf.got.includes('dungeonz') && /^1 \/ 2$/.test(dzShelf.count), 'clicking the toast opens the room, with the trophy on the dungeonz shelf', dzShelf && dzShelf.count);
    // close the raid window so the clock banks its time
    await p.evaluate(() => { const w = [...document.querySelectorAll('.app-window')].find(x => /dungeonz/.test(x.querySelector('.app-window-title').textContent)); if (w) closeAppWindow(w.id); });
    await p.waitForTimeout(600);
    const pt = await p.evaluate(() => JSON.parse(localStorage.getItem('mrhakan98-playtime') || '{}'));
    expect((pt['dungeonz 98'] || 0) >= 1, 'and the time in it is on the clock', JSON.stringify(pt));

    // a plaque says what it is when clicked
    await p.click('.tr-shelf[data-shelf="dungeonz"] .tr-plaque[data-id="dungeonz_win"]');
    r = await room(p);
    expect(/🔒 dungeon cleared — hint:/.test(r.status), 'a locked plaque gives its hint in the status bar', r.status);

    // every achievement, filtered to the locked ones
    await p.click('.tr-tab[data-tab="all"]');
    await p.click('.tr-filter input[value="locked"]');
    r = await room(p);
    expect(r.rows.length > 50 && r.rows.every(x => !x.got) && r.rows.every(x => /hint:/.test(x.text)), 'the locked list has a hint on every row', r.rows.length + ' rows');
    const secret = r.rows.find(x => x.id === 'hacker');
    expect(!!secret && !/passwords\.txt/.test(secret.text), 'and a secret one does not give itself away', secret && secret.text);
    await p.screenshot({ path: SHOTS + '/trophy-02-locked.png' });

    // records, after a few games
    await p.evaluate(() => {
        localStorage.setItem('snake-best', '17');
        localStorage.setItem('lights-out-98-best', '11');
        localStorage.setItem('mrhakan98-ageoftroll-meta', JSON.stringify({ wins: 2, losses: 3 }));
    });
    await p.click('.tr-tab[data-tab="records"]');
    await p.waitForTimeout(300);
    r = await room(p);
    expect(r.table.some(t => /arcade.*snake 17/.test(t)) && r.table.some(t => /age of troll.*won 2/.test(t)), 'the records tab reads the games\' own saves', r.table.slice(0, 3).join(' | '));
    expect(r.table.some(t => /lights out.*best 11/.test(t)), 'a playground game too');
    await p.screenshot({ path: SHOTS + '/trophy-03-records.png' });

    // a playground record in another tab: the room is checked when this one comes back
    await p.evaluate(() => { localStorage.setItem('binary-bloom-2026-11-06', '90'); window.dispatchEvent(new StorageEvent('storage', { key: 'binary-bloom-2026-11-06' })); window.dispatchEvent(new Event('focus')); });
    await p.waitForFunction(() => !!getUnlocked().playground, null, { timeout: 5000 }).catch(() => { });
    expect(await p.evaluate(() => !!getUnlocked().playground), 'a record kept in a playground tab earns "on the board" back on the desktop');

    // share: a picture, made here
    await p.click('.tr-tab[data-tab="shelves"]');
    await p.click('.tr-room [data-act="share"]');
    await p.waitForSelector('.retro-dialog .tr-share img');
    const img = await p.evaluate(() => { const i = document.querySelector('.tr-share img'); return { w: i.naturalWidth, h: i.naturalHeight, png: i.src.startsWith('data:image/png') }; });
    expect(img.png && img.w === 1200 && img.h === 630, 'share makes a 1200x630 picture of the shelf', img.w + 'x' + img.h);
    await p.screenshot({ path: SHOTS + '/trophy-04-share.png' });
    const card = await p.evaluate(() => document.querySelector('.tr-share img').src);
    fs.writeFileSync(SHOTS + '/trophy-card.png', Buffer.from(card.split(',')[1], 'base64'));
    const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await p.click('.retro-dialog-btn:has-text("save picture")');
    const file = await dl;
    expect(!!file && file.suggestedFilename() === 'mrhakan98-trophies.png', 'and "save picture" downloads it', file && file.suggestedFilename());
    await p.evaluate(() => document.querySelectorAll('.retro-dialog-overlay').forEach(o => o.remove()));
    await p.screenshot({ path: SHOTS + '/trophy-05-shelves.png' });
    await ctx.close();
}

// ===================================================================
section('an empty browser, a broken one, and a phone');
// ===================================================================
{
    const ctx = await context();
    const p = await open(ctx, '/?app=trophies', { storage: {} });
    await waitRoom(p);
    const r = await room(p);
    expect(!!r && /^0 of \d+|^1 of \d+/.test(r.line.trim()), 'an empty browser opens straight to the room from ?app=trophies', r && r.line);
    await ctx.close();
}
{
    const broken = {
        achievements: '{"konami":', 'mrhakan98-playtime': '[1,2', 'mrhakan98-dungeonz-meta': '"a string"',
        ECHOES_OF_THE_TIDE_SAVE: '{"player":null}', 'jokerz98-run': 'null', 'trollproblem-meta-v2': '{"bestWave":"lots"}',
        'becomeuser-meta-v1': '{"endings":7}', 'mrhakan98-ageoftroll-meta': '[]', 'snake-best': 'NaN', 'lights-out-98-best': '{'
    };
    const ctx = await context();
    const before = errors.length;
    const p = await open(ctx, '/', { storage: broken });
    await p.evaluate(() => startMenuAction('trophies'));
    await waitRoom(p);
    for (const t of ['all', 'records', 'shelves']) await p.click('.tr-tab[data-tab="' + t + '"]');
    const r = await room(p);
    expect(!!r && r.shelves.length >= 3 && errors.length === before, 'every save broken: it still opens, on every tab, with no errors', errors.slice(before).join(' | '));
    expect(!/NaN|undefined|\[object/.test(r.line + JSON.stringify(r.shelves)), 'and shows nothing made of the junk');
    const kept = await p.evaluate(keys => keys.filter(k => k !== 'achievements').every(k => localStorage.getItem(k) !== null), Object.keys(broken));
    const same = await p.evaluate(b => Object.keys(b).filter(k => k !== 'achievements' && k !== 'mrhakan98-playtime').every(k => localStorage.getItem(k) === b[k]), broken);
    expect(kept && same, 'and every save it could not read is left exactly as it was');
    await ctx.close();
}
{
    const ctx = await context({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await open(ctx, '/?app=trophies', { storage: { achievements: JSON.stringify({ konami: Date.now(), snake10: Date.now(), 'aot-win': Date.now(), dungeonz: Date.now() }), 'snake-best': '12' } });
    await waitRoom(p);
    const r = await room(p);
    expect(!!r && r.right <= 376 && r.scrollX <= 0, 'on a phone it fits the screen', r && Math.round(r.right) + 'px');
    await p.screenshot({ path: SHOTS + '/trophy-06-phone.png' });
    await ctx.close();
}

// ===================================================================
section('the install button');
// ===================================================================
{
    const ctx = await context();
    const p = await open(ctx);
    const hidden = await p.evaluate(() => [...document.querySelectorAll('.install-entry')].every(e => e.classList.contains('hidden')));
    expect(hidden, 'there is no install button until the browser offers one');
    // what chrome does when the site qualifies, with a prompt that records being asked
    await p.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        e.prompt = () => { window.__prompted = true; return Promise.resolve(); };
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
        window.__defaultPrevented = e.defaultPrevented;
    });
    const shown = await p.evaluate(() => [...document.querySelectorAll('.install-entry')].map(e => getComputedStyle(e).display !== 'none'));
    expect(shown.length === 2 && shown.every(Boolean), 'when it does: one in the start menu, one in the tray');
    expect(await p.evaluate(() => window.__defaultPrevented), 'and the browser\'s own mini bar is held back for it');
    await p.screenshot({ path: SHOTS + '/install-01-tray.png', clip: { x: 1040, y: 820, width: 240, height: 40 } });
    await p.evaluate(() => toggleStartMenu(new MouseEvent('click')));
    await p.waitForTimeout(150);
    await p.screenshot({ path: SHOTS + '/install-02-start-menu.png', clip: { x: 0, y: 300, width: 300, height: 520 } });
    await p.click('#start-menu .install-entry');
    expect(await p.evaluate(() => window.__prompted === true), 'install mrhakan 98 asks the browser to install it');
    await p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await p.waitForTimeout(200);
    expect(await p.evaluate(() => !!getUnlocked().installed && [...document.querySelectorAll('.install-entry')].every(e => e.classList.contains('hidden'))),
        'once installed the buttons go, and "setup complete" is earned');
    await ctx.close();
}
{
    const iphone = playwright.devices['iPhone 13'];
    const ctx = await context({ ...iphone });
    const p = await open(ctx);
    const shown = await p.evaluate(() => getComputedStyle(document.querySelector('#start-menu .install-entry')).display !== 'none');
    expect(shown, 'an iphone, which never offers, still gets the start menu entry');
    await p.evaluate(() => installSite());
    const text = await p.evaluate(() => (document.querySelector('.retro-dialog') || {}).textContent || '');
    expect(/share/.test(text) && /add to home screen/.test(text), 'which explains share, then add to home screen');
    await p.screenshot({ path: SHOTS + '/install-03-iphone.png' });
    await ctx.close();
}
{
    const ctx = await context();
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
    const p = await open(ctx);
    await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { }; window.dispatchEvent(e); });
    const any = await p.evaluate(() => [...document.querySelectorAll('.install-entry')].some(e => !e.classList.contains('hidden')));
    expect(!any, 'inside the installed copy there is nothing to install');
    await ctx.close();
}

// ===================================================================
section('what chrome says about installing it');
// ===================================================================
let cdpReport = null;
{
    const ctx = await context({}, { sw: true });
    const p = await open(ctx);
    await p.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await ctx.newCDPSession(p);
    const manifest = await cdp.send('Page.getAppManifest');
    const installability = await cdp.send('Page.getInstallabilityErrors');
    let icons = null;
    try { icons = await cdp.send('Page.getManifestIcons'); } catch (e) { }
    cdpReport = { url: manifest.url, errors: manifest.errors, installability: installability.installabilityErrors, primaryIcon: !!(icons && icons.primaryIcon) };
    expect(/site\.webmanifest$/.test(manifest.url) && !manifest.errors.length, 'chrome reads the manifest with no errors', manifest.errors.map(e => e.message).join(', '));
    expect(!installability.installabilityErrors.length, 'and has no reason not to install it',
        installability.installabilityErrors.map(e => e.errorId + ' ' + JSON.stringify(e.errorArguments)).join(', '));
    console.log('        primary icon chosen by chrome: ' + (icons && icons.primaryIcon ? 'yes' : 'not reported (headless does not run the install manager)'));
    fs.writeFileSync(SHOTS + '/installability.json', JSON.stringify(cdpReport, null, 2));
    await ctx.close();
}

// ===================================================================
section('the cable out');
// ===================================================================
const offline = {};
{
    const ctx = await context({}, { sw: true });
    const p = await open(ctx);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload({ waitUntil: 'load' });
    await p.evaluate(() => { const b = document.getElementById('boot-screen'); if (b) b.remove(); window.soundEnabled = false; });
    // what js/lazy.js asks for after fifteen seconds, asked for now
    const later = await p.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        reg.active.postMessage('warm');
        const src = await fetch('/sw.js').then(r => r.text());
        const list = [...(/const PRECACHE_LATER = \[([\s\S]*?)\];/.exec(src) || ['', ''])[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
        const t0 = Date.now();
        while (Date.now() - t0 < 60000) {
            const keys = await caches.keys();
            const cache = await caches.open(keys.find(k => k.startsWith('mrhakan98-v')));
            const have = await Promise.all(list.map(u => cache.match(u)));
            if (have.every(Boolean)) return { all: true, n: list.length };
            await new Promise(r => setTimeout(r, 500));
        }
        return { all: false };
    });
    expect(later.all, 'a visitor who stayed has every on-demand file kept (' + later.n + ')');
    // and one playground game they played
    const pg = await ctx.newPage();
    await pg.goto(BASE + '/games/lights-out/', { waitUntil: 'load' });
    await pg.close();

    await ctx.setOffline(true);
    await p.reload({ waitUntil: 'load' }).catch(() => { });
    await p.evaluate(() => { const b = document.getElementById('boot-screen'); if (b) b.remove(); window.soundEnabled = false; });
    await p.waitForTimeout(500);
    const desk = await p.evaluate(() => ({ online: navigator.onLine, taskbar: !!document.querySelector('#taskbar'), start: typeof startMenuAction === 'function', trophies: document.querySelectorAll('.tr-room').length }));
    expect(!desk.online && desk.taskbar && desk.start, 'with no network the desktop boots');
    offline.desktop = desk.taskbar && desk.start;

    // every window that loads on demand, opened with the cable out
    // a window that is not a loading placeholder and does not say it failed;
    // the ones whose insides are known are held to those too
    const GAMES = [
        ['trophies', '.tr-case'], ['documents', '.docs-list'], ['tetris', 'canvas'], ['pet', null], ['defrag', null],
        ['jokerz', null], ['trollproblem', null], ['becomeuser', null], ['echoes', null],
        ['wizardzbot', null], ['dungeonz', '.dz-dungeons'], ['ageoftroll', null], ['trailz', '.tz-menu'], ['blastz', '.bz-menu'], ['thememaker', null]
    ];
    for (const [app, sel] of GAMES) {
        const res = await p.evaluate(async ([app, sel]) => {
            const before = new Set(document.querySelectorAll('.app-window'));
            startMenuAction(app);
            const t0 = Date.now();
            while (Date.now() - t0 < 12000) {
                await new Promise(r => setTimeout(r, 250));
                const fresh = [...document.querySelectorAll('.app-window')].filter(w => !before.has(w) && w.id);
                const failed = fresh.find(w => /offline, and this one|could not load|took the charts|would not open|got lost/.test(w.textContent));
                if (failed) return { ok: false, why: failed.textContent.trim().slice(0, 90) };
                const loading = fresh.some(w => w.querySelector('.bj-loading'));
                if (!loading && fresh.some(w => !sel || w.querySelector(sel))) { await new Promise(r => setTimeout(r, 700)); const bad = [...document.querySelectorAll('.app-window')].find(w => /offline, and this one|could not load/.test(w.textContent)); return bad ? { ok: false, why: bad.textContent.trim().slice(0, 90) } : { ok: true }; }
            }
            const t = document.querySelector('.retro-toast');
            return { ok: false, why: t ? t.textContent : 'nothing after 12s' };
        }, [app, sel]);
        offline[app] = res.ok;
        expect(res.ok, app + ' opens offline', res.why);
        // close what it opened so the next one is easy to tell apart
        await p.evaluate(() => document.querySelectorAll('.app-window').forEach(w => w.id && closeAppWindow(w.id)));
        await p.waitForTimeout(250);
    }

    // the multiplayer lobby: it opens, and refuses to wait for a network that is not there
    await p.evaluate(() => startMenuAction('netplay'));
    await p.waitForSelector('#np-host', { timeout: 12000 }).catch(() => { });
    const hasLobby = await p.evaluate(() => !!document.querySelector('#np-host'));
    let said = '';
    if (hasLobby) {
        await p.click('#np-host');
        await p.waitForTimeout(800);
        said = await p.evaluate(() => document.querySelector('.app-window-body').textContent);
    }
    offline.netplay = hasLobby && /offline bradar/.test(said);
    expect(hasLobby && /you are offline bradar/.test(said) && /bots/.test(said), 'the lobby says online play needs the internet, at once', said.match(/failed:[^.]*/) ? said.match(/failed:[^.]*/)[0] : said.slice(0, 80));
    await p.screenshot({ path: SHOTS + '/offline-01-lobby.png' });

    // a playground game that was played once, and one that never was
    const played = await ctx.newPage();
    const ok = await played.goto(BASE + '/games/lights-out/', { waitUntil: 'load' }).then(r => r && r.ok()).catch(() => false);
    const title = await played.title().catch(() => '');
    offline.playgroundVisited = !!ok && /light/i.test(title);
    expect(offline.playgroundVisited, 'a playground game somebody played once opens offline', title);
    const never = await played.goto(BASE + '/games/word-ladder/', { waitUntil: 'load' }).then(r => r && r.status()).catch(() => 0);
    const neverTitle = await played.title().catch(() => '');
    offline.playgroundUnvisited = /ladder/i.test(neverTitle);
    console.log('        a playground game never opened online falls back to the desktop: ' + never + ' "' + neverTitle + '"');
    await played.close();
    await ctx.close();
}

fs.writeFileSync(SHOTS + '/offline.json', JSON.stringify(offline, null, 2));
console.log('\n        offline: ' + Object.entries(offline).map(([k, v]) => k + (v ? ' yes' : ' NO')).join(', '));
expect(!errors.length, 'no page errors on the way', errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
