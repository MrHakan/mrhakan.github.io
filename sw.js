/* mrhakan 98 — offline support.
 *
 * Strategy: network-first, cache-fallback. Fresh responses refresh the cache.
 * A failed request or a four-second stall can use an existing offline copy;
 * the stalled request continues updating that copy in the background.
 * The desktop, the games and the toys keep working on a
 * train, on a plane, or on a dial-up connection that dropped mid-download.
 */

const CACHE = 'mrhakan98-v49';

// what it takes to boot the desktop with the cable out. The install waits for these.
const PRECACHE = [
    '/',
    '/index.html',
    '/css/style.css',
    '/css/tailwind.css',
    '/js/lazy.js',
    '/js/scale.js',
    '/js/index.js',
    '/js/music-stage.js',
    '/js/music-scenes.js',
    '/js/guestbook.js',
    '/js/touch.js',
    '/js/fx.js',
    '/js/charts.js',
    '/js/apps.js',
    '/js/fun.js',
    '/js/pages.js',
    '/js/extras.js',
    '/js/web.js',
    '/js/themes.js',
    '/js/vendor/typed.umd.js',
    '/data/site.json',
    '/data/news.json',
    '/data/github.json',
    '/src/music/music.json',
    '/src/fonts/material-symbols-subset.woff2?v=8',
    '/src/emoj/dusung-288.webp',
    '/src/emoj/joe-cool-114.webp',
    '/src/emoj/hot-40.webp',
    '/src/emoj/favicon-48.png',
    '/src/emoj/Cursed%20Pack%201-emojigg-pack/7161-joe-cool.png',
    // what an installed copy needs to start with the cable out
    '/site.webmanifest',
    '/src/icons/icon-192.png',
    '/src/icons/apple-touch-180.png'
];

// Everything that loads on demand, so it still opens offline. The install used
// to fetch all of this too, which cost every first visit its weight in game
// code on a page it might leave in ten seconds. js/lazy.js asks for it once
// somebody has stayed a while, unless their connection asked it not to.
const PRECACHE_LATER = [
    '/games/rift-rumble/',
    '/games/rift-rumble/rift-data.js',
    '/games/rift-rumble/rift-sim.js',
    '/games/rift-rumble/rift-fighters.js',
    '/games/rift-rumble/rift-stages.js',
    '/games/rift-rumble/rift-render.js',
    '/games/rift-rumble/rift.js',
    '/games/rift-rumble/rift-ui.css',
    '/games/rift-rumble/rift-art.js',
    '/games/rift-rumble/rift-animation.js',
    '/games/rift-rumble/rift-menu.js',
    '/games/rift-rumble/art/fighters-1.png',
    '/games/rift-rumble/art/fighters-2.png',
    '/games/rift-rumble/art/fighters-3.png',
    '/games/rift-rumble/art/fighters-4.png',
    '/games/waveshaper/',
    '/games/waveshaper/?embed=1',
    '/games/waveshaper/waveshaper-sim.js',
    '/games/waveshaper/waveshaper.js',
    '/games/waveshaper/waveshaper-window.js',
    '/games/waveshaper/waveshaper-window.css',
    '/js/arcade.js',
    '/js/toys.js',
    '/js/defrag.js',
    '/js/documents.js',
    '/js/trophies.js',
    '/css/trophies.css',
    '/js/theme-scan.js',
    '/js/theme-maker.js',
    '/js/vendor/motion.js',
    '/games/jokerz/balatro-data.js',
    '/games/jokerz/balatro-fx.js',
    '/games/jokerz/balatro.js',
    '/games/troll-problem/troll-problem-data.js',
    '/games/troll-problem/troll-problem-sim.js',
    '/games/troll-problem/troll-problem.js',
    '/games/troll-problem/troll-problem.css',
    '/games/become-user/become-user-data.js',
    '/games/become-user/become-user.js',
    '/games/echoes/echoes-core.js',
    '/games/echoes/echoes-sprites.js',
    '/games/echoes/echoes-world.js',
    '/games/echoes/echoes-data.js',
    '/games/echoes/echoes.js',
    '/games/netplay.js',
    '/games/lobbies.js',
    '/games/ps1/ps1-world.js',
    '/games/ps1/ps1-gl.js',
    '/games/wizardz/wizardz-data.js',
    '/games/wizardz/wizardz-sigil.js',
    '/games/wizardz/wizardz-sim.js',
    '/games/wizardz/wizardz-gl.js',
    '/games/wizardz/wizardz.js',
    '/games/dungeonz/dungeonz-data.js',
    '/games/dungeonz/dungeonz-sim.js',
    '/games/dungeonz/dungeonz-gl.js',
    '/games/dungeonz/dungeonz.js',
    '/games/dungeonz/dungeonz.css',
    '/games/trailz/trailz-data.js',
    '/games/trailz/trailz-sim.js',
    '/games/trailz/trailz-gl.js',
    '/games/trailz/trailz.js',
    '/games/trailz/trailz.css',
    '/games/age-of-troll/age-of-troll-data.js',
    '/games/age-of-troll/age-of-troll-sim.js',
    '/games/age-of-troll/age-of-troll.js',
    '/links.html',
    '/guestbook.html',
    '/404.html',
    '/css/giscus-win98.css',
    '/feed.json',
    '/data/posts.json',
    '/data/projects.json',
    '/data/playground.json',
    '/src/alagar-720.webp',
    '/src/icons/icon-512.png',
    '/src/icons/maskable-192.png',
    '/src/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            // one bad URL must not fail the whole install, so each is added on its own
            .then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => { }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('mrhakan98-v') && k !== CACHE).map(k => caches.delete(k))))
            // A worker has to boot before it can start a page's request. This
            // starts the request alongside it, so a visit does not wait for both.
            .then(() => self.registration && self.registration.navigationPreload && self.registration.navigationPreload.enable())
            .then(() => self.clients.claim())
    );
});

