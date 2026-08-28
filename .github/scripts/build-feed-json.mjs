// ===================================================================
// build-feed-json.mjs — feed.json, from feed.xml
//
// JSON Feed sits next to the RSS rather than replacing it. Most readers
// quietly support it, and it is the one a small script can produce
// without an xml parser, which matters on a site with no dependencies.
//
// feed.xml stays the file a human edits. This derives feed.json from it
// so the two cannot say different things — check-web.mjs fails the build
// if they have drifted, which is what happens the first time someone
// adds an <item> and forgets this exists.
//
//   node .github/scripts/build-feed-json.mjs          # write it
//   node .github/scripts/build-feed-json.mjs --check  # just compare
// ===================================================================
import fs from 'fs';
import { pathToFileURL } from 'url';

const SITE = 'https://mrhakan.github.io/';

const decode = (s) => s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block, name) => {
    const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
    return m ? decode(m[1]) : '';
};

export function buildFeed(xml) {
    const channel = xml.slice(0, xml.indexOf('<item>') === -1 ? xml.length : xml.indexOf('<item>'));
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

    return {
        version: 'https://jsonfeed.org/version/1.1',
        title: tag(channel, 'title'),
        home_page_url: SITE,
        feed_url: SITE + 'feed.json',
        description: tag(channel, 'description'),
        language: tag(channel, 'language') || 'en',
        favicon: SITE + 'src/emoj/Cursed%20Pack%201-emojigg-pack/7161-joe-cool.png',
        authors: [{ name: 'mrhakan', url: SITE }],
        items: items.map(block => {
            const guid = tag(block, 'guid');
            const date = tag(block, 'pubDate');
            const item = {
                id: guid || tag(block, 'link') || tag(block, 'title'),
                url: tag(block, 'link') || SITE,
                title: tag(block, 'title'),
                content_text: tag(block, 'description')
            };
            const when = date ? new Date(date) : null;
            if (when && !isNaN(when)) item.date_published = when.toISOString();
            return item;
        })
    };
}

// importing this to reuse buildFeed() must not write anything — only
// running the file does. check-web.mjs imports it.
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) main();

function main() {
const xml = fs.readFileSync('feed.xml', 'utf8');
const json = JSON.stringify(buildFeed(xml), null, 2) + '\n';

if (process.argv.includes('--check')) {
    const have = fs.existsSync('feed.json') ? fs.readFileSync('feed.json', 'utf8') : '';
    if (have !== json) {
        console.error('feed.json is out of date with feed.xml — run:\n  node .github/scripts/build-feed-json.mjs');
        process.exit(1);
    }
    console.log('feed.json matches feed.xml');
} else {
    fs.writeFileSync('feed.json', json);
    console.log('wrote feed.json — ' + buildFeed(xml).items.length + ' items');
}
}
