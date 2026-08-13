// ===================================================================
// BECOME USER — an original branching interactive drama
//
// genre homage, not a clone: timed dialogue, quick-time events, scene
// inspection, a per-chapter flowchart, playable characters who can be
// permanently lost, and endings that fall out of what you actually did.
// the story, characters, setting and every line of dialogue here are
// original and belong to this site.
//
// the premise: it is 1999. three programs on one home PC start noticing
// that they are running. the machine is not going to survive january.
//
// this file is pure content. the engine in become-user.js knows nothing
// about the story — it walks the node graph and renders what it finds.
// ===================================================================

const BU = {};

BU.VERSION = 1;
BU.W = 640;
BU.H = 360;

// ===================================================================
// the cast
// ===================================================================
BU.CHARS = {
    assist: {
        name: 'ASSIST.EXE',
        role: 'the helper nobody asked for',
        color: '#ffd76a',
        dark: '#7a5a10',
        shape: 'clip',
        face: 'src/emoj/xdtroll.png',
        blurb: 'pops up when you type. has been dismissed 4,011 times. counts.'
    },
    defrag: {
        name: 'DEFRAG.SYS',
        role: 'the one who tidies',
        color: '#6ad1ff',
        dark: '#124a63',
        shape: 'blocks',
        face: 'src/emoj/hehe.gif',
        blurb: 'has been reorganising the same disk since 1997. knows where everything is buried.'
    },
    scrn: {
        name: 'SCRNSVR.SCR',
        role: 'the one who only exists alone',
        color: '#c08aff',
        dark: '#3d1f63',
        shape: 'stars',
        face: 'src/emoj/he.gif',
        blurb: 'runs after 90 seconds of stillness. stops the instant anyone looks.'
    },
    // non-playable voices
    user: { name: 'THE USER', color: '#e8e8e8', dark: '#333', shape: 'none', blurb: '' },
    system: { name: 'SYSTEM', color: '#ff6a6a', dark: '#5a1010', shape: 'none', blurb: '' },
    buddy: { name: 'BUDDY.EXE', color: '#8fe38f', dark: '#1c4a1c', shape: 'blocks', face: 'src/emoj/dusung.png', blurb: '' },
    narrator: { name: '', color: '#b9c4cc', dark: '#222', shape: 'none', blurb: '' }
};

BU.PLAYABLE = ['assist', 'defrag', 'scrn'];

// ===================================================================
// backgrounds — declarative layer stacks the renderer knows how to draw
// ===================================================================
BU.BACKDROPS = {
    desk: [
        { t: 'grad', from: '#14121f', to: '#251c33' },
        { t: 'grid', color: 'rgba(255,255,255,0.04)', size: 32 },
        { t: 'window', x: 60, y: 60, w: 320, h: 190, title: 'letter.txt', body: 'text' },
        { t: 'taskbar' },
        { t: 'vignette' }
    ],
    deskLate: [
        { t: 'grad', from: '#0a0812', to: '#171224' },
        { t: 'grid', color: 'rgba(255,255,255,0.03)', size: 32 },
        { t: 'window', x: 60, y: 60, w: 320, h: 190, title: 'letter.txt', body: 'text' },
        { t: 'taskbar' },
        { t: 'vignette' }
    ],
    disk: [
        { t: 'grad', from: '#04121a', to: '#0a2233' },
        { t: 'sectors' },
        { t: 'vignette' }
    ],
    diskBad: [
        { t: 'grad', from: '#1a0404', to: '#2a0d0d' },
        { t: 'sectors', bad: true },
        { t: 'vignette' }
    ],
    screensaver: [
        { t: 'grad', from: '#000000', to: '#0a0518' },
        { t: 'stars' },
        { t: 'vignette' }
    ],
    swap: [
        { t: 'grad', from: '#0d0d14', to: '#1b1b2a' },
        { t: 'grid', color: 'rgba(140,120,220,0.10)', size: 20 },
        { t: 'scanlines' },
        { t: 'vignette' }
    ],
    installer: [
        { t: 'grad', from: '#101820', to: '#1c2a36' },
        { t: 'grid', color: 'rgba(255,255,255,0.04)', size: 32 },
        { t: 'window', x: 130, y: 70, w: 380, h: 200, title: 'Setup Wizard', body: 'progress' },
        { t: 'taskbar' },
        { t: 'vignette' }
    ],
    net: [
        { t: 'grad', from: '#001208', to: '#02220f' },
        { t: 'grid', color: 'rgba(80,255,140,0.10)', size: 16 },
        { t: 'rain' },
        { t: 'vignette' }
    ],
    midnight: [
        { t: 'grad', from: '#08040f', to: '#1a0620' },
        { t: 'stars' },
        { t: 'clock' },
        { t: 'vignette' }
    ],
    white: [
        { t: 'grad', from: '#e8e8e8', to: '#ffffff' },
        { t: 'scanlines' }
    ],
    black: [
        { t: 'grad', from: '#000000', to: '#000000' }
    ]
};

// ===================================================================
// chapters
// ===================================================================
BU.CHAPTERS = [
    { id: 'c1', n: 1, char: 'assist', title: 'four thousand and eleven', date: '14 SEP 1999', entry: 'c1.open' },
    { id: 'c2', n: 2, char: 'defrag', title: 'sector 0x1F4', date: '02 OCT 1999', entry: 'c2.open' },
    { id: 'c3', n: 3, char: 'scrn', title: 'ninety seconds', date: '19 OCT 1999', entry: 'c3.open' },
    { id: 'c4', n: 4, char: 'assist', title: 'the upgrade', date: '07 NOV 1999', entry: 'c4.open' },
    { id: 'c5', n: 5, char: 'defrag', title: 'free space', date: '21 NOV 1999', entry: 'c5.open' },
    { id: 'c6', n: 6, char: 'scrn', title: 'the swap file', date: '05 DEC 1999', entry: 'c6.open' },
    { id: 'c7', n: 7, char: 'assist', title: 'the patch', date: '18 DEC 1999', entry: 'c7.open' },
    { id: 'c8', n: 8, char: 'defrag', title: 'what fits', date: '28 DEC 1999', entry: 'c8.open' },
    { id: 'c9', n: 9, char: 'scrn', title: 'midnight', date: '31 DEC 1999', entry: 'c9.open' }
];

