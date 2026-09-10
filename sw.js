/* mrhakan 98 — offline support.
 *
 * Strategy: network-first, cache-fallback. Fresh responses refresh the cache.
 * A failed request or a four-second stall can use an existing offline copy;
 * the stalled request continues updating that copy in the background.
 * The desktop, the games and the toys keep working on a
 * train, on a plane, or on a dial-up connection that dropped mid-download.
 */

const CACHE = 'mrhakan98-v23';

// the bits worth having warm before the connection dies
const PRECACHE = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/index.js',
    '/js/guestbook.js',
    '/js/touch.js',
    '/js/fx.js',
    '/js/charts.js',
    '/js/defrag.js',
    '/js/documents.js',
    '/js/apps.js',
    '/js/fun.js',
    '/js/pages.js',
    '/js/extras.js',
    '/js/web.js',
    '/js/arcade.js',
    '/js/toys.js',
    '/js/themes.js',
    '/js/theme-scan.js',
    '/js/theme-maker.js',
    '/games/jokerz/balatro-data.js',
    '/games/jokerz/balatro-fx.js',
    '/games/jokerz/balatro.js',
    '/games/troll-problem/troll-problem-data.js',
    '/games/troll-problem/troll-problem.js',
    '/games/become-user/become-user-data.js',
    '/games/become-user/become-user.js',
    '/games/echoes/echoes-core.js',
    '/games/echoes/echoes-sprites.js',
    '/games/echoes/echoes-world.js',
    '/games/echoes/echoes-data.js',
    '/games/echoes/echoes.js',
    '/games/netplay.js',
    '/games/wizardz/wizardz-data.js',
    '/games/wizardz/wizardz.js',
    '/links.html',
    '/guestbook.html',
    '/404.html',
    '/js/vendor/typed.umd.js',
    '/css/giscus-win98.css',
    '/feed.json',
    '/data/site.json',
    '/data/posts.json',
    '/data/github.json',
    '/data/projects.json',
    '/src/fonts/material-symbols-subset.woff2',
    '/src/emoj/dusung.png',
    '/src/emoj/Cursed%20Pack%201-emojigg-pack/7161-joe-cool.png'
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
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;

    const url = new URL(req.url);
    // the hit counter badge and the GitHub API must never be served from a cache —
    // a stale hit count is worse than no hit count, and letting the badge request
    // reach the network is what registers the visit in the first place. Offline the
    // badge simply fails, and the page falls back to its local count.
    if (url.hostname.includes('komarev.com') || url.hostname.includes('api.github.com')) return;
    // Music can be tens of megabytes per track; stream it rather than consuming
    // the offline desktop's quota. Keep the desktop's Tailwind dependency
    // available offline too; unrelated third-party responses bypass this cache.
    const desktopCDN = url.hostname === 'cdn.tailwindcss.com';
    if ((url.origin !== self.location.origin && !desktopCDN) || /\.(mp3|mp4|webm|ogg|wav)$/i.test(url.pathname)) return;

    const cached = () => caches.match(req).then(async hit => {
        if (hit) return hit;
        if (req.mode === 'navigate') {
            const index = await caches.match('/index.html');
            if (index) return index;
        }
        return new Response('', { status: 504, statusText: 'offline' });
    });
    const network = fetch(req).then(async res => {
        if (res.ok || (desktopCDN && res.type === 'opaque')) {
            try { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); } catch (e) { }
        }
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
    event.waitUntil(network.catch(() => {}));
    event.respondWith(Promise.race([network, fallback]).catch(cached).finally(() => clearTimeout(timer)));
});
