import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('sw.js', 'utf8');
const currentCache = source.match(/const CACHE = ['"]([^'"]+)['"]/)[1];
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('  ok    ' + name); }
function setup(fetchImpl, hits = new Map(), options = {}) {
    const handlers = {}, deleted = [], put = [], added = [], timers = new Map();
    const preload = { enabled: false };
    const caches = {
        keys: async () => ['mrhakan98-v21', 'mrhakan98-v23', currentCache, 'unrelated-cache'],
        delete: async key => deleted.push(key),
        match: async req => hits.get(typeof req === 'string' ? req : req.url),
        open: async () => ({
            put: options.slowPut ? () => new Promise(() => {}) : async req => put.push(req.url),
            add: async url => added.push(url),
            match: async url => hits.get(url)
        })
    };
    vm.runInNewContext(source, { self: { location: { origin: 'https://mrhakan.github.io' }, addEventListener: (type, fn) => handlers[type] = fn, clients: { claim: async () => {} },
            registration: { navigationPreload: { enable: async () => { preload.enabled = true; } } } },
        caches, fetch: fetchImpl, URL, Response,
        setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) });
    function request(path, options = {}) {
        const jobs = []; let response;
        const { preloadResponse, ...request } = options;
        handlers.fetch({ request: { method: 'GET', url: 'https://mrhakan.github.io' + path, mode: 'cors', headers: new Headers(), ...request },
            preloadResponse, waitUntil: p => jobs.push(p), respondWith: p => response = p });
        return { response, jobs };
    }
    return { handlers, deleted, put, added, timers, request, preload };
}
await test('activation cleans only older versions of this site cache', async () => {
    const env = setup(); let job;
    env.handlers.activate({ waitUntil: p => job = p }); await job;
    assert.deepEqual(env.deleted, ['mrhakan98-v21', 'mrhakan98-v23']);
});
await test('streamed media, range requests and external resources bypass caching', async () => {
    const env = setup(() => { throw new Error('must bypass'); });
    for (const [path, opts] of [['/song.mp3', {}], ['/index.html', {headers: new Headers({range: 'bytes=0-10'})}], ['/api', {url: 'https://api.github.com/repos/test'}], ['/image', {url: 'https://other.example/image.png'}]]) {
        assert.equal(env.request(path, opts).response, undefined);
    }
});
await test('online responses refresh cached assets', async () => {
    const env = setup(async () => new Response('new'));
    const request = env.request('/index.html');
    assert.equal(await (await request.response).text(), 'new');
    await Promise.all(request.jobs);
    assert.deepEqual(env.put, ['https://mrhakan.github.io/index.html']);
    assert.equal(env.timers.size, 0);
});
await test('a response is handed over without waiting for its cache write', async () => {
    const env = setup(async () => new Response('new'), new Map(), { slowPut: true });
    assert.equal(await (await env.request('/index.html').response).text(), 'new');
});
await test('a file that has not changed is not written to disk again', async () => {
    const tagged = (body, etag) => new Response(body, { headers: { etag } });
    const url = 'https://mrhakan.github.io/game.js';
    const same = setup(async () => tagged('v1', 'a'), new Map([[url, tagged('v1', 'a')]]));
    const first = same.request('/game.js');
    assert.equal(await (await first.response).text(), 'v1');
    await Promise.all(first.jobs);
    assert.deepEqual(same.put, []);
    const changed = setup(async () => tagged('v2', 'b'), new Map([[url, tagged('v1', 'a')]]));
    const second = changed.request('/game.js');
    assert.equal(await (await second.response).text(), 'v2');
    await Promise.all(second.jobs);
    assert.deepEqual(changed.put, [url]);
});
await test('a page load uses the request navigation preload already started', async () => {
    const env = setup(() => { throw new Error('should not start a second request'); });
    const page = env.request('/', { mode: 'navigate', preloadResponse: Promise.resolve(new Response('preloaded')) });
    assert.equal(await (await page.response).text(), 'preloaded');
    let job; env.handlers.activate({ waitUntil: p => job = p }); await job;
    assert.equal(env.preload.enabled, true);
});
await test('without one it fetches as usual', async () => {
    const env = setup(async () => new Response('fetched'));
    const page = env.request('/', { mode: 'navigate', preloadResponse: Promise.resolve(undefined) });
    assert.equal(await (await page.response).text(), 'fetched');
});
await test('the on-demand files are fetched when asked, and only the ones that are missing', async () => {
    const env = setup(async () => new Response(''), new Map([['/js/arcade.js', new Response('here already')]]));
    let job; env.handlers.message({ data: 'warm', waitUntil: p => job = p }); await job;
    assert.ok(env.added.includes('/games/echoes/echoes.js'));
    assert.ok(!env.added.includes('/js/arcade.js'));
    job = null; env.handlers.message({ data: 'something else', waitUntil: p => job = p });
    assert.equal(job, null);
});
await test('network failure returns a cached asset or navigation fallback', async () => {
    const env = setup(async () => { throw new Error('offline'); }, new Map([['https://mrhakan.github.io/game.js', new Response('game')], ['/index.html', new Response('desktop')]]));
    assert.equal(await (await env.request('/game.js').response).text(), 'game');
    assert.equal(await (await env.request('/unknown', {mode: 'navigate'}).response).text(), 'desktop');
});
await test('everything the desktop needs offline is its own file', async () => {
    assert.ok(!/cdn\.tailwindcss/.test(source));
    assert.ok(source.includes("'/css/tailwind.css'"));
});
await test('an empty offline cache returns a real 504 response', async () => {
    const env = setup(async () => { throw new Error('offline'); });
    assert.equal((await env.request('/unknown', {mode: 'navigate'}).response).status, 504);
});
await test('a stalled network uses existing cache and still refreshes later', async () => {
    let finish;
    const env = setup(() => new Promise(resolve => finish = resolve), new Map([['https://mrhakan.github.io/index.html', new Response('saved')]]));
    const request = env.request('/index.html');
    await env.timers.get(1)();
    assert.equal(await (await request.response).text(), 'saved');
    finish(new Response('fresh')); await Promise.all(request.jobs);
    assert.equal(env.put.length, 1);
});
await test('timeout without a cached asset keeps waiting for the network', async () => {
    let finish;
    const env = setup(() => new Promise(resolve => finish = resolve));
    const request = env.request('/new.js'); await env.timers.get(1)();
    finish(new Response('downloaded'));
    assert.equal(await (await request.response).text(), 'downloaded');
});
console.log(`\n${checks} offline regression checks passed.`);
