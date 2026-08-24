// ===================================================================
// server-side scan of a theme pull request.
//
// this deliberately does NOT reimplement the checks. it loads the very
// same theme-scan.js and themes.js the browser runs, so a submission
// cannot pass in the theme maker and then be judged by different rules
// here (or the other way round).
//
// on top of the shared engine it does three things the browser cannot:
//   1. verifies the uploaded audio hashes to the sha-256 the theme claims
//   2. asks virustotal about that hash, when the repo has a key configured
//      (an api key can never live in a static site, so this is the only
//      place the lookup can honestly happen)
//   3. refuses a theme that references a track nobody uploaded
//
// usage: node .github/scripts/scan-theme.mjs <changed files...>
// exits non-zero when anything is blocked. writes a markdown summary to
// $GITHUB_STEP_SUMMARY and scan-report.md.
// ===================================================================

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

// themes.js registers themeValidate on the module exports; theme-scan.js
// looks it up as a global, so publish it before loading the scanner.
const themes = require(path.join(ROOT, 'js/themes.js'));
globalThis.themeValidate = themes.themeValidate;
const scan = require(path.join(ROOT, 'js/theme-scan.js'));

const VT_KEY = process.env.VIRUSTOTAL_API_KEY || '';
const files = process.argv.slice(2).filter(Boolean);

const lines = [];
let blocked = 0, warned = 0;

function say(s) { lines.push(s); console.log(s.replace(/\*\*/g, '')); }

function renderChecks(report) {
    const icon = { pass: '✅', warn: '⚠️', fail: '❌' };
    say('');
    say('| | check | detail |');
    say('|---|---|---|');
    report.checks.forEach(c => say(`| ${icon[c.status]} | ${c.name} | ${String(c.detail).replace(/\|/g, '\\|')} |`));
    say('');
}

// ---------- virustotal ----------
// hash lookup only. we never upload the visitor's file to a third party —
// if virustotal has never seen it, that is reported as "unknown", not as a
// pass and not as a failure, and a human makes the call.
async function virusTotalLookup(sha256) {
    if (!VT_KEY) return { state: 'skipped', detail: 'no VIRUSTOTAL_API_KEY secret configured — deterministic checks only' };
    try {
        const res = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
            headers: { 'x-apikey': VT_KEY }
        });
        if (res.status === 404) return { state: 'unknown', detail: 'virustotal has never seen this file — no reputation either way' };
        if (!res.ok) return { state: 'error', detail: `virustotal returned ${res.status}` };
        const body = await res.json();
        const st = body?.data?.attributes?.last_analysis_stats || {};
        const malicious = st.malicious || 0, suspicious = st.suspicious || 0;
        const total = Object.values(st).reduce((a, b) => a + (b || 0), 0);
        if (malicious > 0) return { state: 'malicious', detail: `${malicious}/${total} engines flag this file as malicious` };
        if (suspicious > 0) return { state: 'suspicious', detail: `${suspicious}/${total} engines flag this file as suspicious` };
        return { state: 'clean', detail: `0/${total} engines flag this file` };
    } catch (e) {
        return { state: 'error', detail: `virustotal lookup failed: ${e.message}` };
    }
}

// ---------- audio ----------
async function scanAudio(rel) {
    say(`### 🎵 \`${rel}\``);
    const bytes = new Uint8Array(await readFile(path.join(ROOT, rel)));
    // decode:false — there is no audio engine in CI, so the mp3 frame walker
    // in the shared module is the structural authority here
    const report = await scan.scanFile(bytes, { name: path.basename(rel), kind: 'audio', decode: false });
    say(`**${report.verdict.toUpperCase()}** — ${report.passed} passed, ${report.warned} warnings, ${report.failed} failed`);
    say(`sha-256: \`${report.sha256}\``);
    renderChecks(report);

    const vt = await virusTotalLookup(report.sha256);
    say(`**virustotal:** ${vt.state} — ${vt.detail}`);
    say('');

    if (report.verdict === 'blocked' || vt.state === 'malicious') blocked++;
    else if (report.verdict === 'suspicious' || vt.state === 'suspicious') warned++;
    return report;
}

// ---------- theme json ----------
async function scanTheme(rel, audioReports) {
    say(`### 🎨 \`${rel}\``);
    const text = await readFile(path.join(ROOT, rel), 'utf8');
    const report = scan.scanThemeJson(text);
    say(`**${report.verdict.toUpperCase()}** — ${report.passed} passed, ${report.warned} warnings, ${report.failed} failed`);
    renderChecks(report);
    if (report.verdict === 'blocked') { blocked++; return; }
    if (report.verdict === 'suspicious') warned++;

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { blocked++; say('❌ unparseable json'); return; }
    const res = themes.themeValidate(parsed);
    if (!res.ok) { blocked++; say(`❌ schema: ${res.errors.join('; ')}`); return; }

    // the filename has to match the id, or two themes can collide and one
    // silently replaces the other in everyone's gallery
    const expected = `${res.theme.id}.json`;
    if (path.basename(rel) !== expected) {
        blocked++;
        say(`❌ file name must match the theme id — expected \`data/themes/${expected}\``);
    }

    if (!res.theme.music) { say('_no track attached._'); say(''); return; }

    // a theme that references a track must ship that track, and the bytes
    // that arrived must be the bytes that were scanned in the browser
    const musicRel = path.join('src/music', res.theme.music.filename);
    say(`references track \`${musicRel}\``);
    if (!existsSync(path.join(ROOT, musicRel))) {
        blocked++;
        say('❌ that file is not in the repository — upload it to `src/music/` on this branch.');
        say('');
        return;
    }
    const actual = audioReports.get(musicRel) || await scanAudio(musicRel);
    if (actual.sha256 !== res.theme.music.sha256) {
        blocked++;
        say(`❌ hash mismatch — theme claims \`${res.theme.music.sha256}\`, the uploaded file is \`${actual.sha256}\`. the file was changed after it was scanned.`);
    } else {
        say(`✅ hash matches the value recorded when the theme was built.`);
    }
    say('');
}

// ---------- main ----------
const themeFiles = files.filter(f => /^data\/themes\/.+\.json$/.test(f));
const audioFiles = files.filter(f => /^src\/music\/.+\.(mp3|ogg|wav|m4a|flac)$/i.test(f));
const strays = files.filter(f => !themeFiles.includes(f) && !audioFiles.includes(f));

say('## theme submission scan');
say('');
if (!themeFiles.length && !audioFiles.length) {
    say('nothing to scan — no theme or audio files changed.');
    await writeFile('scan-report.md', lines.join('\n'));
    process.exit(0);
}

if (strays.length) {
    say(`ℹ️ ${strays.length} other changed file(s) are outside \`data/themes/\` and \`src/music/\` and were not scanned by this job.`);
    say('');
}

const audioReports = new Map();
for (const f of audioFiles) audioReports.set(f, await scanAudio(f));
for (const f of themeFiles) await scanTheme(f, audioReports);

say('---');
if (blocked) say(`### ❌ ${blocked} item(s) blocked. this cannot be merged as-is.`);
else if (warned) say(`### ⚠️ ${warned} item(s) need a human look, but nothing is outright blocked.`);
else say('### ✅ everything checks out.');

if (!VT_KEY) {
    say('');
    say('_virustotal reputation lookup was skipped — add a `VIRUSTOTAL_API_KEY` repository secret to enable it. the deterministic checks above run either way._');
}

const out = lines.join('\n');
await writeFile('scan-report.md', out);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, out);
process.exit(blocked ? 1 : 0);
