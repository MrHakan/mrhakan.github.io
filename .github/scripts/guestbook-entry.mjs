// ===================================================================
// guestbook-entry — turn an issue into a guestbook or shoutbox entry
//
// Signing used to open a pull request, which quietly asked every
// visitor to fork the repo first. Nobody is doing that to leave a "hi
// from nigeria". Now the site opens a pre-filled issue instead, and
// .github/workflows/guestbook.yml runs this over it and commits the
// entry.
//
// Everything in here treats the issue body as what it is: a string a
// stranger on the internet wrote. It is parsed, clipped, stripped and
// rebuilt field by field — nothing from the body reaches the repo
// without going through this file.
// ===================================================================

export const KINDS = {
    guestbook: { name: 30, message: 500, website: 100 },
    shouts: { name: 20, message: 140, website: 0 }
};

// control characters, html, and the zero-width tricks people paste to
// break a layout
function clean(value, max) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<[^>]*>/g, ' ')                            // no markup, ever
        .replace(/[\u0000-\u001f\u007f]/g, ' ')               // no control characters
        .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '')    // no invisible layout tricks
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

// only somewhere a browser can actually go
function cleanUrl(value, max) {
    const raw = clean(value, max);
    if (!raw) return '';
    let url;
    try { url = new URL(raw); } catch (e) {
        try { url = new URL('https://' + raw); } catch (e2) { return ''; }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname || !url.hostname.includes('.')) return '';
    return url.href.slice(0, max);
}

// the site puts the entry in a json fence; a person filling the form in
// by hand might not, so a bare object is accepted too
export function extractJson(body) {
    if (typeof body !== 'string' || !body.trim()) return null;
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidates = [];
    if (fenced) candidates.push(fenced[1]);
    const braces = body.match(/\{[\s\S]*\}/);
    if (braces) candidates.push(braces[0]);
    for (const text of candidates) {
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (e) { /* try the next shape */ }
    }
    return null;
}

export function kindFromTitle(title) {
    const m = /^\s*(guestbook|shout)\s*:/i.exec(String(title || ''));
    if (!m) return null;
    return m[1].toLowerCase() === 'shout' ? 'shouts' : 'guestbook';
}

const slugify = (name) => (String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)) || 'anon';

/**
 * @returns {{ok: true, kind, entry, path} | {ok: false, reason: string}}
 */
export function parseSubmission({ title, body, login, now }) {
    const kind = kindFromTitle(title);
    if (!kind) return { ok: false, reason: 'that is not a guestbook or shout issue' };
    const limits = KINDS[kind];

    const raw = extractJson(body);
    if (!raw) {
        return {
            ok: false,
            reason: 'i could not find the entry in there. the site fills this in for you — ' +
                'open the guestbook on the site and hit sign, rather than writing the issue by hand.'
        };
    }

    const name = clean(raw.name, limits.name);
    const message = clean(raw.message, limits.message);
    if (!name) return { ok: false, reason: 'no name in the entry' };
    if (!message) return { ok: false, reason: 'no message in the entry' };

    const stamp = now instanceof Date ? now : new Date();
    // the entry is rebuilt from scratch: anything else in that json is
    // ignored rather than trusted
    const entry = {
        name,
        message,
        date: stamp.toISOString().slice(0, 10),
        timestamp: stamp.toISOString()
    };
    if (limits.website) {
        const website = cleanUrl(raw.website, limits.website);
        if (website) entry.website = website;
    }
    // who actually opened the issue, straight from github rather than
    // from anything the body claims — moderation needs a real handle
    const by = clean(login, 40).replace(/[^A-Za-z0-9-]/g, '');
    if (by) entry.by = by;

    // the filename is built here too, so a name of "../../index" cannot
    // steer the write anywhere
    const path = `data/${kind}/${stamp.getTime()}-${slugify(name)}.json`;
    return { ok: true, kind, entry, path };
}

export function entryFileContents(entry) {
    return JSON.stringify(entry, null, 4) + '\n';
}
