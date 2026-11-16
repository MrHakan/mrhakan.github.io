// Metadata repair is opt-in; check mode must never mutate the page.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'playground-metadata.mjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playground-metadata-'));
const file = path.join(root, 'games/example/index.html');
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.mkdir(path.join(root, 'data'));
await fs.writeFile(path.join(root, 'data/playground.json'), JSON.stringify([{ url: '/games/example/' }]));
const source = '<!doctype html><html lang="en"><head><meta name="description" content="Route &amp; dock safely."><title>⚓ Example 98 · Playground</title></head><body><main>unchanged</main></body></html>';
const run = (...args) => spawnSync(process.execPath, [tool, '--root', root, ...args], { encoding: 'utf8' });
let checks = 0;
await fs.writeFile(file, source);
const check = run('--check');
assert.equal(check.status, 1, 'missing metadata fails preflight');
assert.match(check.stderr, /Open Graph/, 'the error identifies missing Open Graph metadata, not a missing executable');
assert.equal(await fs.readFile(file, 'utf8'), source, 'check mode leaves the file alone');
checks++;
const write = run('--write');
assert.equal(write.status, 0, write.stderr);
const fixed = await fs.readFile(file, 'utf8');
assert.match(fixed, /property="og:title" content="⚓ Example 98"/);
assert.match(fixed, /property="og:description" content="Route &amp; dock safely\."/);
assert.equal(fixed.slice(fixed.indexOf('</head>')), source.slice(source.indexOf('</head>')), 'repair changes no body or game code');
assert.equal(run('--check').status, 0);
assert.equal(run('--write').status, 0);
assert.equal(await fs.readFile(file, 'utf8'), fixed, 'a second repair is byte-for-byte idempotent');
checks++;
// Custom social copy is not the tool's to rewrite; attribute order is irrelevant.
const custom = source.replace('</head>', '<META content="custom title" PROPERTY="og:title"><meta content="custom &quot;description&quot;" property="og:description"></head>');
await fs.writeFile(file, custom);
assert.equal(run('--check').status, 0);
assert.equal(run('--write').status, 0);
assert.equal(await fs.readFile(file, 'utf8'), custom);
checks++;
const partial = source.replace('</head>', () => '<!-- <meta property="og:description" content="fake"> --><META data-note=\'property="og:description"\' content="Custom > &#38; $&amp;" PROPERTY="og:title"></head>');
await fs.writeFile(file, partial);
const partialWrite = run('--write');
assert.equal(partialWrite.status, 0, partialWrite.stderr);
const partialFixed = partial.replace('</head>', '<meta property="og:description" content="Route &amp; dock safely."></head>');
assert.equal(await fs.readFile(file, 'utf8'), partialFixed, 'repair preserves every byte of real custom social copy');
assert.equal(run('--check').status, 0);
assert.equal(run('--write').status, 0);
assert.equal(await fs.readFile(file, 'utf8'), partialFixed, 'partial repair is idempotent');
checks++;
// Replacement-string dollar sequences are page text, never replacement directives.
const dollars = "Earn $& $$ $' $` credits";
const dollarSource = source.replace('⚓ Example 98', () => dollars)
    .replace('Route &amp; dock safely.', () => dollars);
