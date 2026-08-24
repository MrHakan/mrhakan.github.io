// ===================================================================
// fetch-github-data.mjs — take a snapshot of the GitHub side of the site
//
// The repo grid and the user.dat panel used to call api.github.com from
// the browser, anonymously, which is sixty requests an hour per IP. That
// is a budget shared by everyone behind a NAT, and when it runs out the
// page says "repos: ?" and "github api rate limit". This runs in CI with
// a token, keeps only the fields the page actually renders, and writes
// them to data/github.json for the page to read as a static file.
// ===================================================================
import fs from 'fs';
import path from 'path';

const USER = process.env.GH_USER || 'mrhakan';
const TOKEN = process.env.GH_TOKEN || '';
const OUT = path.join(process.cwd(), 'data', 'github.json');

const headers = {
    'accept': 'application/vnd.github+json',
    'user-agent': 'mrhakan.github.io-refresh',
    ...(TOKEN ? { authorization: 'Bearer ' + TOKEN } : {})
};

async function api(url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(url + ' → ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return res.json();
}

// only what index.js renders — a snapshot is not a mirror
const repoFields = r => ({
    name: r.name,
    html_url: r.html_url,
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    pushed_at: r.pushed_at,
    updated_at: r.updated_at,
    has_pages: r.has_pages,
    fork: r.fork,
    archived: r.archived
});

const user = await api(`https://api.github.com/users/${USER}`);
let repos = [], page = 1;
while (page <= 5) {
    const batch = await api(`https://api.github.com/users/${USER}/repos?sort=updated&per_page=100&page=${page}`);
    if (!Array.isArray(batch) || !batch.length) break;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
}

if (!user.login) throw new Error('the profile came back without a login');
if (!repos.length) throw new Error('no repositories came back — refusing to write an empty snapshot');

// This file is committed to a public site. /users/{login}/repos should only
// ever return public repositories, but a snapshot that leaks a private name
// is not a bug you get to fix afterwards, so check rather than assume.
const leaked = repos.filter(r => r.private || r.visibility === 'private');
if (leaked.length) throw new Error('refusing to write: ' + leaked.length + ' private repositories in the response');

const doc = {
    generated_at: new Date().toISOString(),
    user: {
        login: user.login,
        avatar_url: user.avatar_url,
        public_repos: user.public_repos,
        followers: user.followers,
        created_at: user.created_at
    },
    repos: repos.filter(r => !r.private).map(repoFields)
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
// stable key order and a trailing newline, so the daily diff is only ever
// the fields that actually moved
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${OUT}: ${doc.repos.length} repos, ${doc.user.followers} followers`);
