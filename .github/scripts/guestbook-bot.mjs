// ===================================================================
// guestbook-bot — the thing that actually commits the entry
//
// Runs from .github/workflows/guestbook.yml on every new issue. If the
// issue is a guestbook or shout submission it parses it (see
// guestbook-entry.mjs), commits the file, says thanks and closes the
// issue. If it is anything else it leaves quietly.
//
// Everything the visitor wrote arrives through environment variables and
// is handled as data — it is never interpolated into a shell command or
// a workflow expression.
// ===================================================================
import { parseSubmission, entryFileContents, kindFromTitle } from './guestbook-entry.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;                 // owner/name
const issueNumber = Number(process.env.ISSUE_NUMBER || 0);
const title = process.env.ISSUE_TITLE || '';
const body = process.env.ISSUE_BODY || '';
const login = process.env.ISSUE_AUTHOR || '';
const branch = process.env.TARGET_BRANCH || 'main';
const MAX_PER_HOUR = Number(process.env.MAX_PER_HOUR || 4);

// pointed at a stub by the tests; github everywhere else
const API = process.env.GITHUB_API || 'https://api.github.com';

const api = async (path, init = {}) => {
    const res = await fetch(API + path, Object.assign({
        headers: {
            authorization: 'Bearer ' + token,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'user-agent': 'mrhakan98-guestbook-bot'
        }
    }, init));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${(json && json.message) || text.slice(0, 200)}`);
    return json;
};
const comment = (text) => api(`/repos/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST', body: JSON.stringify({ body: text })
});
const closeIssue = (reason) => api(`/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: reason })
});
const label = (name) => api(`/repos/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST', body: JSON.stringify({ labels: [name] })
}).catch(() => { /* a missing label is not worth failing over */ });

const FOOTER = '\n\n---\n_the guestbook signs itself. deleting the file in `data/` removes the entry._';

async function main() {
    if (!kindFromTitle(title)) {
        console.log('not a guestbook issue, leaving it alone');
        return;
    }
    if (!token || !repo || !issueNumber) throw new Error('missing token/repo/issue number');

    const result = parseSubmission({ title, body, login });
    if (!result.ok) {
        console.log('rejected:', result.reason);
        await comment(`could not add that one: **${result.reason}**${FOOTER}`);
        await label('invalid');
        await closeIssue('not_planned');
        return;
    }

    // a soft flood guard. it is not security, it is manners — the owner
    // can still delete anything, and github's own abuse limits sit under
    // this anyway.
    try {
        const since = new Date(Date.now() - 3600 * 1000).toISOString();
        const q = encodeURIComponent(`repo:${repo} author:${login} created:>=${since} is:issue`);
        const recent = await api(`/search/issues?q=${q}&per_page=20`);
        if (recent && recent.total_count > MAX_PER_HOUR) {
            await comment(`easy there — that is ${recent.total_count} in an hour. try again later.${FOOTER}`);
            await label('spam');
            await closeIssue('not_planned');
            return;
        }
    } catch (e) {
        console.log('flood check skipped:', e.message);
    }

    const { kind, entry, path } = result;
    const content = Buffer.from(entryFileContents(entry), 'utf8').toString('base64');
    await api(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({
            message: `${kind}: add entry from ${entry.name}\n\nadded automatically from #${issueNumber}.`,
            content,
            branch
        })
    });
    console.log('committed', path);

    const where = kind === 'shouts' ? 'the shoutbox' : 'the guestbook';
    await comment(
        `signed. **${entry.name}** is on ${where} now — [go and look](https://mrhakan.github.io/).\n\n` +
        '```json\n' + entryFileContents(entry) + '```' + FOOTER
    );
    await label(kind === 'shouts' ? 'shoutbox' : 'guestbook');
    await closeIssue('completed');
}

main().catch(async (err) => {
    console.error(err);
    // tell the visitor something went wrong rather than leaving the issue
    // sitting there looking ignored
    try {
        await comment(`something broke while adding that: \`${String(err.message).slice(0, 200)}\`. mrhakan will have a look.${FOOTER}`);
    } catch (e) { /* nothing else to try */ }
    process.exit(1);
});
