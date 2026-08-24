# mrhakan.github.io

A Windows 98 desktop that happens to be a personal site. Plain HTML, CSS
and JavaScript, served straight off GitHub Pages. **There is no build
step** — what is in the repo is what the browser gets, and that is the
whole point.

## Layout

```
index.html            the desktop
guestbook.html        the guestbook
links.html            the links page
404.html
sw.js                 the service worker — has to stay at the root, its
                      scope is its own directory
js/                   everything the pages load
  index.js              the desktop: windows, taskbar, start menu, repo grid
  extras.js             the lazy loaders and find: files
  apps.js  fun.js       the accessories and the toys
  pages.js  charts.js   /now, /uses, /colophon, and the graphs on them
  fx.js                 the motion layer, and the reduced-motion promise
  defrag.js             disk defragmenter, on a real disk
  documents.js          my documents: every game's save, exportable
  guestbook.js          composing and reading a board entry
  themes.js  theme-maker.js  theme-scan.js
css/
  style.css             all of it, with 95 marked sections
  giscus-win98.css      the theme the giscus iframe loads, since style.css
                        cannot reach into another origin
games/                the six games and the netplay layer
data/                 site content, board config, the github snapshot
src/                  images, fonts, music
server/               the optional self-hosted netplay relay
.github/scripts/      the test suite — no dependencies, same as the site
```

## Running it

```sh
npm run serve      # python3 -m http.server 8099
npm test           # the whole headless suite
```

The browser tests need Playwright's chromium and a server on :8099:

```sh
python3 -m http.server 8099 &
node .github/scripts/browser-check.mjs
node .github/scripts/browser-echoes.mjs
```

## The tests

There is no framework. Each script loads the real files, asserts, and
exits non-zero if anything drifted.

| script | what it holds to |
| --- | --- |
| `check-games.mjs` | every script parses, the fifty spells and their sigils, desktop wiring, my documents' backup envelope, the GitHub snapshot |
| `check-guestbook.mjs` | composing and reading an entry, and the giscus config |
| `check-motion.mjs` | reduced motion means no motion, the charts, the stylesheet's own links |
| `check-defrag.mjs` | the defragmenter's plan never loses a cluster |
| `check-echoes.mjs` | a few thousand fights against the RPG's balance targets, and its maps |
| `browser-check.mjs` | the site opens, two tabs duel, the guestbook works both ways |
| `browser-echoes.mjs` | a character is rolled, a voyage is walked, a fight is won |

## Things that will bite you

- **`sw.js` stays at the root.** A service worker's scope is its own
  directory; moving it into `js/` would silently stop it controlling the
  site.
- **Every `url()` in `css/style.css` is absolute.** They resolve against
  the stylesheet, not the page, so a relative one broke the icon font the
  moment the file moved into `css/`. `check-motion.mjs` fails the build
  on a relative one now.
- **The service worker precaches by URL.** Move a file and its entry in
  `PRECACHE` has to move too — `check-games.mjs` fails if a precached URL
  does not exist.
- **`data/github.json` is generated**, once a day by
  `.github/workflows/github-data.yml`. Do not hand-edit it.
