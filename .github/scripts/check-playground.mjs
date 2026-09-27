import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = message => errors.push(message);
const readJson = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));

const catalog = await readJson('data/playground.json');
const projects = await readJson('data/projects.json');
if (!Array.isArray(catalog)) fail('data/playground.json must be an array');

const required = ['name', 'type', 'date', 'url', 'description', 'icon', 'tags'];
const names = new Set();
const urls = new Set();
let games = 0;
let apps = 0;

for (const item of Array.isArray(catalog) ? catalog : []) {
    const label = item?.name || item?.url || '<unnamed>';
    for (const key of required) if (!(key in (item || {}))) fail(`${label}: missing ${key}`);
    if (!['game', 'app'].includes(item.type)) fail(`${label}: type must be game or app`);
    if (item.type === 'game') games++;
    if (item.type === 'app') apps++;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ''))) fail(`${label}: date must be YYYY-MM-DD`);
    if (!/^\/(games|apps)\/[a-z0-9-]+\/$/.test(String(item.url || ''))) fail(`${label}: URL must be /games/<slug>/ or /apps/<slug>/`);
    if (item.type === 'game' && !String(item.url).startsWith('/games/')) fail(`${label}: game URL must live under /games/`);
    if (item.type === 'app' && !String(item.url).startsWith('/apps/')) fail(`${label}: app URL must live under /apps/`);
    if (String(item.url || '').startsWith('/tools/')) fail(`${label}: /tools is reserved for the separate tools site`);
    if (!Array.isArray(item.tags) || item.tags.length < 2) fail(`${label}: add at least two useful tags`);
    if (names.has(item.name)) fail(`${label}: duplicate name`); else names.add(item.name);
    if (urls.has(item.url)) fail(`${label}: duplicate URL`); else urls.add(item.url);

    const rel = String(item.url || '').replace(/^\/+/, '');
    const htmlFile = path.join(root, rel, 'index.html');
    try { await access(htmlFile); } catch { fail(`${label}: missing ${rel}index.html`); continue; }
    const html = await readFile(htmlFile, 'utf8');

    if (!/<html\b[^>]*\blang=/i.test(html)) fail(`${label}: html lang is missing`);
    if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) fail(`${label}: viewport meta is missing`);
    if (!/<meta\b[^>]*name=["']description["']/i.test(html)) fail(`${label}: description meta is missing`);
    if (!/<meta\b[^>]*name=["']theme-color["']/i.test(html)) fail(`${label}: theme-color meta is missing`);
    if (!/<link\b[^>]*rel=["']canonical["']/i.test(html)) fail(`${label}: canonical link is missing`);
    if (!/property=["']og:title["']/i.test(html) || !/property=["']og:description["']/i.test(html)) fail(`${label}: Open Graph title/description is missing`);
    if (!/prefers-reduced-motion/i.test(html)) fail(`${label}: reduced-motion fallback is missing`);
    if (!/Playground focus visibility/i.test(html)) fail(`${label}: shared focus-visible treatment is missing`);
    if (!/<a\b[^>]*href=["']\.\.\/\.\.\/["'][^>]*aria-label=["']Back to Playground["']/i.test(html)) fail(`${label}: back link needs an accessible label`);

    const buttonWithoutType = [...html.matchAll(/<button\b([^>]*)>/gi)].find(match => !/\btype=/i.test(match[1]));
    if (buttonWithoutType) fail(`${label}: a button is missing type="button"`);
    const canvasWithoutLabel = [...html.matchAll(/<canvas\b([^>]*)>/gi)].find(match => !/\baria-label=/i.test(match[1]));
    if (canvasWithoutLabel) fail(`${label}: a canvas is missing aria-label`);
    const liveWithoutAria = [...html.matchAll(/<(?:div|p|span)\b([^>]*\bid=["'](?:status|msg)["'][^>]*)>/gi)].find(match => !/\baria-live=/i.test(match[1]));
    if (liveWithoutAria) fail(`${label}: status/message region must be aria-live`);

    const externalRuntime = [...html.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)/gi)].map(match => match[1]);
    if (externalRuntime.length) fail(`${label}: external runtime scripts are not allowed: ${externalRuntime.join(', ')}`);

    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = match[1] || '';
        if (/\bsrc=/i.test(attrs) || /application\/ld\+json/i.test(attrs)) continue;
        const body = match[2].trim();
        if (!body) continue;
        try { new Function(body); } catch (error) { fail(`${label}: inline JavaScript syntax error: ${error.message}`); }
    }
}

if (games !== apps) fail(`daily catalog must stay paired: ${games} games vs ${apps} apps`);

const projectUrls = new Set((Array.isArray(projects) ? projects : []).map(item => String(item?.url || '').replace('https://mrhakan.github.io', '')));
for (const item of Array.isArray(catalog) ? catalog : []) {
    if (projectUrls.has(item.url)) fail(`${item.name}: daily Playground item leaked into data/projects.json / Special Projects`);
}

if (errors.length) {
    console.error('\nPlayground validation failed:\n- ' + errors.join('\n- '));
    process.exit(1);
}
console.log(`Playground OK: ${catalog.length} entries (${games} games + ${apps} apps), all local and catalogued.`);
