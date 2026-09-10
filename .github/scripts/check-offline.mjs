import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('sw.js', 'utf8');
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('  ok    ' + name); }
function setup(fetchImpl, hits = new Map()) {
    const handlers = {}, deleted = [], put = [], timers = new Map();
    const caches = {
        keys: async () => ['mrhakan98-v21', 'mrhakan98-v23', 'unrelated-cache'],
        delete: async key => deleted.push(key),
        match: async req => hits.get(typeof req === 'string' ? req : req.url),
        open: async () => ({ put: async req => put.push(req.url), add: async () => {} })
    };
    vm.runInNewContext(source, { self: { location: { origin: 'https://mrhakan.github.io' }, addEventListener: (type, fn) => handlers[type] = fn, clients: { claim: async () => {} } },
        caches, fetch: fetchImpl, URL, Response,
        setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) });
    function request(path, options = {}) {
        const jobs = []; let response;
        handlers.fetch({ request: { method: 'GET', url: 'https://mrhakan.github.io' + path, mode: 'cors', headers: new Headers(), ...options },
            waitUntil: p => jobs.push(p), respondWith: p => response = p });
        return { response, jobs };
    }
    return { handlers, deleted, put, timers, request };
}
await test('activation cleans only older versions of this site cache', async () => {
    const env = setup(); let job;
    env.handlers.activate({ waitUntil: p => job = p }); await job;
    assert.deepEqual(env.deleted, ['mrhakan98-v21']);
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
    assert.deepEqual(env.put, ['https://mrhakan.github.io/index.html']);
    assert.equal(env.timers.size, 0);
});
await test('network failure returns a cached asset or navigation fallback', async () => {
    const env = setup(async () => { throw new Error('offline'); }, new Map([['https://mrhakan.github.io/game.js', new Response('game')], ['/index.html', new Response('desktop')]]));
    assert.equal(await (await env.request('/game.js').response).text(), 'game');
    assert.equal(await (await env.request('/unknown', {mode: 'navigate'}).response).text(), 'desktop');
});
await test('the desktop Tailwind dependency remains available offline', async () => {
    const url = 'https://cdn.tailwindcss.com/?plugins=forms,container-queries';
    const env = setup(async () => { throw new Error('offline'); }, new Map([[url, new Response('tailwind')]]));
    assert.equal(await (await env.request('/cdn', {url}).response).text(), 'tailwind');
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
