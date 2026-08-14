# guestbook & shoutbox entries

each file in `guestbook/` and `shouts/` is one entry.

- filename format: `<timestamp>-<name>.json` (the site sorts by filename, newest first)
- guestbook entry fields: `name`, `website` (optional, http/https only), `message`, `date`, `timestamp` (full ISO 8601, shown as date + time), `by` (the github account that submitted it)
- shout entry fields: the same, minus `website`

## how they get here

signing used to open a pull request, which meant every visitor had to fork
the repo first. nobody forks a repo to say hello, so now:

1. the site fills in an issue for you — title `guestbook: <name>`, body with
   the entry in a json fence — and you hit create. that is the whole job.
2. `.github/workflows/guestbook.yml` picks it up, runs
   `.github/scripts/guestbook-bot.mjs`, and commits the file here.
3. the bot replies on the issue and closes it. the entry shows up on the
   site immediately — it reads `data/` through the github api, so it does
   not wait for a pages deploy.

nothing a visitor writes is trusted: `.github/scripts/guestbook-entry.mjs`
strips html and control characters, caps every field, only allows http and
https links, and rebuilds the entry field by field. the filename is built
from a slug of the sanitised name, so it cannot steer the write anywhere.

## moderating

delete the file. that is the whole moderation system — the entry disappears
from the site on the next load.
