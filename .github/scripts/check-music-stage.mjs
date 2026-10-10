import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = fs.readFileSync('js/music-stage.js', 'utf8');
const scenesSource = fs.readFileSync('js/music-scenes.js', 'utf8');
const tracks = JSON.parse(fs.readFileSync('src/music/music.json', 'utf8'));
let checks = 0;
function test(name, run) { run(); checks++; console.log('  ok    ' + name); }

function setup(noCanvas = false, withMotion = false) {
    const frames = new Map(), events = {}, mediaEvents = {}, variables = new Map();
    const drawingCommands = [], reveals = new Set();
    let sequence = 0, observer, draws = 0, enabled = true, slowDevice = false;
    const drawing = new Proxy({}, {
        get: (_, key) => /^create.*Gradient$/.test(key) ? (...args) => {
            drawingCommands.push([key, ...args]);
            return { addColorStop(...stops) { drawingCommands.push(['colorStop', ...stops]); } };
        } :
            (...args) => { if (key === 'clearRect') draws++; drawingCommands.push([key, ...args]); },
        set: (_, key, value) => { drawingCommands.push([key, value]); return true; }
    });
    function element() {
        const classes = new Set(), styles = new Map(), selectors = new Map();
        return {
            hidden: false, textContent: '', dataset: {}, children: [], attributes: {}, isConnected: true,
            classList: {
                add: (...names) => names.forEach(n => classes.add(n)),
                contains: n => classes.has(n),
                toggle(n, on) { if (on) classes.add(n); else classes.delete(n); }
            },
            style: {
                setProperty: (name, value) => styles.set(name, value),
                getPropertyValue: name => styles.get(name) || '',
                removeProperty: name => styles.delete(name)
            },
            appendChild(child) { this.children.push(child); },
            replaceChildren(...children) { this.children = children; },
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, callback) { this['on' + name] = callback; },
            getContext: () => noCanvas ? null : drawing,
            querySelector(selector) {
                if (!selectors.has(selector)) selectors.set(selector, element());
                return selectors.get(selector);
            },
            querySelectorAll() { return this.querySelector('.music-stage-title').children; },
            focus() { doc.activeElement = this; }
        };
    }
    const body = element(), root = element(), audio = element(), button = element();
    root.clientWidth = 1280;
    root.style.setProperty = (name, value) => variables.set(name, value);
    audio.paused = true; audio.ended = false; audio.currentTime = 0;
    audio.addEventListener = (name, callback) => mediaEvents[name] = callback;
    const doc = {
        body, documentElement: root, readyState: 'complete', hidden: false, activeElement: button,
        getElementById: id => id === 'audio-player' ? audio : id === 'winamp-concert' ? button : null,
        createElement: () => element(),
        addEventListener: (name, callback) => events[name] = callback
    };
    const FX = { on: () => enabled, slow: () => slowDevice };
    const win = { FX, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, addEventListener: (name, fn) => events[name] = fn };
    if (withMotion) win.Motion = {
        stagger: () => 0,
        animate() { const control = { cancel() { reveals.delete(control); } }; reveals.add(control); return control; }
    };
    const context = vm.createContext({
        window: win, document: doc, FX,
        requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        MutationObserver: class { constructor(fn) { observer = fn; } observe() {} }
    });
    vm.runInContext(scenesSource, context);
    vm.runInContext(source, context);
    const hud = body.children[0], container = element();
    return {
        stage: win.MusicStage, container, audio, button, hud, doc, events, frames, variables,
        drawingCommands, reveals, scenes: win.MusicScenes,
        get draws() { return draws; },
        mount: song => win.MusicStage.mount(container, song),
        play() { audio.paused = false; mediaEvents.play(); },
        pause() { audio.paused = true; audio.currentTime = 10; mediaEvents.pause(); },
        motion(on) { enabled = on; observer(); },
        slow(on) { slowDevice = on; observer(); },
        step(now) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(now); }
    };
}

