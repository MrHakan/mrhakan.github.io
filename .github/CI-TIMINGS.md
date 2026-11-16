# CI timing baseline and scheduling

## Measured history

Sampled nine Actions workflow records on 2026-11-16, including all available
attempts for the failed run. Successful job samples: 11 Node and 8 browser jobs.
The sample includes both direct verification and Pages' reusable verification;
they represent runner executions, not independent source revisions. Job duration
is completed_at minus started_at, excluding the queue. Step estimates use medians
from successful jobs only; failed runs are retained separately, not treated as fast
passes. Newer catalog entries and hosted-runner load can change these numbers.

- Node job median: **12m 37s**.
- Serial browser job median: **34m 12s**.
- Browser Wizardz step median: **6m 38s**.
- Browser Age of Troll step median: **4m 51s**.

Runs: [43796776234](https://github.com/MrHakan/mrhakan.github.io/actions/runs/43796776234),
43788292531, 43786633026, 43785393022, 43788764873, 43788765003,
43751362516, 43751362598, and 43788929653. The latter had two failed Wizardz
attempts and one failed Trailz attempt. Grouping does not claim to fix those failures.

## Selected layout

Keep the existing Node job together; it sets the useful parallelism floor.
Split the browser steps into three lanes, each sequential on its own runner.
A matrix with `max-parallel: 3` caps browser parallelism, so one Node plus three
browser jobs uses at most four test runners per workflow. Additional browser
lanes would add setup overhead without materially beating the Node floor.

| Browser lane | Projected test time | Existing steps |
| --- | --- | --- |
| arena | 11m 59s | Play wizardz, Play Brawlz 98 with four browsers, Ride trailz, Drive tankz |
| worlds | 11m 22s | Play age of troll, Play dungeonz, Play the troll problem, The 3d shooters, as players found them, Play echoes of the tide |
| desktop | 10m 14s | Boot the site, open the game, draw a sigil, run two lobbies, Invite links, and what happens with no direct route, Play blastz, Deep links, the address bar, favorites and quoting, Play the arcade and the toys, Smoke test every daily Playground page, Open lobbies and quick match, The auto scaler and the news panel, The trophy room, the install and offline, Open it all on a phone, Giscus isolation, responsive boards and failure recovery |

These are sums of historical step medians, **not measured times for the new CI**.
Checkout, Node setup, Chromium install and artifact upload add approximately
39 seconds per browser lane in this sample. With available hosted runners, the
projected critical path is roughly **13–15 minutes instead of 34 minutes**;
queueing and flakiness can dominate, so confirm this on the first real PR run.
Do not promise a fixed completion time or reduce samples/assertions to hit it.

Previously, a main push triggered games-ci.yml directly and also through
Pages' `verify` call. Remove only the direct push trigger: PR, reusable and
manual entry points remain. Pages still runs the complete suite on every main
push before build/deploy. This eliminates duplicate test execution, rather than
skipping validation. No game logic, browser command, environment or assertion
changes. Wizardz's step timeout stays 15 minutes; grouped jobs stop after 30.

## Review before every PR

1. Inspect current main failures before interpreting timing data.
2. List recent successful and failed runs with `gh run list --repo
   MrHakan/mrhakan.github.io --limit 20`.
3. Read job/step records for comparable revisions with `gh api
   'repos/MrHakan/mrhakan.github.io/actions/runs/RUN_ID/jobs?filter=all&per_page=100'`.
   Follow pagination when total_count exceeds the returned jobs; preserve attempt
   IDs and failures. Never infer success from an incomplete/failed fast run.
4. Compare queue time, job duration and per-step medians. Include install/upload
   overhead and distinguish duplicate executions from distinct revisions.
5. Keep a few balanced groups, not one job per script. Rebalance only when the
   measured critical path warrants it; do not rewrite unrelated workflows.
6. Run `node .github/scripts/check-workflow-timeouts.mjs`: every Node command and
   all 24 browser scripts must still be scheduled exactly once. The guard is
   format-aware for this repo; use YAML/action validation as well.
7. Record actual post-change CI times in the PR before claiming a speedup. Require
   all four test jobs at the exact head SHA; do not accept only one matrix lane.
