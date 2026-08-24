/* mrhakan 98 — offline support.
 *
 * Strategy: network-first, cache-fallback. The network always wins while you
 * are online, so a deploy is visible on the next reload and nothing ever goes
 * stale. The cache only steps in when the network doesn't answer — which is
 * the whole point: the desktop, the games and the toys keep working on a
 * train, on a plane, or on a dial-up connection that dropped mid-download.
 */

const CACHE = 'mrhakan98-v19';

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
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // the hit counter badge and the GitHub API must never be served from a cache —
    // a stale hit count is worse than no hit count, and letting the badge request
    // reach the network is what registers the visit in the first place. Offline the
    // badge simply fails, and the page falls back to its local count.
    if (url.hostname.includes('komarev.com') || url.hostname.includes('api.github.com')) return;

    event.respondWith(
        fetch(req)
            .then((res) => {
                // stash a copy for the offline case (opaque CDN responses included,
                // they replay fine from a <script>/<link> tag)
                if (res && (res.ok || res.type === 'opaque')) {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => { });
                }
                return res;
            })
            .catch(() => caches.match(req).then(hit => {
                if (hit) return hit;
                // navigations that were never cached still deserve a real page
                if (req.mode === 'navigate') return caches.match('/index.html');
                return new Response('', { status: 504, statusText: 'offline' });
            }))
    );
});