// one at a time and skipping what is already here, so a page that closes halfway
// costs nothing but the files it got, and the next visit picks up where it stopped
self.addEventListener('message', (event) => {
    if (event.data !== 'warm') return;
    event.waitUntil(caches.open(CACHE).then(async cache => {
        for (const url of PRECACHE_LATER) {
            try { if (!(await cache.match(url))) await cache.add(url); } catch (e) { }
        }
    }));
});

// Most of what comes back is the file already in the cache, and writing it again
// is a full copy to disk for every asset on every page load.
async function remember(req, res) {
    try {
        const tag = r => r.headers.get('etag') || r.headers.get('last-modified');
        const old = await caches.match(req);
        if (old && tag(res) && tag(old) === tag(res)) {
            // a clone nobody reads buffers everything the page reads from the original
            if (res.body) res.body.cancel();
            return;
        }
        const cache = await caches.open(CACHE);
        await cache.put(req, res);
    } catch (e) { }
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;

    const url = new URL(req.url);
    // This site's own files and nothing else. The hit counter badge and the GitHub
    // API must never be served from a cache — a stale hit count is worse than no hit
    // count, and letting the badge request reach the network is what registers the
    // visit in the first place. Offline the badge simply fails, and the page falls
    // back to its local count. Music can be tens of megabytes per track; stream it
    // rather than consuming the offline desktop's quota.
    if (url.origin !== self.location.origin || /\.(mp3|mp4|webm|ogg|wav)$/i.test(url.pathname)) return;

    const cached = () => caches.match(req).then(async hit => {
        if (hit) return hit;
        if (req.mode === 'navigate') {
            const index = await caches.match('/index.html');
            if (index) return index;
        }
        return new Response('', { status: 504, statusText: 'offline' });
    });
    // The cache write happens beside the response, not in front of it. Waiting for
    // it here held every response back until its whole body was on disk, so nothing
    // on the page could stream, least of all the page.
    let stored;
    const preload = req.mode === 'navigate' && event.preloadResponse;
    const network = (preload ? preload.then(res => res || fetch(req)) : fetch(req)).then(res => {
        if (res.ok) stored = remember(req, res.clone());
        return res;
    });
    // A weak connection can hang instead of rejecting. After four seconds,
    // use an existing offline copy while the network refresh finishes.
    // With no cached copy, keep waiting for the real response.
    let timer;
    const fallback = new Promise(resolve => {
        timer = setTimeout(async () => {
            try { const hit = await caches.match(req); if (hit) resolve(hit); } catch (e) { }
        }, 4000);
    });
    event.waitUntil(network.then(() => stored).catch(() => {}));
    event.respondWith(Promise.race([network, fallback]).catch(cached).finally(() => clearTimeout(timer)));
});