test('every uploaded audio/video file is in the playlist exactly once', () => {
    const media = fs.readdirSync('src/music').filter(name => /\.(mp3|mp4)$/i.test(name));
    assert.equal(new Set(tracks.map(t => t.id)).size, tracks.length);
    assert.equal(new Set(tracks.map(t => t.filename)).size, tracks.length);
    assert.deepEqual(tracks.map(t => t.filename).sort(), media.sort());
    for (const song of tracks) assert.ok(song.memes.length && fs.existsSync('src/music/' + song.filename));
});
test('every scene reacts to audio levels through its own artwork', () => {
    const env = setup(); env.mount(tracks[0]);
    const context = env.container.children[0].getContext('2d');
    for (const mode of env.scenes.modes) {
        const render = level => {
            env.drawingCommands.length = 0;
            env.scenes.render(context, { mode, time: 2, low: level, high: level,
                colors: ['#123456', '#789abc', '#def012'] });
            assert.ok(env.drawingCommands.every(cmd => cmd.slice(1).every(v => typeof v !== 'number' || Number.isFinite(v))));
            return JSON.stringify(env.drawingCommands);
        };
        assert.notEqual(render(0), render(1), mode + ' should react to the music');
    }
});
test('all 21 songs have distinct, registered scenes and produce distinct artwork', () => {
    const env = setup(), modes = new Set(), fingerprints = new Set();
    assert.equal(tracks.length, 21);
    for (const song of tracks) {
        const profile = env.stage.profileFor(song);
        assert.ok(env.scenes.modes.includes(profile.mode));
        assert.ok(song.stage.description);
        modes.add(profile.mode);
        env.drawingCommands.length = 0;
        env.mount(song);
        // Actual drawing commands catch accidental routing to a shared fallback.
        // A common palette means changing colors alone cannot pass this check.
        env.drawingCommands.length = 0;
        env.scenes.render(env.container.children[0].getContext('2d'), {
            mode: profile.mode, time: 1, low: 0.3, high: 0.2,
            colors: ['#123456', '#789abc', '#def012']
        });
        const art = JSON.stringify(env.drawingCommands.filter(cmd => cmd[0] !== 'fillText'));
        fingerprints.add(createHash('sha256').update(art).digest('hex'));
    }
    assert.equal(modes.size, 21); assert.equal(fingerprints.size, 21);
});
test('slow devices draw in concert mode but rest behind the desktop', () => {
    const env = setup(); env.slow(true); env.mount(tracks[15]); env.play();
    assert.equal(env.frames.size, 0);
    env.stage.toggleConcert(true); assert.equal(env.frames.size, 1);
    const canvas = env.container.children[0];
    assert.equal(canvas.width, 1280); assert.equal(canvas.height, 720);
    env.stage.toggleConcert(false); assert.equal(env.frames.size, 0);
});
test('selecting a new set closes the setlist and leaving concert restores the desktop', () => {
    const env = setup(); env.mount(tracks[15]); env.stage.toggleConcert(true);
    env.stage.toggleSetlist(true); assert.ok(env.doc.body.classList.contains('concert-setlist'));
    env.mount(tracks[16]); assert.equal(env.doc.body.classList.contains('concert-setlist'), false);
    env.stage.toggleConcert(false); assert.equal(env.doc.body.classList.contains('concert-mode'), false);
});
test('Motion reveals are cleaned up on fast track changes, pause, exit and reduced motion', () => {
    const env = setup(false, true); env.mount(tracks[15]); env.play(); env.stage.toggleConcert(true);
    assert.equal(env.reveals.size, 2);
    for (const song of tracks) { env.mount(song); assert.equal(env.reveals.size, 2); }
    env.pause(); assert.equal(env.reveals.size, 0);
    env.play(); env.mount(tracks[0]); assert.equal(env.reveals.size, 2);
    env.motion(false); assert.equal(env.reveals.size, 0);
    env.mount(tracks[1]); assert.equal(env.reveals.size, 0);
    env.motion(true); env.mount(tracks[3]); assert.equal(env.reveals.size, 2);
    env.stage.toggleConcert(false); assert.equal(env.reveals.size, 0);
});
test('every song has a usable stage palette, including the older dark themes', () => {
    const env = setup();
    for (const song of tracks) {
        const profile = env.stage.profileFor(song);
        assert.ok(profile.mode && profile.label);
        assert.equal(profile.colors.length, 3);
        assert.ok(profile.colors.every(c => /^#[0-9a-f]{6}$/i.test(c) && c !== '#000000'));
    }
});
test('changing songs replaces the stage without accumulating canvases or animation loops', () => {
    const env = setup(); env.play();
    for (const song of tracks) {
        env.mount(song);
        assert.equal(env.container.children.length, 1);
        assert.equal(env.frames.size, 1);
        assert.equal(env.hud.querySelector('.music-stage-title').textContent, song.title);
    }
});
test('silence and loud samples produce different bounded stage lighting', () => {
    const env = setup(); env.mount(tracks[15]); env.play();
    env.stage.audioFrame(new Uint8Array(128)); env.step(1);
    const quiet = Number(env.container.style.getPropertyValue('--stage-energy'));
    env.stage.audioFrame(new Uint8Array(128).fill(255));
    for (let i = 1; i < 12; i++) env.step(i * 40);
    const loud = Number(env.container.style.getPropertyValue('--stage-energy'));
    assert.ok(loud > quiet + 0.5 && loud <= 1);
    assert.match(env.hud.querySelector('.music-stage-status').textContent, /AUDIO REACTIVE/);
});
test('pause freezes the lighting and resume starts exactly one loop', () => {
    const env = setup(); env.mount(tracks[0]); env.play(); env.pause();
    assert.equal(env.frames.size, 0);
    assert.match(env.hud.querySelector('.music-stage-status').textContent, /PAUSED/);
    env.play(); env.play(); assert.equal(env.frames.size, 1);
});
test('both live motion preference changes and hidden tabs stop animation', () => {
    const env = setup(); env.mount(tracks[0]); env.play(); env.motion(false);
    assert.equal(env.frames.size, 0);
    const frozen = env.draws;
    env.stage.audioFrame(new Uint8Array(128).fill(255));
    assert.equal(env.draws, frozen);
    env.motion(true); assert.equal(env.frames.size, 1);
    env.doc.hidden = true; env.events.visibilitychange(); assert.equal(env.frames.size, 0);
    env.doc.hidden = false; env.events.visibilitychange(); assert.equal(env.frames.size, 1);
});
test('reduced motion is respected even when a new song is mounted', () => {
    const env = setup(); env.play(); env.motion(false);
    for (const song of tracks) { env.mount(song); assert.equal(env.frames.size, 0); }
});
test('concert mode exposes the stage, announces its state and restores keyboard focus', () => {
    const env = setup(); env.mount(tracks[15]);
    env.stage.toggleConcert(true);
    assert.ok(env.doc.body.classList.contains('concert-mode'));
    assert.equal(env.hud.hidden, false);
    assert.equal(env.button.attributes['aria-pressed'], 'true');
    env.stage.toggleConcert(false);
    assert.equal(env.hud.hidden, true);
    assert.equal(env.button.attributes['aria-pressed'], 'false');
    assert.equal(env.doc.activeElement, env.button);
});
test('Escape exits concert mode without leaking to hidden desktop shortcuts', () => {
    const env = setup(); env.mount(tracks[0]); env.stage.toggleConcert(true);
    let prevented = false, stopped = false;
    env.events.keydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.ok(prevented && stopped && env.hud.hidden);
    assert.equal(env.doc.body.classList.contains('concert-mode'), false);
});
test('resizing a paused stage keeps a bounded backing canvas and does not animate', () => {
    const env = setup(); env.mount(tracks[0]); env.events.resize();
    const canvas = env.container.children[0];
    assert.ok(canvas.width * canvas.height <= 1604000);
    assert.equal(env.frames.size, 0);
});
test('unknown custom profiles fall back and excessive speeds are clamped', () => {
    const env = setup();
    const profile = env.stage.profileFor({ effect: 'unrecognised', stage: { mode: 'bad', colors: ['invalid'], speed: 900 } });
    assert.equal(profile.mode, 'space'); assert.equal(profile.speed, 2);
    assert.ok(profile.colors.every(c => /^#[0-9a-f]{6}$/i.test(c)));
});
test('missing canvas support does not prevent the player or concert controls working', () => {
    const env = setup(true); env.mount(tracks[0]); env.play(); env.stage.toggleConcert(true);
    assert.equal(env.frames.size, 0); assert.equal(env.hud.hidden, false);
});

console.log(`\n${checks} music stage regression checks passed.`);
