# guestbook & shoutbox

Both boards show their original **Gist wall and forms** by default, including
the compact Shoutbox. Submitting a draft offers **Giscus ile devam et** and
**Eski usul**. Cancelling or switching methods preserves the draft.

Giscus opens in an isolated retro composer and uses GitHub Discussions under
`Announcements`, with distinct `Guestbook` and `Shoutbox` terms. The old-school
method keeps the copy-and-open-Gist flow. These are separate comment boards:
Gist comments appear on the original wall; Discussion comments appear inside
Giscus. The method chooser explains this before the visitor continues.

the trick is the one from the personal-readme crowd:
<https://gist.github.com/traumverloren/a7fa4c89c27fc3adedf1ff96b0514472>

## old-school gist signing (default)

1. the visitor fills in the form, hits **sign it!** or **shout it!**, then chooses **Eski usul**
2. the site writes the comment for them and copies it:

    ```
    name: mrhakan
    site: https://mrhakan.github.io

    nigeria'dan selamlar
    ```

3. the gist opens, they paste it in the comment box and hit **comment**
4. the entry is on the wall on the next load

the `name:` / `site:` header lines are optional. a comment with none of
them is still an entry — the message is the whole comment and the name is
whoever github says wrote it. the github login is always shown next to
the display name, so a borrowed name cannot pass for somebody else.

nothing a visitor writes is trusted: `guestbook.js` strips control
characters and zero-width tricks, caps every field, allows only http and
https links, and everything is escaped where it is rendered.

## the one-click version: giscus

the copy-paste flow above loses most visitors at step three. **giscus**
keeps the same idea — no backend, no database, github holds the words —
but a visitor signs in with github and comments in its embedded composer. the thread
is a [github discussion](https://docs.github.com/discussions) on this
repo rather than a gist.

**each board is separate.** the guestbook and the shoutbox have distinct
discussion titles in the same Announcements category. Giscus is configured for
both and is loaded only after the visitor chooses it. With incomplete config,
the original Gist flow remains available.

```json
"giscus": {
    "repo": "MrHakan/mrhakan.github.io",
    "repoId": "MDEwOlJlcG9zaXRvcnkzNDk4MjY5NjQ=",
    "category": "Announcements",
    "categoryId": "DIC_kwDOFNnvlM4DEF5L",
    "guestbook": { "term": "Guestbook" },
    "shouts":    { "term": "Shoutbox" }
}
```

both boards live in one category and are told apart by the discussion
**title**, which is each board's `term`. the category ID was verified at
<https://giscus.app> on 2026-11-01 after the account suspension ended.
a board can still override `category` / `categoryId` if the categories are
split in the future.

### getting them

1. **repo settings → features → tick Discussions.** already done.
2. in **discussions → categories**, make a category per board.
   **announcement** format is the right one: only maintainers can open a
   discussion in it, so visitors cannot start new threads there —
   commenting is unaffected, and giscus opens the thread itself through
   its app. *general* works too, it just lets the category fill up with
   threads nobody asked for.
3. install the **[giscus app](https://github.com/apps/giscus)** on this
   repo. it needs write access to discussions, and only here.
4. go to **<https://giscus.app>**, put in `MrHakan/mrhakan.github.io`,
   pick a category, and read `data-category` and `data-category-id` out
   of the snippet it prints. repeat for the second category.
5. paste them into `data/site.json` and commit.

### the thing that actually catches people

giscus finds a board's thread by the discussion's **title**, and that
title is the `term` field. so if you opened the discussion by hand and
called it something with a capital letter or an emoji in it, put that
exact string in `term`:

```json
"guestbook": {
    "category": "Guestbook",
    "categoryId": "DIC_…",
    "term": "📝 Ziyaretçi Defteri"
}
```

otherwise leave `term` alone and either title the discussion exactly
`guestbook` / `shoutbox`, or let giscus open the thread itself on the
first comment.

(strict matching, which hashes the term instead of using it literally,
is deliberately **off** here — with it on, giscus would walk straight
past a discussion opened by hand.)

### the theme

the frame is on giscus.app, so `css/style.css` cannot reach into it.
giscus takes a theme by url instead, and `css/giscus-win98.css` is that
theme: the same bevels, greys and title bars as the window it sits in.
it is passed automatically.

### isolation, connection failures and local tests

The desktop embeds `guestbook.html?embedded=1` for the original Guestbook.
Choosing Giscus opens `guestbook.html?embedded=1&composer=giscus&board=guestbook`
or `board=shouts` inside a retro dialog. Drafts are copied and shown locally,
never put in URLs or automatically submitted. The standard Giscus client owns
one container per document, so the composer keeps both threads independent while using the same Announcements category and their
distinct `Guestbook` / `Shoutbox` terms. The existing threads are Discussions
[#36](https://github.com/MrHakan/mrhakan.github.io/discussions/36) and
[#35](https://github.com/MrHakan/mrhakan.github.io/discussions/35), respectively.

A blocked client, service error or visible frame that does not respond within
15 seconds shows the correct GitHub link. The visitor can return to the method
chooser and use the original Gist flow with their draft intact.
An empty discussion is allowed: Giscus creates it on the first comment.
Messages are accepted only from the board's own frame on `https://giscus.app`.

Browser CI uses `mock-giscus.mjs` to replace the external client and widget,
including the client script's CORS headers. Local application files stay real;
no CORS errors are suppressed. This avoids having a production Giscus frame
fetch a custom theme from a localhost server without CORS headers. The focused
`browser-giscus.mjs` suite checks both documents and includes an actual rejected
cross-origin request to prove the error collector still catches CORS failures.
Production verification must separately use the real Giscus widget and confirm
that GitHub Pages serves `css/giscus-win98.css` with cross-origin access.

### what this costs

the comment box is an iframe from giscus.app, so the page depends on a
third party staying up, and a visitor needs a github account and has to
be willing to sign in. the gist flow needed an account too, so that part
is a wash — the click count is the difference.

## setting up the gists

two public gists, one per board (they need to be separate — one thread
per board):

1. go to <https://gist.github.com>, make a **public** gist. call the file
   something like `guestbook.md` and put a line in it — a title, a retro
   gif, whatever. `gist-guestbook.md` next to this file is a starting
   point you can paste in.
2. copy the id out of the url — `https://gist.github.com/MrHakan/<id>`
3. repeat for the shoutbox
4. paste both into `data/site.json`:

    ```json
    "boards": {
        "owner": "MrHakan",
        "guestbook": "a7fa4c89c27fc3adedf1ff96b0514472",
        "shouts": "0000000000000000000000000000000f"
    }
    ```

until an id is filled in, that board still shows the json entries below,
and signing tells the visitor it is not wired up yet instead of opening a
broken link.

## the json files

`guestbook/` and `shouts/` are what was signed before the boards moved
onto gists. they still render, merged in with the comments and sorted by
date — they just do not grow any more.

- filename: `<timestamp>-<name>.json` (sorted by filename, newest first)
- guestbook fields: `name`, `website` (optional, http/https only),
  `message`, `date`, `timestamp`, `by` (the github account)
- shout fields: the same, minus `website`

## moderating

delete the comment on the gist. that is the whole moderation system — it
disappears from the site on the next load. for the old entries, delete
the json file.
