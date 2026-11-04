// ===================================================================
// wizardz-play.mjs — how the browser tests hold a mouse
//
// Not a test itself. browser-check, browser-netplay and browser-wizardz all need to
// do what a player does: take the mouse, press E, draw, aim, click. Drawing goes
// through the real mouse, the real ink stance and the real recogniser. Aiming is the
// one thing written into the page, because the alternative is a test that plays a
// shooter by feel. Offsets are css pixels from the middle of the arena.
// ===================================================================

// Headless chromium on linux takes the pointer lock and then reports a synthetic mouse as
// zeros with the odd jump of hundreds of pixels, measured on the CI runners. That is the
// test harness rather than the game, so there the tests play the game's no-lock path:
// hold a button and drag to look, and the pen goes where the mouse is. The locked path is
// still driven on a machine where the mouse tells the truth. WZ_NO_LOCK=1 asks for this
// anywhere, which is how to run what CI runs.
export const MOUSE_LOCK = !process.env.WZ_NO_LOCK && process.platform !== 'linux';
export async function honestMouse(ctx) {
    if (MOUSE_LOCK) return;
    await ctx.addInitScript(() => { Element.prototype.requestPointerLock = undefined; });
}
const size = 90;
// a triangle reads as fireball, a lightning zigzag as spark
export const TRIANGLE = [[[0, -size], [size, size * 0.75], [-size, size * 0.75], [0, -size]]];
export const ZBOLT = [[[size * 0.6, -size], [-size * 0.5, -size * 0.15], [size * 0.5, size * 0.15], [-size * 0.6, size]]];
export const LINE = [[[-size, 0], [size, 0]]];

export const live = p => p.waitForFunction(() => {
    const g = window.WZ_ENGINE && WZ_ENGINE.state();
    return g && g.phase === 'live' ? { bot: g.bot && g.bot.id, hint: g.hint && g.hint.text } : null;
}, null, { timeout: 40000 }).then(h => h.jsonValue());

async function middle(page) {
    const box = await (await page.$('#wz-canvas')).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
// the first click takes the mouse, where the browser allows it
export async function takeMouse(page) {
    const m = await middle(page);
    const already = await page.evaluate(() => !!document.pointerLockElement || !!WZ_ENGINE.state().noLock);
    if (!already) {
        await page.mouse.move(m.x, m.y);
        await page.mouse.click(m.x, m.y);
        await page.waitForTimeout(120);
    }
    await page.evaluate(() => { const g = WZ_ENGINE.state(); g.wantFire = false; });
    return page.evaluate(() => !!document.pointerLockElement);
}
// E, draw, and wait for the ink to be read
export async function inkDraw(page, strokes, opts) {
    const m = await middle(page);
    await page.mouse.move(m.x, m.y);
    await page.keyboard.press('e');
    await page.waitForFunction(() => WZ_ENGINE.state().stance, null, { timeout: 5000 });
    let px = 0, py = 0;
    for (const s of strokes) {
        // with the mouse locked the pen starts in the middle and moves by what the mouse does
        await page.mouse.move(m.x + s[0][0], m.y + s[0][1], { steps: 3 });
        px = s[0][0]; py = s[0][1];
        await page.mouse.down();
        // at the speed a hand goes, rather than all at once
        for (const [x, y] of s.slice(1)) {
            for (let i = 1; i <= 8; i++) {
                await page.mouse.move(m.x + px + (x - px) * i / 8, m.y + py + (y - py) * i / 8);
                await page.waitForTimeout(10);
            }
            px = x; py = y;
        }
        await page.mouse.up();
        await page.waitForTimeout(70);
    }
    if (!opts || !opts.leaveOpen) await page.waitForFunction(() => !WZ_ENGINE.state().strokes.length, null, { timeout: 5000 });
    await page.waitForTimeout(60);
}
// write the crosshair onto them, walked in through the camera the way the game reads it
export function aimAtFoe(page) {
    return page.evaluate(() => {
        const g = WZ_ENGINE.state(), S = WZ_SIM;
        const me = g.wiz[g.me], foe = g.wiz[1 - g.me];
        const p = { x: me.x, y: me.y, z: me.z, yaw: g.yaw, pitch: g.pitch, aim: false };
        for (let k = 0; k < 6; k++) {
            const c = S.camera(g.s, p);
            p.yaw = Math.atan2(foe.x - c.x, -(foe.z - c.z));
            p.pitch = Math.atan2(foe.y + 1 - c.y, Math.hypot(foe.x - c.x, foe.z - c.z));
        }
        g.yaw = p.yaw; g.pitch = p.pitch;
        return [p.yaw, p.pitch];
    });
}
export async function shoot(page, times = 1) {
    await takeMouse(page);
    const m = await middle(page);
    for (let i = 0; i < times; i++) {
        await aimAtFoe(page);
        await page.mouse.down();
        await page.waitForTimeout(90);
        await page.mouse.up();
        await page.waitForTimeout(450);
    }
    return m;
}
// the host puts the two of them on a clear strip of floor, a few metres apart
export async function faceOff(host, guests = [], d = 9) {
    await host.evaluate(d => {
        const g = WZ_ENGINE.state();
        const [a, b] = g.wiz;
        a.x = 11; a.z = -8; a.y = 0; b.x = 11; b.z = -8 - d; b.y = 0;
        a.safe = b.safe = 0;
    }, d);
    await host.waitForTimeout(500);
    for (const p of guests) await p.waitForFunction(d => {
        const g = WZ_ENGINE.state(), a = g.wiz[0], b = g.wiz[1];
        return Math.abs(a.z - b.z) < d + 3 && Math.abs(a.x - b.x) < 3;
    }, d, { timeout: 15000 }).catch(() => { });
    await host.waitForTimeout(300);
}
export const hpOf = p => p.evaluate(() => WZ_ENGINE.state().wiz.map(w => Math.round(w.hp)));
