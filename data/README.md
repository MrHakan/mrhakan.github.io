# guestbook & shoutbox entries

each file in `guestbook/` and `shouts/` is one entry, added by visitors via pull request.

- filename format: `<timestamp>-<name>.json` (the site sorts by filename, newest first)
- guestbook entry fields: `name`, `website` (optional, http/https only), `message`, `date`, `timestamp` (full ISO 8601, shown as date + time)
- shout entry fields: `name`, `message`, `date`, `timestamp` (full ISO 8601, shown as date + time)

the site generates these files automatically when someone hits "sign it!" / "shout it!" —
they just have to click "propose changes" on github and the PR shows up here for approval.
