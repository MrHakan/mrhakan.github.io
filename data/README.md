# guestbook & shoutbox

both boards are **a public gist's comment thread**. signing the guestbook
is leaving a comment on a gist — no fork, no branch, no pull request, no
issue, and nothing gets committed to this repo. the site reads the
comments off the public gist api and puts them on the wall, so an entry
shows up as soon as it is posted, without waiting for a pages deploy.

the trick is the one from the personal-readme crowd:
<https://gist.github.com/traumverloren/a7fa4c89c27fc3adedf1ff96b0514472>

## how signing works

1. the visitor fills in the form on the site and hits **sign it!**
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

## setting it up

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
