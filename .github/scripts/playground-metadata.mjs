// Check the social metadata before publishing a Playground drop. --write is opt-in:
// derive only missing OG fields from the page's own title/description, never from guesses.
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
    console.log('node .github/scripts/playground-metadata.mjs [--check | --write] [--root directory]');
    process.exit(0);
}
let root = process.cwd(), write = false;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[++i]);
    else if (args[i] === '--write') write = true;
    else if (args[i] !== '--check') throw new Error('unknown option: ' + args[i]);
}
if (args.includes('--check') && write) throw new Error('choose --check or --write, not both');
root = await fs.realpath(root);
const errors = [], changes = [];
const attr = (tag, key) => tag?.[key];
// Scan just the head: comments, quoted attributes and raw-text elements are opaque.
const readHead = html => {
    const tags = [];
    let inside = false, title, offset = 0;
    while (offset < html.length) {
        const start = html.indexOf('<', offset);
        if (start < 0) break;
        if (html.startsWith('<!--', start)) {
            const end = html.indexOf('-->', start + 4);
            offset = end < 0 ? html.length : end + 3;
            continue;
        }
        const match = html.slice(start).match(/^<(\/?)([a-z][\w:-]*)(?=[\s/>])/i);
        if (!match) { offset = start + 1; continue; }
        const closing = !!match[1], name = match[2].toLowerCase();
        let end = start + match[0].length, quote = '';
        for (; end < html.length; end++) {
            const char = html[end];
            if (quote) { if (char === quote) quote = ''; }
            else if (char === '"' || char === "'") quote = char;
            else if (char === '>') break;
        }
        if (end === html.length) break;
        offset = end + 1;
        if (name === 'head') {
            if (closing && inside) return { tags, title, end: start };
            if (!closing) inside = true;
        }
        if (!closing && /^(script|style|title)$/.test(name)) {
            const close = new RegExp('</' + name + '\\s*>', 'gi');
            close.lastIndex = offset;
            const rawEnd = close.exec(html);
            if (!rawEnd) break;
            if (inside && name === 'title' && title === undefined) title = html.slice(offset, rawEnd.index);
            offset = close.lastIndex;
        } else if (inside && !closing && name === 'meta') {
            const attrs = Object.create(null);
            const text = html.slice(start + match[0].length, end);
            for (const entry of text.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
                const key = entry[1].toLowerCase();
                if (!Object.hasOwn(attrs, key)) attrs[key] = entry[2] ?? entry[3] ?? entry[4] ?? '';
            }
            tags.push(attrs);
        }
    }
    throw new Error('head element is missing or unclosed');
};
// Keep existing character references intact while escaping raw attribute delimiters.
const escape = value => value.replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);)/gi, '&amp;')
    .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'data/playground.json'), 'utf8'));
if (!Array.isArray(catalog)) throw new Error('data/playground.json must be an array');
for (const item of catalog) {
    const url = item?.url;
    if (typeof url !== 'string' || !/^\/(games|apps)\/[a-z0-9-]+\/$/.test(url)) {
        errors.push('invalid catalog URL: ' + String(url));
        continue;
    }
    try {
        const file = await fs.realpath(path.join(root, url.slice(1), 'index.html'));
        if (!file.startsWith(root + path.sep)) throw new Error('page is outside the chosen root');
        const html = await fs.readFile(file, 'utf8');
        const head = readHead(html);
        const meta = (key, value) => head.tags.find(tag => (attr(tag, key) || '').toLowerCase() === value);
        for (const tag of head.tags) {
            const property = attr(tag, 'property')?.toLowerCase();
            if (['og:title', 'og:description'].includes(property) && !attr(tag, 'content')?.trim()) {
                throw new Error(property + ' requires nonempty content');
            }
        }
        const missing = ['og:title', 'og:description'].filter(name => !meta('property', name));
        if (!missing.length) continue;
        const title = head.title?.trim().replace(/\s*·\s*Playground\s*$/i, '');
        const description = attr(meta('name', 'description'), 'content');
        if (!title || !description?.trim()) throw new Error('a nonempty title and description are required before Open Graph repair');
        const values = { 'og:title': title, 'og:description': description };
        const add = missing.map(name => `<meta property="${name}" content="${escape(values[name])}">`).join('');
        changes.push({ file, url, html: html.slice(0, head.end) + add + html.slice(head.end), missing });
    } catch (error) {
        errors.push(url + ': ' + error.message);
    }
}
// No writes until every input has been validated: one bad path cannot leave a half-repaired drop.
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
if (changes.length && !write) {
    console.error('Open Graph metadata missing:\n' + changes.map(c => `${c.url}: ${c.missing.join(', ')}`).join('\n')
        + '\nRun npm run playground:metadata -- --write, inspect the diff, then npm run playground:preflight.');
    process.exit(1);
}
for (const change of changes) {
    await fs.writeFile(change.file, change.html, 'utf8');
    console.log('updated ' + change.url + ': ' + change.missing.join(', '));
}
console.log(`Playground metadata OK: ${catalog.length} pages, ${changes.length} repaired.`);
