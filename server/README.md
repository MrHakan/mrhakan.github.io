# netplay relay

Multiplayer on this site does **not** need a server. The lobby's default
mode is peer to peer: two browsers open a WebRTC data channel and talk
straight to each other, with the public PeerJS broker doing nothing but
introducing them. That is why an invite code works from a plain GitHub
Pages site with nothing running anywhere.

There is a second way online that needs nothing from you either: the
lobby's **public relays** mode posts the duel through public nostr relays
on port 443, encrypted with the invite code. No p2p, no signup, nothing
deployed — see `games/README.md`. `nostr-test-relay.mjs` in this folder
is a tiny stand-in for those relays so the browser tests do not depend on
strangers' servers.

This folder is mostly the *third* option, for when neither of those is
good enough:

- corporate / campus networks that block the STUN traffic WebRTC needs
- the public broker having a bad day
- you would simply rather run your own thing

`relay.js` is a small WebSocket relay with **no dependencies** — plain
Node, no `npm install`, one file.

## running it

```sh
node server/relay.js            # listens on 0.0.0.0:8787
PORT=9000 node server/relay.js  # somewhere else
```

Then either paste the URL into the lobby (pick **my relay server** as the
connection mode and fill in the box), or ship it as the default for
everyone by setting it in `data/site.json`:

```json
"multiplayer": { "relay": "wss://relay.example.com" }
```

Browsers on an `https://` page may only open `wss://` sockets, so put it
behind TLS. Caddy does it in two lines:

```
relay.example.com {
    reverse_proxy localhost:8787
}
```

nginx wants the upgrade headers spelled out:

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}
```

`GET /healthz` returns `{"ok":true,"rooms":N,"up":seconds}` for whatever
uptime check your host insists on.

## knobs

All environment variables, all optional:

| variable       | default   | what it does                          |
| -------------- | --------- | ------------------------------------- |
| `PORT`         | `8787`    | port to listen on                     |
| `HOST`         | `0.0.0.0` | interface to bind                     |
| `MAX_ROOMS`    | `500`     | lobbies open at once                  |
| `MAX_PER_ROOM` | `8`       | players in one lobby                  |
| `MAX_MESSAGE`  | `65536`   | bytes per message                     |
| `MSG_PER_SEC`  | `120`     | per client, then the connection drops |
| `IDLE_MS`      | `90000`   | silence before a client is cut loose  |

## protocol

Mirrors `RelayTransport` in `games/netplay.js`. Everything is JSON text
frames; the relay never looks inside `msg`.

| direction       | message                                |
| --------------- | -------------------------------------- |
| client → server | `{k:'join', room, id, host, v}`        |
| client → server | `{k:'data', to, msg}` (`to` or `'*'`)  |
| server → client | `{k:'joined', id, hostId, peers[]}`    |
| server → client | `{k:'peer', id}` / `{k:'bye', id}`     |
| server → client | `{k:'data', from, to, msg}`            |
| server → client | `{k:'err', msg}`                       |

It stores nothing, logs no message contents, and forgets a room the
moment the last player leaves.

## tests

```sh
node server/relay-smoke.mjs
```

Boots the relay, connects two hand-rolled WebSocket clients, and checks
joining, broadcast, direct messages, disconnect notices and a rejected
room code. It runs in CI on every push — see
`.github/workflows/games-ci.yml`.
