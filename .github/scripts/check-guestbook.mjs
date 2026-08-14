// ===================================================================
// check-guestbook.mjs — tests for the thing that commits strangers' text
//
// The guestbook is the one place on this site where somebody else's
// writing ends up in the repository, committed by a robot with write
// access. So this leans on the parser: html, control characters,
// javascript: links, path traversal through the name, giant payloads,
// and the ordinary case of somebody just saying hello.
//
//   node .github/scripts/check-guestbook.mjs
// ===================================================================
import fs from 'fs';
import path from 'path';
import { parseSubmission, extractJson, kindFromTitle, entryFileContents, KINDS }
    from './guestbook-entry.mjs';

const ROOT = process.cwd();
let failures = 0, checks = 0;
const ok = (m) => { checks++; console.log('  ok    ' + m); };
const bad = (m, d) => { checks++; failures++; console.log('  FAIL  ' + m + (d ? '\n        ' + d : '')); };
const expect = (c, m, d) => c ? ok(m) : bad(m, d);
const section = (n) => console.log('\n== ' + n + ' ==');

const fence = (obj) => '```json\n' + JSON.stringify(obj, null, 4) + '\n```';
const sign = (obj, over = {}) => parseSubmission(Object.assign({
    title: 'guestbook: someone', body: fence(obj), login: 'visitor'
}, over));

// ===================================================================
section('the ordinary case');
// ===================================================================
{
    const r = sign({ name: 'mrhakan', message: 'nigeria\'dan selamlar', website: 'mrhakan.github.io' });
    expect(r.ok, 'a normal signing is accepted', r.reason);
    expect(r.entry.name === 'mrhakan' && /selamlar/.test(r.entry.message), 'name and message survive', JSON.stringify(r.entry));
    expect(r.entry.website === 'https://mrhakan.github.io/', 'a bare domain becomes an https link', r.entry.website);
    expect(r.entry.by === 'visitor', 'the github account that submitted it is recorded', JSON.stringify(r.entry));
    expect(/^data\/guestbook\/\d+-mrhakan\.json$/.test(r.path), 'the path is built from a slug', r.path);
    expect(!!r.entry.date && !!r.entry.timestamp, 'it is dated');

    const s = parseSubmission({ title: 'shout: bob', body: fence({ name: 'bob', message: 'wassup', website: 'http://x.com' }), login: 'bob' });
    expect(s.ok && s.kind === 'shouts', 'a shout goes to the shoutbox', JSON.stringify(s));
    expect(s.ok && !s.entry.website, 'shouts carry no website field', JSON.stringify(s.entry));
    expect(kindFromTitle('GUESTBOOK: x') === 'guestbook' && kindFromTitle('random issue') === null,
        'only the two title prefixes are recognised');
}

