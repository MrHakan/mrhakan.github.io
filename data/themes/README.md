# published themes

each `.json` file in this folder is one theme, submitted by a visitor through a pull
request. the site loads them into **theme maker → gallery**, where anyone can apply or
remix them.

you do not write these by hand. open **start → settings → theme maker**, build something,
then hit **publish**. it fills in the file, opens github with it pre-filled, and you click
"create pull request".

## the file

- filename **must** be `<theme id>.json` — CI rejects a mismatch, because two themes
  sharing an id would silently replace each other in the gallery
- `format` is `mrhakan-theme/1`
- `nodes` maps a node id from `THEME_NODES` (in `themes.js`) to css properties from
  `THEME_PROPS`. anything not in those registries is stripped on load
- `vars` sets global css variables. only `--primary-color`, `--accent-color` and
  `--font-main` are accepted
- `events` are scheduled actions — see below. max 24 events, 8 actions each
- `music` is optional metadata for a track that ships with the theme

everything is validated by `themeValidate()` before it is applied, in the browser, every
single time. a theme is data, never code: there is no field anywhere in the format that
can carry javascript, and css values are checked against a denylist that blocks `@import`,
`expression()`, `javascript:` urls, remote `url()` fetches and declaration escapes.

## events

a theme can do things on a schedule. triggers: `activate`, `delay`, `interval`, `clock`,
`between`, `date`, `weekday`, `idle`. actions: `setVar`, `setNode`, `toast`, `dialog`,
`marquee`, `wallpaper`, `effect`, `sound`, `title`, `reset`.

`between` is the interesting one — it fires on entering a time window and undoes itself on
the way out, which is how the bundled "after dark" theme dims the desktop at 20:00 and
brings it back at 06:00 without anybody touching a setting.

## bringing a track

a theme may add one song to the winamp playlist. because the audio is binary it cannot ride
along in the pre-filled github url, so it is uploaded separately:

1. publish the theme — that creates the PR with the `.json`
2. on that same branch, `add file → upload files` into `src/music/`
3. the filename has to match `music.filename` exactly

the theme records the file's **sha-256**, and CI recomputes it from the uploaded bytes. if
they disagree the PR is blocked — swapping the file after it was scanned does not work.

only upload audio you have the right to share.

## scanning

everything here is scanned twice by the same engine (`theme-scan.js`):

- **in the browser**, the moment you attach a file, so you get the report instantly
- **in CI**, on the pull request, which is the pass that actually counts

the checks are size limits, filename sanity (path traversal, bidi-override spoofing,
double extensions), container magic bytes vs. the claimed extension, embedded executable
headers (PE/ELF/Mach-O/shebang), embedded archives and polyglots, script and markup
payloads, the EICAR test signature, a hash denylist, mp3 frame-chain integrity, and data
appended after the last audio frame.

CI additionally asks **virustotal** about the file's sha-256 when the repository has a
`VIRUSTOTAL_API_KEY` secret. that lookup can only ever happen server-side — a static site
cannot hold an api key without publishing it — so the browser computes the hash and CI does
the asking. without the secret the job still runs every deterministic check and says the
lookup was skipped.