await fs.writeFile(file, dollarSource);
const dollarWrite = run('--write');
assert.equal(dollarWrite.status, 0, dollarWrite.stderr);
const escapedDollars = dollars.replace(/&/g, '&amp;');
const dollarAdd = `<meta property="og:title" content="${escapedDollars}"><meta property="og:description" content="${escapedDollars}">`;
assert.equal(await fs.readFile(file, 'utf8'), dollarSource.replace('</head>', () => dollarAdd + '</head>'), 'dollar sequences survive without duplicating head or body');
assert.equal(run('--check').status, 0);
checks++;
// Existing references retain their syntax; only raw attribute delimiters are escaped.
const entities = '&#38; &#x26; &copy; &amp; &quot; &lt; &gt; raw & "quoted"';
const entitySource = `<!doctype html><head><title>${entities}</title><meta name="description" content='${entities}'></head><body>unchanged</body>`;
const escapedEntities = '&#38; &#x26; &copy; &amp; &quot; &lt; &gt; raw &amp; &quot;quoted&quot;';
await fs.writeFile(file, entitySource);
const entityWrite = run('--write');
assert.equal(entityWrite.status, 0, entityWrite.stderr);
assert.equal(await fs.readFile(file, 'utf8'), entitySource.replace('</head>', () => `<meta property="og:title" content="${escapedEntities}"><meta property="og:description" content="${escapedEntities}"></head>`));
assert.equal(run('--check').status, 0);
checks++;
// Only live, complete head tags count; quoted delimiters and raw-text blocks are opaque.
const parserFixtures = [
    ['commented social tags', source.replace('</head>', '<!-- <meta property="og:title" content="fake"><meta property="og:description" content="fake"> --></head>')],
    ['complete attribute names', source.replace('</head>', '<meta data-property="og:title" content="fake"><meta data-property="og:description" content="fake"></head>')],
    ['quoted angle brackets', source.replace('Route &amp; dock safely.', 'Speed > 5 &amp; < safe.'), 'Speed &gt; 5 &amp; &lt; safe.'],
    ['head-like comment', source.replace('<head>', '<!-- <head></head> --><head>')],
    ['head-like attribute', source.replace('<head>', '<head data-note="</head> > ignored">')],
    ['head-like script and style', source.replace('<head>', '<head><script>const fake = \'</head><meta property="og:title" content="fake"><title>Wrong</title>\';</script><style>/* </head><meta property="og:description" content="fake"> */</style>')],
    ['commented title and description', source.replace('<head>', '<head><!-- <title>Wrong</title><meta name="description" content="fake"> -->')]
];
const parserFailures = [];
for (const [name, html, description = 'Route &amp; dock safely.'] of parserFixtures) {
    await fs.writeFile(file, html);
    const check = run('--check');
    const write = run('--write');
    const end = html.lastIndexOf('</head>');
    const expected = html.slice(0, end) + `<meta property="og:title" content="⚓ Example 98"><meta property="og:description" content="${description}">` + html.slice(end);
    if (check.status !== 1 || write.status !== 0 || await fs.readFile(file, 'utf8') !== expected || run('--check').status !== 0) parserFailures.push(name);
    checks++;
}
assert.deepEqual(parserFailures, [], 'head parsing must preserve the document and ignore fake metadata');
// A social tag without usable content must not count as valid metadata or be duplicated.
const emptyFailures = [];
for (const property of ['og:title', 'og:description']) {
    for (const content of ['', ' content=""', ' content="  "', ' data-content="fake"']) {
        const html = custom.replace(new RegExp('<(?:META|meta) content="[^"]*" (?:PROPERTY|property)="' + property + '">'), `<meta property="${property}"${content}>`);
        await fs.writeFile(file, html);
        const check = run('--check'), write = run('--write');
        if (check.status !== 1 || write.status !== 1 || await fs.readFile(file, 'utf8') !== html) emptyFailures.push(property + content);
        checks++;
    }
}
assert.deepEqual(emptyFailures, [], 'empty or missing social content fails safely without changing custom copy');
// Validate all pages before writing any, and never follow a catalog path outside root.
await fs.writeFile(file, source);
await fs.writeFile(path.join(root, 'data/playground.json'), JSON.stringify([{ url: '/games/example/' }, { url: '/games/../../escape/' }]));
assert.equal(run('--write').status, 1);
assert.equal(await fs.readFile(file, 'utf8'), source);
checks++;
// A valid catalog slug can still escape through a real filesystem symlink.
const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'playground-metadata-outside-'));
const outsideFile = path.join(outside, 'index.html');
await fs.writeFile(outsideFile, source);
await fs.symlink(outside, path.join(root, 'games/outside'), 'dir');
await fs.writeFile(path.join(root, 'data/playground.json'), JSON.stringify([{ url: '/games/example/' }, { url: '/games/outside/' }]));
const symlinkCheck = run('--check'), symlinkWrite = run('--write');
assert.equal(symlinkCheck.status, 1);
assert.equal(symlinkWrite.status, 1);
assert.match(symlinkWrite.stderr, /outside the chosen root/);
assert.equal(await fs.readFile(file, 'utf8'), source, 'prevalidation leaves earlier repairable pages unchanged');
assert.equal(await fs.readFile(outsideFile, 'utf8'), source, 'the symlink target is never written');
checks++;
await fs.writeFile(path.join(root, 'data/playground.json'), JSON.stringify([{ url: '/games/example/' }]));
await fs.writeFile(file, source.replace('<meta name="description" content="Route &amp; dock safely.">', ''));
const invalid = run('--write');
assert.equal(invalid.status, 1);
assert.match(invalid.stderr, /description/);
checks++;
console.log(`${checks} playground metadata workflow checks passed.`);
