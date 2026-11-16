# Test performance and failure evidence

## Measured local Node baseline

The control runs used the unchanged VM harnesses from main (1972bde), with
only their ROOT path pointed at the same checkout. Both control and optimized
timings below were unprofiled on local Node 26; CPU profiles were collected
separately. These are single-run local observations, not hosted-CI predictions.

| suite | VM control | lexical loader | observed reduction |
| --- | ---: | ---: | ---: |
| wizardz | 68.74s | 45.20s | 34.2% |
| sigils | 57.97s | 53.55s | 7.6% |
| age-of-troll | 52.09s | 14.83s | 71.5% |

No game source, seed, match count, sample count or target was changed. All
non-runtime output and all three full sigil-confusion matrices match the
baseline. A reference-VM parity test also compares complete AoT simulation
states on three fixed seeds.

CPU profiles located the hot work in Wizardz fill/insideWall/think/octagon,
sigil oneWay distances and AoT act/server/step. `game-test-context.mjs` loads
only trusted repository IIFEs with lexical bindings, avoiding repeated VM global
proxy lookup while preserving separate window/globalThis roots. It is **not a
sandbox** and must never evaluate user input, remote text or unrelated scripts.
The browser still loads the original game files normally. File names are passed
to the compiler so future stack traces/profiles point to the real source.

## Browser baseline: where the time goes

Measured from timestamped logs of the last green main run
[43834641867](https://github.com/MrHakan/mrhakan.github.io/actions/runs/43834641867).
Durations run from one scenario header to the next within the same CI step.
The gh CLI labels reusable-workflow log steps UNKNOWN STEP, so collection used
the job API's step time interval rather than that label.

| suite | scenario | time |
| --- | --- | ---: |
| Play age of troll | all the way through, on the relays | 102.28s |
| Play wizardz | no direct route at all | 83.08s |
| Play wizardz | one wizard, against a bot, with a real mouse | 53.99s |
| Play age of troll | the desktop | 52.27s |
| Play age of troll | no direct route at all | 47.85s |
| Play wizardz | every map | 42.51s |

The longest scenarios play actual matches and verify relay behaviour. Do not
remove those scenarios, shorten bandwidth/FPS windows, reduce sample counts or
change network-delay fixtures merely to make the number smaller.

## Ongoing diagnostics

Wizardz and AoT now write `<suite>-diagnostics.json` under `.ci-shots` (or their
existing WZ_SHOTS/AOT_SHOTS directory). Each scenario persists a checkpoint
before starting, so even a hard kill leaves the last known phase. Completed
phase timings are also appended to GITHUB_STEP_SUMMARY in Actions.

An assertion failure, page error or caught exception captures screenshots plus
real page readiness, game tick/phase and connection state from open pages.
Captures have bounded per-operation deadlines and a limit of three batches;
failed/closed pages are recorded as errors rather than hanging the suite.
Page/context teardown drains pending evidence before closing the browser.
SIGTERM/SIGINT persist failure evidence, attempt bounded owned-process cleanup
and exit non-zero. Uncaught startup errors persist their cause without
suppressing Node's normal failure. SIGKILL cannot run cleanup or take a new
screenshot; the prewritten phase checkpoint is the fallback, not a full trace.
The recorder does not read cookies, localStorage or response bodies; it keeps
bounded assertion messages already emitted by the harness. Screenshots are of
the isolated local test pages, never a logged-in user browser.

A real-browser negative probe verified that a deliberate failure retained its
screenshot, live connection state and scenario even after context teardown.
Unit subprocess tests cover SIGTERM and uncaught startup failure. Diagnostic
failures never turn a failed game assertion into success.

## Wait policy

Replace incidental sleeps with observable conditions: relay TCP readiness,
host-observed ready state for every guest, painted bot portraits, initialized canvases,
unit movement and resumed simulation ticks. Preserve real-time checks: FPS,
8x playback rate, pause-stillness windows, bandwidth sampling and deliberate
connection failure/latency periods. No job fan-out or verification gate changes.

On macOS, `WZ_NO_LOCK=1` selects the same drag-to-look branch used on Linux CI
(see wizardz-play.mjs). The default local headless run hit pointer-lock assertions
and a screenshot timeout; native pointer-lock coverage is not certified by a
passing CI-mode run. No pointer assertions were deleted or rewritten.
Local screenshot runs used the already-installed Hermes Playwright 1.64 with the
existing Hermes Chromium; the older project SDK hit screenshot timeouts with that
browser. CI's paired Playwright 1.49.1/Chromium installation is unchanged.

The full local runs also exposed three pre-existing fixture assumptions. The
unchanged main loadout block reproduced the failures before fixing them:
`ControlOrMeta+A` now selects text on both Mac and Linux, and an own clipboard
property reliably exercises the unavailable-clipboard fallback (assignment to a
getter-only property does not). AoT's sound-preference init script tolerates the
opaque about:blank document before navigation, just like the existing shared
storage setup. The new diagnostics caught that startup error even though all
123 game assertions passed. None of these fixes filters production page errors.

## Daily publisher: blocked on external source

The repository contains no daily generator workflow; its four stored workflows
are deploy, game checks, GitHub-data refresh and theme scanning. The active
Hermes profile has no cron jobs; no local publisher script was located. Existing
README instructions already require the page/catalog/sitemap preflight together.
The generator's repo/script/cron location is needed to change its actual publish
transaction to one commit/push. Do not claim an external publisher was fixed by
adding an unused helper or just changing documentation.
