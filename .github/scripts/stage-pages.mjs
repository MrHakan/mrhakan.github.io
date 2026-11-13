// ===================================================================
// stage-pages.mjs — what goes to github pages, and what stays in the repo
//
// deploy.yml used to upload the whole checkout. Some of it is source material
// the site never serves: Brawlz's design sheets and cutout kits alone were
// over 20 MB of every deploy. .pagesignore lists those paths, and this copies
// every tracked file except them into a folder for the Pages upload.
//
//   node .github/scripts/stage-pages.mjs _site     copy the site into _site
//   node .github/scripts/stage-pages.mjs --check   copy nothing, and fail if a
//       pattern matches no file, or if a file the site serves names one that
//       is left out (an html, js, css or json outside .github)
//
// .git and .github never reach the site either way: upload-pages-artifact
// leaves them out of the archive itself.
// ===================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = process.argv[2];
if (!arg) { console.error('usage: stage-pages.mjs <folder> | --check'); process.exit(2); }

const patterns = fs.readFileSync(path.join(ROOT, '.pagesignore'), 'utf8')
    .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const toRegex = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
const rules = patterns.map(p => ({ p, re: toRegex(p), hits: 0 }));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean)
    // a file deleted in the working tree but not yet committed is not there to copy
    .filter(f => fs.existsSync(path.join(ROOT, f)));

const kept = [], left = [];
for (const f of tracked) {
    const rule = rules.find(r => r.re.test(f));
    if (rule) { rule.hits++; left.push(f); } else kept.push(f);
}
const size = list => list.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
const mb = n => (n / 1048576).toFixed(1) + ' MB';

if (arg === '--check') {
    let failures = 0;
    const fail = m => { failures++; console.log('  FAIL  ' + m); };
    for (const r of rules) {
        if (r.hits) console.log('  ok    ' + r.p + ' leaves out ' + r.hits);
        else fail(r.p + ' matches no tracked file');
    }
    // anything the site serves that names a left-out file would 404 on the site
    const served = kept.filter(f => /\.(html|js|mjs|css|json|webmanifest)$/.test(f) && !f.startsWith('.github/'));
    const names = left.map(f => ({ f, base: path.basename(f) }));
    for (const f of served) {
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const n of names) if (text.includes(n.base)) fail(f + ' names ' + n.f + ', which the site will not have');
    }
    if (!failures) console.log('  ok    nothing the site serves names a file it will not have');
    console.log('\nthe site: ' + kept.length + ' files, ' + mb(size(kept)) + '; left in the repo: ' + left.length + ' files, ' + mb(size(left)));
    process.exit(failures ? 1 : 0);
}

const out = path.resolve(ROOT, arg);
if (out === ROOT || !out.startsWith(ROOT + path.sep)) { console.error('stage inside the repo, not over it: ' + out); process.exit(2); }
fs.rmSync(out, { recursive: true, force: true });
for (const f of kept) {
    const to = path.join(out, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), to);
}
console.log('staged ' + kept.length + ' files, ' + mb(size(kept)) + ' into ' + path.relative(ROOT, out) + '; left out ' + left.length + ' files, ' + mb(size(left)));