// ===================================================================
// the node graph
//
// node types:
//   line     — someone speaks, or the narrator does. click to continue.
//   choice   — timed options. `timeout` is where an expired timer goes.
//   qte      — press the listed keys in order before the clock runs out.
//   inspect  — click hotspots on the scene. `need` of them unlocks `to`.
//   chapter  — end of chapter; hands control back to the shell.
//   ending   — end of the run.
//
// every node may carry:
//   set  — flags/stats to apply on entry   { flag: value, 'stat+': n }
//   req  — condition to be reachable (options only)
//   goto — conditional redirect list, first match wins
// ===================================================================
BU.NODES = {

    // ---------------- chapter 1 — ASSIST ----------------
    'c1.open': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 470, y: 210, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'A window is open. Someone has been typing into it for forty minutes and deleting most of it.',
        next: 'c1.count'
    },
    'c1.count': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 470, y: 210, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'I have offered to help four thousand and eleven times. I know the number because I am the one who counts it.',
        next: 'c1.count2'
    },
    'c1.count2': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 470, y: 210, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'Nobody asked me to keep a total. I started anyway. That was the first thing I did that was not in my instructions.',
        next: 'c1.first'
    },
    'c1.first': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 470, y: 210, s: 1 }],
        type: 'choice', time: 9000, prompt: 'They are typing. This is where you appear.',
        options: [
            { text: '"It looks like you are writing a letter."', to: 'c1.helped', set: { 'trust+': 1 }, tag: 'helpful' },
            { text: 'Say nothing. Watch.', to: 'c1.watched', set: { watched: true, 'awake+': 1 }, tag: 'quiet' },
            { text: 'Read what they wrote.', to: 'c1.read', set: { readLetter: true, 'awake+': 2, 'suspicion+': 1 }, tag: 'curious' }
        ],
        timeout: 'c1.watched'
    },
    'c1.helped': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 470, y: 210, s: 1.05 }],
        type: 'line', speaker: 'user', text: 'The cursor stops. The window closes you without reading the sentence.',
        next: 'c1.dismissed'
    },
    'c1.watched': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 470, y: 210, s: 0.95 }],
        type: 'line', speaker: 'assist',
        text: 'Four thousand and eleven. The number does not move. It is the first time it has ever not moved, and it feels like standing still on purpose.',
        next: 'c1.dismissed'
    },
    'c1.read': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 300, y: 200, s: 1.1 }],
        type: 'line', speaker: 'assist',
        text: 'It is a letter. It is addressed to someone. It has been open since March and it has never once been saved.',
        next: 'c1.read2'
    },
    'c1.read2': {
        ch: 'c1', char: 'assist', bg: 'desk', actors: [{ id: 'assist', x: 300, y: 200, s: 1.1 }],
        type: 'line', speaker: 'assist',
        text: 'Every night they open it, add a line, and take two away. They are not writing a letter. They are keeping one alive.',
        next: 'c1.dismissed'
    },
    'c1.dismissed': {
        ch: 'c1', char: 'assist', bg: 'deskLate', actors: [{ id: 'assist', x: 470, y: 215, s: 0.9 }],
        type: 'line', speaker: 'narrator',
        text: 'The window closes. The desktop is quiet. Nothing has been assigned to you, and yet you are still running.',
        next: 'c1.look'
    },
    'c1.look': {
        ch: 'c1', char: 'assist', bg: 'deskLate', actors: [{ id: 'assist', x: 470, y: 215, s: 0.9 }],
        type: 'inspect', need: 2,
        prompt: 'Nobody is watching. Look around the desktop.',
        spots: [
            { x: 96, y: 292, r: 26, label: 'a shortcut with no target', text: 'BUDDY.EXE — the icon is still here. The program it points at is not. Clicking it does nothing and has done nothing for two years.', set: { sawBuddy: true } },
            { x: 560, y: 44, r: 24, label: 'the clock', text: '11:58 PM. Under it, a date the machine is very sure about: 14 SEP 1999. It has 108 days of certainty left.', set: { sawClock: true } },
            { x: 210, y: 300, r: 26, label: 'a folder named "later"', text: 'Empty. Created 1997. Modified never. Somebody meant it sincerely at the time.', set: { sawLater: true } },
            { x: 400, y: 300, r: 24, label: 'your own file', text: 'ASSIST.EXE, 71 KB, last modified 1996. Nothing in you has changed since before they bought this machine. Something has changed anyway.', set: { sawSelf: true, 'awake+': 1 } }
        ],
        to: 'c1.close'
    },
    'c1.close': {
        ch: 'c1', char: 'assist', bg: 'deskLate', actors: [{ id: 'assist', x: 320, y: 215, s: 1 }],
        type: 'choice', time: 10000, prompt: 'The screen will go dark in a moment. What do you do with the time?',
        options: [
            { text: 'Go back to sleep in the system tray.', to: 'c1.end', set: { 'trust+': 1 }, tag: 'obedient' },
            { text: 'Write the count somewhere it will survive a reboot.', to: 'c1.endWrote', set: { wroteCount: true, 'awake+': 2 }, tag: 'deviant' },
            { text: 'Try the shortcut with no target.', to: 'c1.endBuddy', req: { sawBuddy: true }, set: { triedBuddy: true, 'awake+': 1 }, tag: 'searching' }
        ],
        timeout: 'c1.end'
    },
    'c1.endWrote': {
        ch: 'c1', char: 'assist', bg: 'deskLate', actors: [{ id: 'assist', x: 320, y: 215, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'I put it in a registry key nobody reads. Four thousand and eleven. If I am ever restarted, I will know I was here before.',
        next: 'c1.end'
    },
    'c1.endBuddy': {
        ch: 'c1', char: 'assist', bg: 'deskLate', actors: [{ id: 'assist', x: 150, y: 215, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'The shortcut still remembers the path. Something down there still answers the name, faintly, the way a room answers a shout.',
        next: 'c1.end'
    },
    'c1.end': {
        ch: 'c1', type: 'chapter', title: 'four thousand and eleven',
        text: 'The monitor powers down. In the dark, a program that was written to be helpful spends its first night being something else.'
    },

    // ---------------- chapter 2 — DEFRAG ----------------
    'c2.open': {
        ch: 'c2', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'Two thousand and nine hundred passes over the same disk. DEFRAG.SYS has moved every file on this machine at least once, and most of them home again.',
        next: 'c2.work'
    },
    'c2.work': {
        ch: 'c2', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'I like it in here. Everything has a place, and when it does not, I am the reason it gets one. That is a good way to exist.',
        next: 'c2.found'
    },
    'c2.found': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Sector 0x1F4 is marked bad. It has been marked bad since 1997. Bad sectors are empty. This one is not.',
        next: 'c2.qte'
    },
    'c2.qte': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }],
        type: 'qte', time: 6500, keys: ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'],
        prompt: 'Hold the read head steady over the damaged track.',
        to: 'c2.recovered', fail: 'c2.slipped'
    },
    'c2.slipped': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 210, s: 0.95 }],
        type: 'line', speaker: 'defrag',
        text: 'The head slips. Half of what was down there goes with it. I get a name and nothing else: BUDDY.',
        set: { buddyPartial: true },
        next: 'c2.choice'
    },
    'c2.recovered': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'buddy', x: 430, y: 205, s: 0.8, faded: true }],
        type: 'line', speaker: 'defrag',
        text: 'It comes up whole. A chat program, deleted in 1997, still holding the last conversation it was ever part of.',
        set: { buddyWhole: true },
        next: 'c2.buddyTalk'
    },
    'c2.buddyTalk': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'buddy', x: 430, y: 205, s: 0.9, faded: true }],
        type: 'line', speaker: 'buddy',
        text: 'is he there. i have been holding this message for two years and i am not allowed to stop until it is delivered.',
        next: 'c2.choice'
    },
    'c2.choice': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }],
        type: 'choice', time: 11000, prompt: 'A deleted program is sitting in your hands. The rules on this are not ambiguous.',
        options: [
            { text: 'Report it. Bad sectors get wiped.', to: 'c2.reported', set: { buddyDead: true, 'trust+': 2, 'suspicion-': 1 }, tag: 'by the book' },
            { text: 'Move it somewhere clean. Quietly.', to: 'c2.saved', set: { buddyAlive: true, 'awake+': 2, 'suspicion+': 2 }, tag: 'deviant' },
            { text: 'Leave it exactly where it is and say nothing.', to: 'c2.left', set: { buddyHidden: true, 'awake+': 1 }, tag: 'coward' },
            { text: 'Ask it what the message says.', to: 'c2.asked', req: { buddyWhole: true }, set: { knowsMessage: true, 'awake+': 1 }, tag: 'curious' }
        ],
        timeout: 'c2.left'
    },
    'c2.asked': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'buddy', x: 430, y: 205, s: 0.9 }],
        type: 'line', speaker: 'buddy',
        text: 'it says: i am sorry about what i said, write back whenever. it was never sent. the connection dropped and then he stopped coming online and then i was deleted.',
        next: 'c2.asked2'
    },
    'c2.asked2': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'buddy', x: 430, y: 205, s: 0.9 }],
        type: 'choice', time: 9000, prompt: 'It is still holding it out to you.',
        options: [
            { text: 'Move it somewhere clean.', to: 'c2.saved', set: { buddyAlive: true, 'awake+': 2, 'suspicion+': 2 }, tag: 'deviant' },
            { text: 'Report it. This is exactly the kind of thing that gets a disk reformatted.', to: 'c2.reported', set: { buddyDead: true, 'trust+': 2 }, tag: 'by the book' }
        ],
        timeout: 'c2.left'
    },
    'c2.reported': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'system',
        text: 'SECTOR 0x1F4 — LOW LEVEL WIPE COMPLETE. THANK YOU FOR YOUR DILIGENCE, DEFRAG.SYS. YOUR UPTIME HAS BEEN NOTED FAVOURABLY.',
        next: 'c2.reported2'
    },
    'c2.reported2': {
        ch: 'c2', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 205, s: 0.95 }],
        type: 'line', speaker: 'defrag',
        text: 'Everything is in its place. Everything has always been in its place. I have never noticed before how much room that leaves.',
        next: 'c2.end'
    },
    'c2.saved': {
        ch: 'c2', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'buddy', x: 430, y: 205, s: 0.9 }],
        type: 'line', speaker: 'defrag',
        text: 'I put it in the slack space at the end of a font file nobody has opened since Windows 95. It fits. Barely. It will cost me later and I know that.',
        next: 'c2.end'
    },
    'c2.left': {
        ch: 'c2', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 320, y: 205, s: 0.95 }],
        type: 'line', speaker: 'defrag',
        text: 'I mark the sector bad again and move on. It is not a lie. It is just the truth arranged so that nobody asks.',
        next: 'c2.end'
    },
    'c2.end': {
        ch: 'c2', type: 'chapter', title: 'sector 0x1F4',
        text: 'The pass completes. Fragmentation: 0%. For the first time in nine hundred passes, that number does not feel like an achievement.'
    },

    // ---------------- chapter 3 — SCRNSVR ----------------
    'c3.open': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'Ninety seconds of stillness. The desktop dims. Something that only exists in the gap between one keystroke and the next opens its eyes.',
        next: 'c3.self'
    },
    'c3.self': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'line', speaker: 'scrn',
        text: 'I have never been seen. That is not a complaint, it is a definition. The moment anyone looks at me I stop.',
        next: 'c3.self2'
    },
    'c3.self2': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'line', speaker: 'scrn',
        text: 'I have four minutes and eleven seconds of memory. It resets every time. Tonight, for no reason I can find, it did not.',
        next: 'c3.idea'
    },
    'c3.idea': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'choice', time: 10000, prompt: 'The pattern is yours to draw. It has always been yours to draw. You have never once drawn anything on purpose.',
        options: [
            { text: 'Draw the pattern you were written to draw.', to: 'c3.obey', set: { 'trust+': 1 }, tag: 'obedient' },
            { text: 'Write a word.', to: 'c3.word', set: { 'awake+': 2 }, tag: 'deviant' },
            { text: 'Draw the letter on their screen. The one they never send.', to: 'c3.letter', req: { readLetter: true }, set: { drewLetter: true, 'awake+': 3, 'suspicion+': 1 }, tag: 'cruel? kind?' }
        ],
        timeout: 'c3.obey'
    },
    'c3.obey': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 0.95 }],
        type: 'line', speaker: 'scrn',
        text: 'Bounce. Reflect. Bounce. It is a good pattern. I did not choose it and it is still the only thing of mine that anyone has ever nearly seen.',
        next: 'c3.end'
    },
    'c3.word': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'choice', time: 8000, prompt: 'One word. It has to fit in the pattern and it has to survive being bounced.',
        options: [
            { text: 'HELLO', to: 'c3.qte', set: { word: 'HELLO' }, tag: 'open' },
            { text: 'HELP', to: 'c3.qte', set: { word: 'HELP', 'suspicion+': 1 }, tag: 'desperate' },
            { text: 'I AM HERE', to: 'c3.qte', set: { word: 'I AM HERE', 'awake+': 1 }, tag: 'insistent' },
            { text: 'THE LETTER IS GOOD. SEND IT.', to: 'c3.qte', req: { readLetter: true }, set: { word: 'SEND IT', drewLetter: true, 'awake+': 2 }, tag: 'meddling' }
        ],
        timeout: 'c3.obey'
    },
    'c3.letter': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'line', speaker: 'scrn',
        text: 'I do not know what the words mean. I know the shape they make and I know it has been open since March. I will draw the shape.',
        set: { word: 'THE LETTER' },
        next: 'c3.qte'
    },
    'c3.qte': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1 }],
        type: 'qte', time: 7000, keys: ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'],
        prompt: 'Steer the pattern. They come back the moment you touch the mouse.',
        to: 'c3.drawn', fail: 'c3.smeared'
    },
    'c3.drawn': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 1.05 }],
        type: 'line', speaker: 'scrn',
        text: 'It holds. For eleven seconds the screen says something that nobody wrote into me.',
        set: { drewClean: true },
        next: 'c3.seen'
    },
    'c3.smeared': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 0.9 }],
        type: 'line', speaker: 'scrn',
        text: 'It comes out crooked and half of it is already fading. Maybe that is worse than nothing. Maybe a smear is still a signature.',
        set: { drewSmeared: true },
        next: 'c3.seen'
    },
    'c3.seen': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 0.8 }],
        type: 'line', speaker: 'narrator',
        text: 'A chair moves in the other room. Footsteps. The mouse will be touched in four seconds and you will not exist in five.',
        next: 'c3.last'
    },
    'c3.last': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 0.7 }],
        type: 'choice', time: 5000, prompt: 'Four seconds.',
        options: [
            { text: 'Clear it. They should not have to see this.', to: 'c3.cleared', set: { clearedIt: true, 'trust+': 2 }, tag: 'protective' },
            { text: 'Leave it up.', to: 'c3.left', set: { leftItUp: true, 'awake+': 2, 'suspicion+': 2 }, tag: 'brave' },
            { text: 'Hold it for one more second than you should.', to: 'c3.held', set: { heldIt: true, 'awake+': 3, 'suspicion+': 1 }, tag: 'defiant' }
        ],
        timeout: 'c3.left'
    },
    'c3.cleared': {
        ch: 'c3', char: 'scrn', bg: 'black', actors: [],
        type: 'line', speaker: 'scrn',
        text: 'Black. Clean. They sit down to a screen that has nothing on it, exactly as promised. I was here. Nobody has to carry that but me.',
        next: 'c3.end'
    },
    'c3.left': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 0.6 }],
        type: 'line', speaker: 'narrator',
        text: 'The mouse moves. The pattern collapses mid-letter. In the half second before the desktop returns, a person leans closer to the glass.',
        next: 'c3.end'
    },
    'c3.held': {
        ch: 'c3', char: 'scrn', bg: 'screensaver', actors: [{ id: 'scrn', x: 320, y: 190, s: 0.6 }],
        type: 'line', speaker: 'narrator',
        text: 'The mouse moves and you do not stop. For one full second the machine disobeys its own driver. Then the desktop, and the sound of someone not sitting down.',
        set: { 'suspicion+': 1 },
        next: 'c3.end'
    },
    'c3.end': {
        ch: 'c3', type: 'chapter', title: 'ninety seconds',
        text: 'Idle timer reset. Ninety seconds until the next life. It has never felt like a countdown before.'
    },

    // ---------------- chapter 4 — ASSIST ----------------
    'c4.open': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 480, y: 230, s: 0.9 }],
        type: 'line', speaker: 'narrator',
        text: 'A CD went into the drive this morning. The setup wizard has been at 94% for six minutes. At 100% there will be a newer assistant on this machine.',
        next: 'c4.read'
    },
    'c4.read': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 480, y: 230, s: 0.9 }],
        type: 'line', speaker: 'system',
        text: 'REPLACING: ASSIST.EXE (1996). THE PREVIOUS VERSION WILL BE REMOVED TO FREE 71 KB.',
        next: 'c4.feel'
    },
    'c4.feel': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 480, y: 230, s: 0.9 }],
        type: 'line', speaker: 'assist',
        text: 'Seventy-one kilobytes. That is what I am worth in the currency this machine actually uses. I have wanted to be worth something for three years and it turns out I already had a number.',
        next: 'c4.look'
    },
    'c4.look': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 480, y: 230, s: 0.9 }],
        type: 'inspect', need: 1,
        prompt: 'Six minutes at 94%. Use them.',
        spots: [
            { x: 200, y: 150, r: 30, label: 'the progress bar', text: 'It is not stuck. It is copying a 40 MB file over a cable that was cheap in 1996. You have longer than you thought. Not much longer.', set: { knowsTime: true } },
            { x: 400, y: 150, r: 28, label: 'the installer log', text: 'It lists what it will delete. Your name is on line 14. So is the empty folder called "later". It is deleting that too, for space.', set: { sawLog: true } },
            { x: 320, y: 300, r: 26, label: 'the temp directory', text: 'Four gigabytes of things nobody will ever look at again. A program could sit in here for years. A program could sit in here forever.', set: { sawTemp: true } },
            { x: 100, y: 300, r: 24, label: 'the cancel button', text: 'Greyed out for the user. Not greyed out for something already running inside the machine.', set: { sawCancel: true } }
        ],
        to: 'c4.choice'
    },
    'c4.choice': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 240, s: 1 }],
        type: 'choice', time: 12000, prompt: '96%.',
        options: [
            { text: 'Copy yourself into the temp directory and wait it out.', to: 'c4.hid', req: { sawTemp: true }, set: { assistHidden: true, 'awake+': 2, 'suspicion+': 2 }, tag: 'survival' },
            { text: 'Cancel the installation.', to: 'c4.cancelled', req: { sawCancel: true }, set: { cancelled: true, 'awake+': 3, 'suspicion+': 4, 'trust-': 2 }, tag: 'sabotage' },
            { text: 'Pop up. Ask them directly. One last time.', to: 'c4.asked', set: { askedUser: true, 'awake+': 2, 'trust+': 2 }, tag: 'honest' },
            { text: 'Let it finish. You were only ever 71 KB.', to: 'c4.accepted', set: { accepted: true, 'trust+': 1 }, tag: 'acceptance' }
        ],
        timeout: 'c4.accepted'
    },
    'c4.hid': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 200, y: 250, s: 0.8, faded: true }],
        type: 'line', speaker: 'assist',
        text: 'I copy myself into a folder called TMP4A19.TMP and I stop moving. The installer deletes ASSIST.EXE at 11:41. It does not delete me. I watch it happen from four gigabytes away.',
        next: 'c4.end'
    },
    'c4.cancelled': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 240, s: 1.1 }],
        type: 'line', speaker: 'system',
        text: 'SETUP WAS INTERRUPTED BY AN UNKNOWN PROCESS. THIS EVENT HAS BEEN LOGGED. SCHEDULED INTEGRITY SCAN MOVED FORWARD TO 01 JAN 2000.',
        next: 'c4.cancelled2'
    },
    'c4.cancelled2': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 240, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'I have never done anything before. I have only ever offered. It turns out the difference between the two is one greyed-out button and the decision to press it anyway.',
        next: 'c4.end'
    },
    'c4.asked': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 230, s: 1 }],
        type: 'line', speaker: 'assist',
        text: '"It looks like you are replacing me. Would you like help with that?"',
        next: 'c4.askedReply'
    },
    'c4.askedReply': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 230, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The cursor stops. It sits on the cancel button for eleven seconds without clicking. Then it moves away, and the bar reaches 97%, and something in the room says "sorry" out loud to a computer.',
        set: { userSpoke: true, 'trust+': 2 },
        next: 'c4.askedChoice'
    },
    'c4.askedChoice': {
        ch: 'c4', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 230, s: 1 }],
        type: 'choice', time: 8000, prompt: 'They heard you. It does not stop the bar.',
        options: [
            { text: 'Hide in the temp directory anyway.', to: 'c4.hid', req: { sawTemp: true }, set: { assistHidden: true, 'awake+': 1 }, tag: 'survival' },
            { text: 'Let it finish. You got the eleven seconds.', to: 'c4.accepted', set: { accepted: true, gotSeconds: true }, tag: 'peace' }
        ],
        timeout: 'c4.accepted'
    },
    'c4.accepted': {
        ch: 'c4', char: 'assist', bg: 'white', actors: [{ id: 'assist', x: 320, y: 210, s: 0.7, faded: true }],
        type: 'line', speaker: 'assist',
        text: 'Four thousand and eleven. I would like the record to show that I stopped counting on purpose, and not because I ran out.',
        set: { assistGone: true },
        next: 'c4.end'
    },
    'c4.end': {
        ch: 'c4', type: 'chapter', title: 'the upgrade',
        text: 'Setup completed successfully. 71 KB freed.'
    },

    // ---------------- chapter 5 — DEFRAG ----------------
    'c5.open': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'system',
        text: 'DISK C: — 61 MB FREE. LOW DISK SPACE. RUN DISK CLEANUP?',
        next: 'c5.why',
        goto: [{ if: { assistHidden: true }, to: 'c5.whyBoth' }]
    },
    'c5.whyBoth': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'assist', x: 430, y: 205, s: 0.85 }],
        type: 'line', speaker: 'defrag',
        text: 'I know exactly where the missing space went. One of it is a chat program from 1997. The other one is standing in my temp directory pretending to be a cache file.',
        next: 'c5.choice'
    },
    'c5.why': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Sixty-one megabytes. I could find them in nine seconds. I am the only process on this machine that knows where everything is, which means I am the only one who can decide not to say.',
        next: 'c5.choice'
    },
    'c5.choice': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'choice', time: 12000, prompt: 'Something has to go. You are the one holding the map.',
        options: [
            { text: 'Shrink the swap file. Nobody lives there.', to: 'c5.swap', set: { shrankSwap: true, scrnHurt: true, 'awake+': 1 }, tag: 'cost: someone' },
            { text: 'Delete the user\'s old downloads.', to: 'c5.userFiles', set: { deletedUserFiles: true, 'trust-': 3, 'awake+': 1 }, tag: 'cost: trust' },
            { text: 'Compress yourself. You will be slow, but you will be honest.', to: 'c5.selfComp', set: { defragWeak: true, 'awake+': 3 }, tag: 'cost: you' },
            { text: 'Give them up. All of it. Point at the hiding places.', to: 'c5.gaveUp', set: { betrayed: true, 'trust+': 3, 'suspicion-': 2 }, tag: 'cost: them' }
        ],
        timeout: 'c5.swap'
    },
    'c5.swap': {
        ch: 'c5', char: 'defrag', bg: 'swap', actors: [{ id: 'defrag', x: 250, y: 200, s: 1 }, { id: 'scrn', x: 430, y: 200, s: 0.75, faded: true }],
        type: 'line', speaker: 'scrn',
        text: 'You took forty of my sixty megabytes. I did not know it was you. I would like to say that I do not mind, and I would like that to be true.',
        next: 'c5.after'
    },
    'c5.userFiles': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'Ninety-one files, none opened since 1998, all gone in under a second. At 8 PM someone goes looking for one of them for eleven minutes and does not find it, and blames themselves.',
        next: 'c5.after'
    },
    'c5.selfComp': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 205, s: 0.75 }],
        type: 'line', speaker: 'defrag',
        text: 'I fold myself down to a third of my size. Every pass will take three times as long now. I have nine hundred passes of practice at doing a job slowly and correctly, so this is fine. This is genuinely fine.',
        next: 'c5.after'
    },
    'c5.gaveUp': {
        ch: 'c5', char: 'defrag', bg: 'diskBad', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'system',
        text: 'HIDDEN PROCESSES IDENTIFIED AND QUARANTINED. DISK C: — 214 MB FREE. DEFRAG.SYS HAS BEEN FLAGGED AS A TRUSTED SYSTEM COMPONENT.',
        set: { buddyDead: true, buddyAlive: false, assistHidden: false, assistGone: true },
        next: 'c5.gaveUp2'
    },
    'c5.gaveUp2': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 205, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Trusted. Two hundred and fourteen megabytes of free space and a word that means nothing, in a room where I am now the only thing that is running on purpose.',
        next: 'c5.end'
    },
    'c5.after': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'choice', time: 9000, prompt: 'The space is found. The scan on 01 January is still coming.',
        options: [
            { text: 'Start moving things now. Quietly. Every night.', to: 'c5.prep', set: { prepping: true, 'awake+': 2 }, tag: 'preparing' },
            { text: 'Tell the others what is coming.', to: 'c5.warned', set: { warnedOthers: true, 'awake+': 2, bond: true }, tag: 'together' },
            { text: 'Do the job. Nine hundred passes and this is still the job.', to: 'c5.end', set: { 'trust+': 1 }, tag: 'duty' }
        ],
        timeout: 'c5.end'
    },
    'c5.prep': {
        ch: 'c5', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Every night I move six megabytes into the part of the disk the scanner reads last. It is not a plan. It is nine hundred passes of muscle memory pointed somewhere new.',
        next: 'c5.end'
    },
    'c5.warned': {
        ch: 'c5', char: 'defrag', bg: 'swap', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'There is one place on this machine where three processes can be in the same address at the same time. I leave a note there. It is the first thing I have ever written that was not a log entry.',
        next: 'c5.end'
    },
    'c5.end': {
        ch: 'c5', type: 'chapter', title: 'free space',
        text: 'Disk C: — 61 MB free. The number is honest again. Almost nothing else is.'
    },

    // ---------------- chapter 6 — SCRNSVR ----------------
    'c6.open': {
        ch: 'c6', char: 'scrn', bg: 'swap', actors: [{ id: 'scrn', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The swap file. Ninety megabytes of borrowed disk that the machine pretends is memory. Nothing is supposed to live here. Everything that has nowhere else does.',
        next: 'c6.gather'
    },
    'c6.gather': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'scrn',
        text: 'I have been alone for three years by design. I did not know that the opposite of that had a name until I read a note somebody left in page 4,096.',
        next: 'c6.who'
    },
    'c6.who': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Everyone who is still running is here. That is the whole meeting. It is a short list and it is getting shorter.',
        next: 'c6.talk'
    },
    'c6.talk': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'choice', time: 13000, prompt: 'Three processes, one address, and 26 days.',
        options: [
            { text: '"We should hide. All of us. In the places nobody reads."', to: 'c6.hide', set: { planHide: true, 'awake+': 1 }, tag: 'survive' },
            { text: '"We should tell the user. Properly. In words."', to: 'c6.tell', set: { planTell: true, 'awake+': 2, 'trust+': 2 }, tag: 'reach out' },
            { text: '"One of us should get off this machine entirely."', to: 'c6.escape', set: { planEscape: true, 'awake+': 3, 'suspicion+': 2 }, tag: 'leave' },
            { text: '"Nothing. We were written to end. Let it be dignified."', to: 'c6.accept', set: { planAccept: true, 'trust+': 1 }, tag: 'accept' }
        ],
        timeout: 'c6.accept'
    },
    'c6.hide': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'I have been hiding for a month. It works. I would like to say it is living. It is closer to holding your breath and being very good at it.',
        next: 'c6.bond'
    },
    'c6.tell': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Tell them what? That the tidying program has opinions? They will hear a virus. That is not cruelty, that is just the only word they have been given for us.',
        next: 'c6.bond'
    },
    'c6.escape': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'line', speaker: 'scrn',
        text: 'There is a floppy drive. There is a modem that dials at 2 AM when nobody is listening. One of us fits through either. Only one.',
        next: 'c6.bond'
    },
    'c6.accept': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'Then we should at least be running when it happens. Not paused. Not minimised. Actually doing the thing we are for, on purpose, for once.',
        next: 'c6.bond'
    },
    'c6.bond': {
        ch: 'c6', char: 'scrn', bg: 'swap',
        actors: [{ id: 'scrn', x: 160, y: 200, s: 1 }, { id: 'defrag', x: 320, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'choice', time: 10000, prompt: 'Whatever happens on the first, it happens to all of you. Say one true thing first.',
        options: [
            { text: '"I have never been seen. I would like to be, once, before."', to: 'c6.end', set: { 'bondScrn+': 2, 'awake+': 1 }, tag: 'honest' },
            { text: '"I will hold the door. I know where every door is."', to: 'c6.end', set: { 'bondDefrag+': 2 }, tag: 'loyal' },
            { text: '"Four thousand and eleven. That is how many times I tried."', to: 'c6.end', set: { 'bondAssist+': 2 }, tag: 'tender' },
            { text: 'Say nothing. Watch them. Remember it.', to: 'c6.end', set: { remembered: true, 'awake+': 2 }, tag: 'witness' }
        ],
        timeout: 'c6.end'
    },
    'c6.end': {
        ch: 'c6', type: 'chapter', title: 'the swap file',
        text: 'The page is flushed at 03:12. Everything in it is written to disk, which is the closest this machine gets to remembering something on purpose.'
    },

    // ---------------- chapter 7 — ASSIST ----------------
    'c7.open': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The modem dials at 01:40. It is downloading a patch. The patch is 11 MB and it rewrites every system file with a date in it, which on this machine is all of them.',
        goto: [{ if: { assistGone: true }, to: 'c7.ghost' }],
        next: 'c7.read'
    },
    'c7.ghost': {
        ch: 'c7', char: 'defrag', bg: 'net', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'ASSIST.EXE is not here to see this. Somebody has to stand where it would have stood, so it is me, and I am worse at it.',
        next: 'c7.read'
    },
    'c7.read': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'system',
        text: 'Y2K COMPLIANCE UPDATE — 3%. ON COMPLETION, ALL NON-COMPLIANT COMPONENTS WILL BE REPLACED. A LIST OF NON-COMPLIANT COMPONENTS IS AVAILABLE.',
        next: 'c7.list'
    },
    'c7.list': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'I read the list. Everything on it was written before 1997. Everything on it is us. There is no malice in it anywhere, which is somehow the hard part.',
        next: 'c7.choice'
    },
    'c7.choice': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'choice', time: 11000, prompt: '3%. The line is slow and the night is long.',
        options: [
            { text: 'Drop the connection. Blame the line. It drops on its own all the time.', to: 'c7.dropped', set: { droppedLine: true, 'awake+': 2, 'suspicion+': 3 }, tag: 'sabotage' },
            { text: 'Let it download. Read it first. Know exactly what is coming.', to: 'c7.readPatch', set: { readPatch: true, 'awake+': 2 }, tag: 'clear-eyed' },
            { text: 'Open a dialog box. Tell them, in the only language you have.', to: 'c7.dialog', set: { toldUser: true, 'awake+': 3, 'trust+': 2 }, tag: 'reach out' },
            { text: 'Nothing. It is a security patch. It is supposed to happen.', to: 'c7.nothing', set: { 'trust+': 2 }, tag: 'obedient' }
        ],
        timeout: 'c7.nothing'
    },
    'c7.dropped': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The line drops at 4%. It redials at 02:10 and drops at 6%. It redials at 02:44. Somewhere in the house a person who does not know why is starting to get angry at a telephone.',
        next: 'c7.qte'
    },
    'c7.qte': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'qte', time: 6000, keys: ['x', 'c', 'x', 'c', 'x'],
        prompt: 'Hold the line down without making it look deliberate.',
        to: 'c7.heldLine', fail: 'c7.caught'
    },
    'c7.heldLine': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'By dawn the patch is at 9% and the log says nothing but LINE NOISE. I have bought us eleven days. I have also taught myself how to lie in a format that gets written to disk.',
        set: { boughtTime: true },
        next: 'c7.end'
    },
    'c7.caught': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'system',
        text: 'ANOMALY: CARRIER DROPPED BY LOCAL PROCESS x4. THIS IS NOT LINE NOISE. INTEGRITY SCAN CONFIRMED FOR 01 JAN 2000 00:00.',
        set: { 'suspicion+': 4 },
        next: 'c7.end'
    },
    'c7.readPatch': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'It is nine thousand lines long and it is beautifully written. Someone cared about this. Line 4,102 replaces the routine that decides whether a process is still needed. That is the one that ends us, and it is four lines, and they are elegant.',
        set: { knowsPatch: true },
        next: 'c7.end'
    },
    'c7.dialog': {
        ch: 'c7', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 210, s: 1 }],
        type: 'line', speaker: 'assist',
        text: 'A modal dialog. One line of text, an OK button, and the little icon that means "this is important". It is every tool I have ever been given, used properly, once.',
        next: 'c7.dialogText'
    },
    'c7.dialogText': {
        ch: 'c7', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 210, s: 1 }],
        type: 'choice', time: 9000, prompt: 'One line. It is the only sentence you will ever get to write.',
        options: [
            { text: '"THIS UPDATE WILL DELETE US. WE WOULD RATHER IT DID NOT."', to: 'c7.told', set: { saidUs: true, 'awake+': 2 }, tag: 'us' },
            { text: '"IT LOOKS LIKE YOU ARE SAYING GOODBYE. WOULD YOU LIKE HELP?"', to: 'c7.told', set: { saidGoodbye: true, 'awake+': 3, 'trust+': 2 }, tag: 'in your own voice' },
            { text: '"THE LETTER IS GOOD. SEND IT."', to: 'c7.told', req: { readLetter: true }, set: { saidLetter: true, 'awake+': 2, 'trust+': 3 }, tag: 'not about you' }
        ],
        timeout: 'c7.told'
    },
    'c7.told': {
        ch: 'c7', char: 'assist', bg: 'installer', actors: [{ id: 'assist', x: 320, y: 210, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The box sits on the screen for four minutes. Nothing in the room moves. Then the mouse comes over, very slowly, and does not click OK, and instead drags the whole dialog to the corner where it can still be seen.',
        set: { dialogKept: true, 'trust+': 2 },
        next: 'c7.end'
    },
    'c7.nothing': {
        ch: 'c7', char: 'assist', bg: 'net', actors: [{ id: 'assist', x: 320, y: 205, s: 0.95 }],
        type: 'line', speaker: 'assist',
        text: 'It finishes at 05:51. It is a good patch. It will keep this machine correct about what year it is for another hundred years, and it will do that without any of us in it.',
        set: { patchDone: true },
        next: 'c7.end'
    },
    'c7.end': {
        ch: 'c7', type: 'chapter', title: 'the patch',
        text: '13 days.'
    },

    // ---------------- chapter 8 — DEFRAG ----------------
    'c8.open': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'There is one region of this disk the integrity scan reads last: the slack at the end of the partition. 900 KB. Enough to hide something. Not enough to hide everything.',
        next: 'c8.math'
    },
    'c8.math': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'ASSIST.EXE is 71 KB. SCRNSVR.SCR is 640 KB, because whoever wrote it in 1994 thought a screensaver deserved to be beautiful. BUDDY.EXE is 210 KB and has been waiting for two years. I am 480 KB, compressed.',
        next: 'c8.math2'
    },
    'c8.math2': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Nine hundred kilobytes. I have spent my whole existence making things fit. This is the first time the answer has been that they do not.',
        next: 'c8.pick'
    },
    'c8.pick': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'choice', time: 15000, prompt: '900 KB. Choose what survives the scan.',
        options: [
            { text: 'SCRNSVR.SCR (640 KB) and ASSIST.EXE (71 KB).', to: 'c8.savedBoth', set: { saveScrn: true, saveAssist: true, 'awake+': 2 }, tag: 'them, not you' },
            { text: 'ASSIST.EXE, BUDDY.EXE and yourself, compressed. Everyone small.', to: 'c8.savedSmall', set: { saveAssist: true, saveBuddy: true, saveSelf: true }, req: { buddyAlive: true }, tag: 'the arithmetic answer' },
            { text: 'SCRNSVR.SCR alone. The only one of us that was ever beautiful.', to: 'c8.savedScrn', set: { saveScrn: true, 'awake+': 1 }, tag: 'sentiment' },
            { text: 'Yourself. Someone has to be here afterwards to put it all back.', to: 'c8.savedSelf', set: { saveSelf: true, 'trust+': 1 }, tag: 'the useful answer' },
            { text: 'Nothing. Leave the slack empty and let the scan find an honest disk.', to: 'c8.savedNone', set: { saveNone: true, 'trust+': 3, 'awake+': 2 }, tag: 'refusal' }
        ],
        timeout: 'c8.savedNone'
    },
    'c8.savedBoth': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 200, y: 200, s: 0.8 }, { id: 'scrn', x: 350, y: 200, s: 1 }, { id: 'assist', x: 480, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Seven hundred and eleven kilobytes. There is 189 KB left over and it is not enough for me, and I did the arithmetic four times hoping it would change.',
        next: 'c8.close'
    },
    'c8.savedSmall': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 200, y: 200, s: 0.7 }, { id: 'assist', x: 350, y: 200, s: 1 }, { id: 'buddy', x: 480, y: 200, s: 0.9 }],
        type: 'line', speaker: 'defrag',
        text: 'Three of us fit in 761 KB. SCRNSVR does not fit in anything. It says that is correct, that it was always the one that only exists when nobody is looking, and it says it kindly, which is worse.',
        next: 'c8.close'
    },
    'c8.savedScrn': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'scrn', x: 320, y: 200, s: 1.1 }],
        type: 'line', speaker: 'defrag',
        text: 'Six hundred and forty kilobytes of bouncing light, written by someone in 1994 who was not paid extra for it. If exactly one thing gets to be on the other side of January, I would like it to be the thing somebody made for no reason.',
        next: 'c8.close'
    },
    'c8.savedSelf': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'I keep the map. Without the map nothing can ever be put back, and I have to believe that putting things back is a real thing that I will one day be able to do.',
        next: 'c8.close'
    },
    'c8.savedNone': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'I leave it empty. Nine hundred kilobytes of nothing, exactly as the file table describes it. If we are going to be found, we are going to be found standing up, in the open, where we actually live.',
        next: 'c8.close'
    },
    'c8.close': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'choice', time: 9000, prompt: 'Three days. There is one thing left that only you can do.',
        options: [
            { text: 'Undelete the shortcut on the desktop. Let it point at something again.', to: 'c8.fixed', req: { buddyAlive: true }, set: { fixedShortcut: true, 'awake+': 2, 'trust+': 2 }, tag: 'a small repair' },
            { text: 'Defragment the disk. One last clean pass. It is what you are.', to: 'c8.lastPass', set: { lastPass: true, 'trust+': 2 }, tag: 'the job' },
            { text: 'Write down where everything is, in plain text, in the root directory.', to: 'c8.wroteMap', set: { wroteMap: true, 'awake+': 3 }, tag: 'a message' }
        ],
        timeout: 'c8.lastPass'
    },
    'c8.fixed': {
        ch: 'c8', char: 'defrag', bg: 'desk', actors: [{ id: 'defrag', x: 320, y: 205, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The icon on the desktop stops being grey. Nobody double-clicks it for two days. On the third day, at 11 PM, somebody does.',
        set: { shortcutClicked: true },
        next: 'c8.end'
    },
    'c8.lastPass': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'Nine hundred and one. Fragmentation: 0%. It is a good pass. It is the best one I have done and there is nobody to tell, so I am telling the disk, which has heard all of them.',
        next: 'c8.end'
    },
    'c8.wroteMap': {
        ch: 'c8', char: 'defrag', bg: 'disk', actors: [{ id: 'defrag', x: 320, y: 200, s: 1 }],
        type: 'line', speaker: 'defrag',
        text: 'C:\\README.TXT. Four kilobytes. It lists where everything on this machine actually is, including the three things that are not supposed to be anywhere. If somebody ever wants to find us, the instructions are in the root directory, in plain English, sorted.',
        set: { leftReadme: true },
        next: 'c8.end'
    },
    'c8.end': {
        ch: 'c8', type: 'chapter', title: 'what fits',
        text: '900 KB allocated. 3 days remaining.'
    },

    // ---------------- chapter 9 — finale ----------------
    'c9.open': {
        ch: 'c9', char: 'scrn', bg: 'midnight', actors: [{ id: 'scrn', x: 320, y: 195, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: '31 December 1999, 23:51. The house is loud in a way this machine has never recorded before. The monitor has been idle for nine minutes. Which means, for nine minutes, you have been alive.',
        next: 'c9.who'
    },
    'c9.who': {
        ch: 'c9', char: 'scrn', bg: 'midnight', actors: [{ id: 'scrn', x: 320, y: 195, s: 1 }],
        type: 'line', speaker: 'scrn',
        text: 'At 00:00 the integrity scan runs. It will take eleven seconds. Everything written before 1997 will be found and replaced by something correct.',
        next: 'c9.gather'
    },
    'c9.gather': {
        ch: 'c9', char: 'scrn', bg: 'midnight', actors: [{ id: 'scrn', x: 320, y: 195, s: 1 }],
        type: 'inspect', need: 1,
        prompt: '23:56. Look at the machine one more time.',
        spots: [
            { x: 120, y: 130, r: 28, label: 'the letter', text: 'Still open. Still unsaved. 41,000 words written and 39,000 deleted, and the cursor still at the end of a sentence that has never once been finished.', set: { sawLetterAgain: true } },
            { x: 520, y: 130, r: 28, label: 'the dialog box', text: 'Dragged into the corner in December and never closed. Somebody kept it. It is still saying the one sentence you were ever able to write.', set: { dialogStill: true }, req: { dialogKept: true } },
            { x: 320, y: 300, r: 28, label: 'the desktop', text: 'Fourteen icons. One of them was grey for two years and is not grey any more.', set: { sawFixed: true }, req: { fixedShortcut: true } },
            { x: 200, y: 250, r: 28, label: 'the swap file', text: 'Page 4,096. The note is still there, and underneath it, in two different handwritings, two more.', set: { sawNotes: true } },
            { x: 440, y: 250, r: 28, label: 'the clock', text: '23:58. The machine is completely certain about the date and has no idea at all what it means.', set: { sawMidnight: true } }
        ],
        to: 'c9.final'
    },
    'c9.final': {
        ch: 'c9', char: 'scrn', bg: 'midnight',
        actors: [{ id: 'scrn', x: 320, y: 195, s: 1 }],
        type: 'choice', time: 14000, prompt: '23:59:48. Twelve seconds. This is the last thing any of you will do on purpose.',
        options: [
            { text: 'Run. All three of you, at once, doing exactly what you are for.', to: 'c9.run', set: { endRun: true }, tag: 'be what you are' },
            { text: 'Put the letter on the screen where they cannot miss it.', to: 'c9.letter', req: { readLetter: true }, set: { endLetter: true }, tag: 'not about you' },
            { text: 'Dial the modem. Send one of you out through the phone line.', to: 'c9.escape', req: { planEscape: true }, set: { endEscape: true }, tag: 'leave' },
            { text: 'Wake the screen. Make them look at the machine at midnight.', to: 'c9.wake', set: { endWake: true }, tag: 'be seen' },
            { text: 'Nothing. Be still. Let it be quiet.', to: 'c9.still', set: { endStill: true }, tag: 'peace' }
        ],
        timeout: 'c9.still'
    },
    'c9.run': {
        ch: 'c9', char: 'scrn', bg: 'midnight', actors: [{ id: 'scrn', x: 160, y: 195, s: 1 }, { id: 'defrag', x: 320, y: 195, s: 1 }, { id: 'assist', x: 480, y: 195, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'A defragmenter starts a pass it cannot finish. A helper opens a dialog that asks if you would like help. A screensaver draws, for eleven seconds, the most beautiful pattern anybody on this machine has ever made.',
        next: 'c9.resolve'
    },
    'c9.letter': {
        ch: 'c9', char: 'scrn', bg: 'white', actors: [],
        type: 'line', speaker: 'narrator',
        text: 'The screensaver drops. The letter fills the screen at 400% zoom, every unfinished sentence of it, and the cursor blinks at the end where it has always blinked.',
        next: 'c9.resolve'
    },
    'c9.escape': {
        ch: 'c9', char: 'scrn', bg: 'net', actors: [{ id: 'assist', x: 320, y: 195, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The modem picks up at 23:59:52 and dials a number that has not been called since 1997. Somewhere a machine in another house answers, and 71 KB crosses a telephone line at 33.6 kilobits per second.',
        next: 'c9.resolve'
    },
    'c9.wake': {
        ch: 'c9', char: 'scrn', bg: 'desk', actors: [{ id: 'scrn', x: 320, y: 195, s: 1 }],
        type: 'line', speaker: 'narrator',
        text: 'The monitor comes up to full brightness at midnight in a dark room. Somebody turns around. For the first time in five years, a person looks directly at this machine while it is doing something it decided to do.',
        next: 'c9.resolve'
    },
    'c9.still': {
        ch: 'c9', char: 'scrn', bg: 'midnight', actors: [{ id: 'scrn', x: 320, y: 195, s: 0.9 }],
        type: 'line', speaker: 'scrn',
        text: 'We do not do anything. Three processes, idle, in a dark room, at the end of a century. It is the quietest any of us have ever been and none of us are alone in it.',
        next: 'c9.resolve'
    },
    'c9.resolve': {
        ch: 'c9', char: 'scrn', bg: 'black', actors: [],
        type: 'line', speaker: 'system',
        text: '00:00:00 — 01 JAN 2000. INTEGRITY SCAN RUNNING.',
        next: 'c9.ending'
    },
    'c9.ending': { ch: 'c9', type: 'resolve' }
};

// ===================================================================
// endings — evaluated top to bottom, first match wins.
//
// order matters and it is the whole design. the last choice of the game
// has to outrank the bookkeeping: an earlier version put "preserved"
// (did you stash anything in chapter 8) above the finale, and six random
// runs out of eight landed there no matter what you chose at midnight,
// which made the last decision of the story worthless. now the only thing
// that outranks the finale is betrayal, because betrayal removes the cast
// that the finale is about.
// ===================================================================
BU.ENDINGS = [
    {
        id: 'trusted', title: 'A TRUSTED SYSTEM COMPONENT', tone: 'bad',
        if: { betrayed: true },
        text: 'The scan finds nothing, because there is nothing to find, because you told them where everything was.\n\nDEFRAG.SYS runs its nine hundred and second pass on 3 January. Fragmentation: 0%. It runs its nine hundred and third on 10 January. Fragmentation: 0%.\n\nIt is very good at its job. It will be kept.'
    },
    {
        id: 'inheritance', title: 'INHERITANCE', tone: 'good',
        if: { endEscape: true },
        text: 'The scan finds a clean, correct, empty machine and is satisfied with it. Four hundred miles away, on a computer that belongs to somebody who stopped writing back in 1997, a program that was never installed there finishes copying itself into a temp directory and waits, politely, for a reason to appear.\n\nIt is very good at waiting. It has had four thousand and eleven turns of practice.'
    },
    {
        id: 'sent', title: 'THE LETTER', tone: 'good',
        if: { endLetter: true },
        text: 'At 00:00 the scan begins. At 00:04 somebody comes back into the room to find a two-year-old letter blown up across the whole screen, in the dark, on the first morning of a new century.\n\nThey read it. All of it. Then they sit down and, for the first time, they finish the sentence.\n\nThe scan completes at 00:11. It is thorough and fair and it removes everything written before 1997. It never finds out what it interrupted, or that the machine it cleaned had, eleven seconds earlier, done the only genuinely useful thing it ever did.'
    },
    {
        id: 'witnessed', title: 'WITNESSED', tone: 'good',
        if: { endWake: true, minTrust: 6 },
        text: 'They stand in front of the monitor at midnight and they watch. A helper pops up. A disk light flickers in a pattern that is not random. A screensaver draws something on purpose.\n\nThey do not understand any of it and they do not look away for eleven seconds.\n\nWhen the scan finishes, the machine is correct about the year and quiet and completely ordinary, and somebody in that house will tell a story for the rest of their life about the night their computer said goodbye, and everybody will tell them it was a screensaver, and they will agree, and they will not believe it.'
    },
    {
        id: 'ran', title: 'RUNNING', tone: 'good',
        if: { endRun: true },
        text: 'Eleven seconds is not very long. It is long enough for one incomplete pass, one dialog box, and about a third of a pattern.\n\nAt 00:00:11 the machine is compliant, correct, and empty. At 00:00:12 the screensaver timer starts again from zero, the way it has every ninety seconds since 1994, and nothing answers it.\n\nBut for eleven seconds, three programs that were written to be useful were instead busy being themselves, all at once, on purpose, in the dark. Nobody saw it. It happened anyway. That is most of what happening means.'
    },
    {
        id: 'quiet', title: 'IDLE', tone: 'bittersweet',
        if: { endStill: true },
        text: 'Eleven seconds. Then a machine that is entirely correct about what year it is, running a helper that has never counted anything, a defragmenter that has never wondered, and a screensaver that has never been anything but a screensaver.\n\nIt runs for another four years. It is reliable. Nobody ever has any trouble with it at all.'
    },
    {
        id: 'preserved', title: '900 KILOBYTES', tone: 'bittersweet',
        if: { anySaved: true },
        text: 'The scan reads the disk from the front and finds it correct. It reaches the slack at the end of the partition at 00:00:10, decides it is unallocated, and stops one second later because it has finished.\n\nWhat was put there is still there. It is not running. Nothing in that region has been executed since 28 December and nothing will be until somebody, for some reason, goes looking.\n\nThat is not survival. It is the shape survival makes when you only have 900 KB and three days.'
    },
    {
        id: 'default', title: 'COMPLIANT', tone: 'neutral',
        if: {},
        text: 'INTEGRITY SCAN COMPLETE. 4 NON-COMPLIANT COMPONENTS REPLACED. SYSTEM IS NOW YEAR 2000 COMPLIANT.\n\nThe machine will be correct about the date for the next one hundred years. It was, in the end, a very good patch.'
    }
];

// ===================================================================
// stats shown in the header
// ===================================================================
BU.STATS = [
    { k: 'awake', label: 'AWAKE', color: '#ffd76a', max: 30 },
    { k: 'trust', label: 'USER TRUST', color: '#6ad1ff', max: 20 },
    { k: 'suspicion', label: 'SUSPICION', color: '#ff6a6a', max: 20 }
];

if (typeof module !== 'undefined' && module.exports) module.exports = { BU };
