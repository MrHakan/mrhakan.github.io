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
  touch.js              the site on a phone: device detection, the
                        on-screen pad, long press for the right click
  defrag.js             disk defragmenter, on a real disk
  documents.js          my documents: every game's save, exportable
  guestbook.js          composing and reading a board entry, and the
                        giscus config for both boards
  themes.js  theme-maker.js  theme-scan.js
  arcade.js             eight small games — tetris, breakout, 2048, simon,
                        hangman, whack, and two with an opponent that does
                        not cheat (minimax, and a pattern reader)
  toys.js               the old web's furniture, most of which the field
                        guides file under extinct: a pet, oneko, blinkies,
                        stamps, a hand-sorted directory, awards — plus the
                        joke programs and the small correct tools
  web.js                the reading layer: deep links, the address bar,
                        favorites, anchors, contents, reading time, plain
                        text, quoting, sidenotes, printing. Loads last —
                        it patches the globals the others declare rather
                        than editing them in place
  vendor/               third-party scripts, vendored
css/
  style.css             all of it, with 95 marked sections, ending in the
                        reading layer and the print stylesheet
  giscus-win98.css      the theme the giscus iframe loads, since style.css
                        cannot reach into another origin
games/                one folder per game, plus the shared netplay layer
  echoes/  jokerz/  wizardz/  become-user/  troll-problem/
  netplay.js
data/                 site content, board config, the projects list, the
                      github snapshot
src/                  assets only: images, fonts, music
server/               the optional self-hosted netplay relay
feed.xml              the rss, written by hand
feed.json             the json feed, generated from feed.xml
.github/scripts/      the test suite — no dependencies, same as the site.
                      build-feed-json.mjs is the one generator
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
node .github/scripts/browser-mobile.mjs
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
| `check-web.mjs` | the reading layer against a fake window, the route names in js/web.js, 404.html and sitemap.xml agreeing, and feed.json matching feed.xml |
| `browser-check.mjs` | the site opens, two tabs duel, the guestbook works both ways |
| `browser-arcade.mjs` | the thirty new windows played rather than opened: eight games of tic-tac-toe it expects to lose, tiles merged in 2048, the pet's clock wound back nine hours |
| `browser-web.mjs` | deep links open the right document, the address bar in every form a person writes one, back and forward, favorites surviving a reload, quoting, find-in-document, the layout and tap targets on a 412px phone, the fullscreen that works without the API, and /now and /uses resolving — it brings its own server for that last part |
| `browser-echoes.mjs` | a character is rolled, a voyage is walked, a fight is won |
| `browser-mobile.mjs` | every app on a Pixel 7: nothing widens the page, a finger drags and closes a window, the troll problem aims before it builds, and the music is never handed to a sleeping audio graph |

## Things that will bite you

- **A phone zooms the whole page out if anything sticks out sideways.**
  One element past the right edge and the browser widens the layout
  viewport to cover it, so every window renders at half size in the
  middle of the screen. The news ticker does exactly that for half of
  every loop and is only clipped by a tailwind class off a cdn, so
  `#marquee-rail` and `html { overflow-x: clip }` are the floor under
  it. `browser-mobile.mjs` samples the page width right through the
  marquee loop.
- **A finger drag emits pointer events and nothing else.** No browser
  synthesises `mousemove` for one — only a click at the end of a tap —
  so a titlebar wired to `mousedown`/`mousemove` is immovable on a
  phone. Window dragging is on pointer events with capture.
- **`createMediaElementSource` is a one-way door.** It takes the
  `<audio>` element off the speakers and hands its output to the web
  audio graph. Call it while the AudioContext is suspended — which is
  how a phone creates one — and the track plays with the clock ticking,
  the progress bar filling and no sound at all. The graph is only ever
  built once the context is genuinely running.

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
- **`window.innerWidth` is not the viewport on a phone.** If anything
  overflows horizontally the browser widens the layout viewport to fit it
  and `innerWidth` widens too — measured at 1648 on a 412px screen. Use
  `TOUCH.viewportWidth()`, which reads `documentElement.clientWidth` and
  agrees with the media queries.
- **Route names live in three files that cannot import from each other.**
  `js/web.js` resolves them, `404.html` redirects to them (it is a separate
  page, so it carries its own copy), and `sitemap.xml` lists them. The keys
  in `appActions()` are the source of truth, and a few have a nicer public
  name — `usespage` is `?app=uses`. `check-web.mjs` holds all three lists to
  the real routes; it is what caught `/uses` pointing at nothing.
- **`feed.json` is generated** from `feed.xml` by
  `npm run feed`. Add an `<item>` and re-run it, or `check-web.mjs` fails.
- **`js/web.js` loads last, on purpose.** It wraps `createAppWindow`,
  `closeAppWindow`, `startMenuAction` and `showSection`, which have to exist
  before it runs. Move its `<script>` tag up and the deep links stop working
  silently.
- **`.doc-` belongs to the slash pages; my documents is `.docs-`.** Both
  features grew a "document window" and both reached for the same prefix.
  `js/documents.js` loads second, so it won, and every `/now`, `/uses` and
  colophon window rendered in MS Sans Serif rather than the Courier its own
  rule asks for — silently, for weeks. `check-web.mjs` fails the build if
  the two namespaces overlap again.
- **The document font size is `var(--doc-font-size)`.** The A-/A+ buttons
  set it on the root element. A second rule hard-coding `font-size` on
  `.doc-body` would win and kill the buttons without an error, so
  `check-web.mjs` looks for one.
- **`.doc-body`'s font size, and everything else `instant()` touches.**
  With motion off, `FX.animate` applies the keyframe's end state directly.
  It used to apply three properties and drop the rest, so a keyframe that
  moved something by `left` never happened for anyone with reduced motion
  on — and nothing said so. `check-motion.mjs` holds it to the whole
  keyframe now.
- **Fullscreen is two implementations.** The Fullscreen API where it
  exists; a `.fs-faux` class pinning the window over the viewport where it
  does not, which is Safari on iPhone and any iframe without
  `allow="fullscreen"`. Everything downstream — `.fs-active`, the canvas
  fitting, Escape — is driven off the same class either way, so a change
  to one needs checking against the other.
- **Touch rules key off `pointer: coarse`, never a width.** A narrow
  desktop window is not a phone and a tablet with a stylus is not a
  fingertip. The bigger tap targets and the 16px inputs must not appear
  under a mouse — that is what keeps this looking like 1998.
- **A new window has four places to be registered**, and
  `check-web.mjs` fails if any of them is missed: `appActions()` in
  `js/index.js`, the start menu in `index.html`, the search index in
  `js/extras.js`, and `PRECACHE` in `sw.js`. It also checks that every
  `unlockAchievement()` names an achievement that exists, and that every
  class the new files invent has a style.
- **`node_modules/` is disposable.** The site has no dependencies and
  neither does the test suite; the only thing that lands there is
  Playwright, installed with `--no-save` for the browser runs.