// ===================================================================
section('things people paste that should not land');
// ===================================================================
{
    const xss = sign({ name: '<script>alert(1)</script>hax', message: 'hi <img src=x onerror=alert(1)>' });
    expect(xss.ok && !/[<>]/.test(xss.entry.name + xss.entry.message), 'markup is stripped from name and message',
        JSON.stringify(xss.entry));

    const js = sign({ name: 'a', message: 'b', website: 'javascript:alert(1)' });
    expect(js.ok && !js.entry.website, 'a javascript: link is refused', js.entry.website);
    const data = sign({ name: 'a', message: 'b', website: 'data:text/html,<script>x</script>' });
    expect(data.ok && !data.entry.website, 'a data: link is refused', data.entry.website);
    const local = sign({ name: 'a', message: 'b', website: 'file:///etc/passwd' });
    expect(local.ok && !local.entry.website, 'a file: link is refused', local.entry.website);

    const traversal = sign({ name: '../../../../index', message: 'hi' });
    expect(traversal.ok && traversal.path.startsWith('data/guestbook/') && !traversal.path.includes('..'),
        'a name full of ../ cannot steer the file anywhere', traversal.path);
    const slashes = sign({ name: 'a/b\\c', message: 'hi' });
    expect(slashes.ok && (slashes.path.match(/\//g) || []).length === 2, 'slashes in a name do not become directories', slashes.path);

    const long = sign({ name: 'n'.repeat(500), message: 'm'.repeat(5000) });
    expect(long.ok && long.entry.name.length <= KINDS.guestbook.name && long.entry.message.length <= KINDS.guestbook.message,
        'oversized fields are clipped', `${long.entry.name.length}/${long.entry.message.length}`);

    const control = sign({ name: 'a\u0007b', message: 'line\nbreak\u200bhere' });
    expect(control.ok && !/[\u0000-\u001f\u200b-\u200f]/.test(control.entry.name + control.entry.message),
        'control characters and zero-width tricks are removed', JSON.stringify(control.entry));

    const extra = sign({ name: 'a', message: 'b', by: 'someoneelse', path: '../../evil', admin: true });
    expect(extra.ok && extra.entry.by === 'visitor' && extra.entry.admin === undefined && extra.entry.path === undefined,
        'fields the body invented are ignored, including a forged "by"', JSON.stringify(extra.entry));
}

// ===================================================================
section('things that are not entries at all');
// ===================================================================
{
    expect(!parseSubmission({ title: 'my site is broken', body: 'the guestbook does not load', login: 'x' }).ok,
        'an ordinary issue is not treated as a signing');
    expect(!sign({ name: '', message: 'hi' }).ok, 'no name is refused');
    expect(!sign({ name: 'a', message: '   ' }).ok, 'an empty message is refused');
    expect(!parseSubmission({ title: 'guestbook: x', body: 'no json here', login: 'x' }).ok,
        'a body with no entry in it is refused');
    expect(!parseSubmission({ title: 'guestbook: x', body: '```json\n[1,2,3]\n```', login: 'x' }).ok,
        'an array instead of an object is refused');
    expect(extractJson('```json\n{"name":"a"}\n```') !== null && extractJson('') === null,
        'the json fence reader handles both');
    // a body written by hand, without the fence
    const bare = parseSubmission({ title: 'guestbook: x', body: 'hello!\n{"name":"hand","message":"typed it myself"}', login: 'x' });
    expect(bare.ok && bare.entry.name === 'hand', 'a hand-written entry without a fence still works', JSON.stringify(bare));
}

// ===================================================================
section('the file it writes');
// ===================================================================
{
    const r = sign({ name: 'mrhakan', message: 'hi' });
    const text = entryFileContents(r.entry);
    expect(text.endsWith('\n'), 'the file ends with a newline, like the ones already in the repo');
    expect(JSON.stringify(JSON.parse(text)) === JSON.stringify(r.entry), 'it round-trips as json');
    // the shape has to match what the site renders
    const existing = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/guestbook/0000000000000-mrhakan.json'), 'utf8'));
    expect(Object.keys(existing).every(k => ['name', 'message', 'date', 'timestamp', 'website', 'by'].includes(k)),
        'the fields match the entries already on the site', Object.keys(existing).join(', '));
}

// ===================================================================
section('wired up');
// ===================================================================
{
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/guestbook.yml'), 'utf8');
    expect(/on:\s*\n\s*issues:/.test(wf), 'the workflow triggers on issues');
    expect(/contents: write/.test(wf) && /issues: write/.test(wf), 'it can commit and can answer');
    expect(/ISSUE_BODY: \$\{\{ github\.event\.issue\.body \}\}/.test(wf),
        'the issue body reaches the script through the environment, not through a shell');
    expect(!/run:[^\n]*\$\{\{ *github\.event\.issue\.(body|title) *\}\}/.test(wf),
        'no run: line interpolates what a stranger wrote');
    expect(/startsWith\(github\.event\.issue\.title, 'guestbook:'\)/.test(wf),
        'ordinary issues never start a runner');
    expect(/concurrency:/.test(wf), 'two signings at once cannot race on the same branch');

    const site = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    expect(/function submitViaIssue/.test(site), 'the site opens an issue');
    expect(!/submitViaPullRequest/.test(site), 'and no longer asks anyone to fork the repo');
    expect(/issues\/new\?title=/.test(site), 'with the entry pre-filled');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // "no forking, no pull request" is fine; promising one is not
    expect(!/(via|through|opens?) (a )?github pull request|create pull request|propose changes|approves the pr/i.test(html),
        'the guestbook blurb no longer promises a pull request flow');
    expect(/signing opens a github issue/i.test(html), 'and says what actually happens instead');
}

// ===================================================================
section('the bot, against a stub github');
//
// The parser is only half of it: this runs guestbook-bot.mjs for real
// against a fake api and checks what it actually does — which file it
// writes, what it says, and that it closes up after itself.
// ===================================================================
{
    const http = await import('http');
    const { spawn } = await import('child_process');
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
            res.writeHead(200, { 'content-type': 'application/json' });
            if (req.url.startsWith('/search/issues')) res.end(JSON.stringify({ total_count: 1, items: [] }));
            else res.end(JSON.stringify({ ok: true, content: { path: 'x' } }));
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;

    const run = (env) => new Promise((resolve) => {
        const child = spawn(process.execPath, ['.github/scripts/guestbook-bot.mjs'], {
            cwd: ROOT,
            env: Object.assign({}, process.env, { GITHUB_API: base, GITHUB_TOKEN: 'test', GITHUB_REPOSITORY: 'MrHakan/mrhakan.github.io' }, env),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => out += d);
        child.on('close', code => resolve({ code, out }));
    });

    const good = await run({
        ISSUE_NUMBER: '42', ISSUE_TITLE: 'guestbook: someone',
        ISSUE_BODY: '```json\n{"name":"someone","message":"hello from the internet","website":"example.com"}\n```',
        ISSUE_AUTHOR: 'visitor'
    });
    expect(good.code === 0, 'the bot runs a good submission cleanly', good.out.slice(0, 300));
    const put = calls.find(c => c.method === 'PUT');
    expect(!!put && /\/contents\/data\/guestbook\/\d+-someone\.json$/.test(put.url), 'it writes the entry file',
        put && put.url);
    const written = put && JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8'));
    expect(written && written.name === 'someone' && written.by === 'visitor' && written.website === 'https://example.com/',
        'with the sanitised entry inside', JSON.stringify(written));
    expect(!!put && /guestbook: add entry from someone/.test(put.body.message), 'and an honest commit message', put && put.body.message);
    const posted = calls.filter(c => c.method === 'POST').map(c => c.url);
    expect(posted.some(u => /\/issues\/42\/comments$/.test(u)), 'it answers the issue', posted.join(', '));
    expect(posted.some(u => /\/issues\/42\/labels$/.test(u)), 'and labels it', posted.join(', '));
    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch && patch.body.state === 'closed' && patch.body.state_reason === 'completed', 'and closes it as done',
        JSON.stringify(patch && patch.body));

    calls.length = 0;
    const junk = await run({
        ISSUE_NUMBER: '43', ISSUE_TITLE: 'guestbook: nobody', ISSUE_BODY: 'i just want to complain', ISSUE_AUTHOR: 'visitor'
    });
    expect(junk.code === 0 && !calls.some(c => c.method === 'PUT'), 'an unparseable submission writes nothing',
        JSON.stringify(calls.map(c => c.method + ' ' + c.url)));
    const junkPatch = calls.find(c => c.method === 'PATCH');
    expect(junkPatch && junkPatch.body.state_reason === 'not_planned', 'and is closed as not planned',
        JSON.stringify(junkPatch && junkPatch.body));

    calls.length = 0;
    const other = await run({
        ISSUE_NUMBER: '44', ISSUE_TITLE: 'the site is broken on my phone', ISSUE_BODY: 'nothing loads', ISSUE_AUTHOR: 'visitor'
    });
    expect(other.code === 0 && calls.length === 0, 'an ordinary issue is left completely alone',
        JSON.stringify(calls.map(c => c.method + ' ' + c.url)));

    server.close();
}

console.log('\n' + '='.repeat(58));
console.log(failures ? `${failures} of ${checks} checks failed` : `all ${checks} checks passed`);
process.exit(failures ? 1 : 0);
