# RELAY verification

This checklist distinguishes verification from implementation. Leave a check open until its
result has actually been observed.

## Automated checks

- [x] `npm run check`: typecheck, full Vitest suite, production build — 14 files / 172 tests.
- [x] Deterministic combat, cooldowns, class abilities, unlocks, down/revive and Anchor outcomes.
- [x] Two real WebSocket clients share authoritative snapshots, events and contributions.
- [x] Authority, identity ownership, invalid messages and disconnect teardown.
- [x] Incremental generation preserves committed rooms and handles malformed/cancelled streams.
- [x] Production Docker build and non-root startup; `/`, `/api/config`, `/api/health` respond.

## Necessary browser smoke

- [x] HQ contribution → labelled receipt → physical portal → arrival keepsake.
- [x] Move, aim, damage/defeat an enemy, take damage, dash and use Q.
- [x] Earn an unlock and use E (cooldown observed; E damage not separately measured).
- [x] Traverse all three rooms; Guardian → hold F → completed debrief (observed with two co-op players, anchored debrief on both screens; solo not re-run).
- [x] Co-op collapse debrief and host-led shared return to HQ.
- [x] Co-op revive through browser controls (guest downed, host holds F 2 s, 40 HP on both screens). Retry after collapse = host-led return, above.
- [x] Two browser clients agree on crew, contribution, world, entry, movement and HQ return.
- [x] Co-op, scripted with real input (`scripts/coop-e2e.mjs`, full table in `docs/QA_COOP.md`): 4/4 lobby + fifth refused, classes, host-only prepare, combat/reward/unlock agreement, exit moves the crew, three rooms → Guardian phases 1–3 → three-relay Anchor ritual with two players, tab reload resumes the same operative, host succession, old host rejoins, floors co-op (`RELAY_FLOORS=1`), production bundle over the LAN IP on a non-default port.
- [x] Return to HQ and retain four real memories after reload.
- [ ] Audible sound and mute persistence (implemented; not checked during short smoke).

## External verification

- [ ] Real OpenAI request: accepted schema, usable output, latency and token usage recorded.
- [ ] Public solo URL and honest provenance verified — **partially**: the exact Pages
      artifact was verified in a browser against a static sub-path emulation (see below);
      the hosted URL itself and the Render service were network-blocked for the QA
      session and remain unverified.
- [ ] Two physical laptops on the presentation LAN.

No API key is provisioned in the current development session. The live provider is not
verified by mocked provider tests or by running live mode without credentials.

## Latest evidence

Integrated revision `083d1e0`: full check passed, including real-server combat-gated
traversal and co-op/streaming regressions. Production Docker rebuilt successfully; its
`npm start` process served `/`, `/api/config` and `/api/health`, running as UID 1000.

A roughly three-minute browser smoke passed using legitimate controls: Crystal Tide solo
combat/reward/unlock and persisted memories, then two isolated clients in Root Archive.
The co-op crew collapsed while switching windows; its collapse debrief was not represented
as victory. Screenshots/recording are on PR #10 and the Devin session.

Full three-room victory, Guardian/Anchor, other classes, revive/retry and reconnect were
deliberately excluded from this short browser pass. Their deterministic simulation/network
tests pass. No synthetic gameplay events or state were injected.

Public static fixture site: https://client-gzffunxf.devinapps.com/ (publicly accessible).
HTML and bundle availability are HTTP-checked; the hosted browser flow is not separately
verified. Live generation and co-op require the Node host.

## Public deployment verification — 2026-09-20 (issue #29)

QA session ran 08:51–09:20 UTC on `main` `92d1393` (build) / `c1abe97` (docs). The session's
network policy blocked `phronesis618.github.io` and `relay-a3yv.onrender.com` (an allowlist
request was filed; nobody was awake to approve it). Everything below is therefore split
strictly into what was observed and what was not.

### GitHub Pages solo build (`pages.yml`)

**Verified from GitHub's API (09:00 UTC):** Pages is enabled with `build_type: workflow`,
`html_url: https://phronesis618.github.io/HackMIT2026/`, `https_enforced: true`. The last five
`Deploy solo demo to GitHub Pages` runs on `main` succeeded (latest run 35501077770 at
08:59:58 UTC); the newest `github-pages` deployment is `c1abe97` (09:00:19 UTC).

**Verified in a browser against the same artifact, served statically:** `dist/client` built
with `RELAY_BASE_PATH=/HackMIT2026/` at `92d1393`, served by `python3 -m http.server` with the
bundle under `/HackMIT2026/` and nothing else (so `/api/config` and `/ws` return 404, exactly
as on Pages). No Node server was running.

- Boot: `index.html` references `/HackMIT2026/assets/index-*.js|css`; both returned 200 (304 on
  reload). No asset 404s. `/api/config` → 404, `/ws` → 404. No uncaught exceptions.
- Offline notice shown verbatim: “No generation server is reachable. Solo play uses a
  clearly labelled offline fixture.”
- Prepared world “Vantage Spire”; receipt and world header labelled **OFFLINE FIXTURE**.
- Room 1 (Threshold Concourse): moved, aimed/attacked, took damage 100→86→72, defeated the
  Husk; hostiles → Clear, resource 3→6. Real keyboard/mouse controls only.
- Returned to HQ with five genuine records (receipt, arrival, first victory, lore, aborted
  expedition). After reload the same five records and arrival thumbnail remained;
  `localStorage['relay.memories.v1']` was byte-identical before/after.
- `?world=fixture&floors=1`: boots to HQ labelled **PREVIEW · client fixture** (no missing-
  server notice, since the fixture flag skips the probe). Prepare → Enter starts a labelled
  floors fixture (Threshold Concourse entrance, Biome 1/5, map 1/10 rooms). `floors=1` turns
  floors mode on; it does not mean a one-floor run. The legacy room counter reads 1/1 next to
  the floors map count.
- Only external failures: Google Fonts (blocked network) → fallback fonts.

Recording and screenshots: PR `[QA] Public deployment verification`.

**Unverified:** the hosted URL itself (TLS, GitHub's 404 handling, real CDN paths). The
emulation exercises the same bundle, base path and missing-server behaviour, but not
GitHub's edge.

### Render full-game service (`render.yaml`, PR #17)

**Verified from the repo/PR record only:** PR #17 and `docs/evidence/devin.md` state a service
exists at https://relay-a3yv.onrender.com, that `/api/health` and `/api/config` reported
Anthropic live mode after the owner added `ANTHROPIC_API_KEY`, that one live Claude world
completed (~95 s incl. one repair) after a manual redeploy, and that a `wss://` client
received welcome/pong. PR #17 also reports **commit-triggered auto-deploys were not firing**
(deployed `8241f79` while `main` was ahead).

**Unverified in this session (host blocked):** whether the service is live now, current
`/api/health` output, which commit it runs, whether live generation is still configured,
wss co-op between two browser contexts, and provenance labels on that host. Do not present
the Render URL as verified until a human runs the checklist in `docs/DEMO.md` →
“Public hosts”.

### Config review (no bug found)

- WebSocket URL: `RemoteSession.defaultUrl()` builds `new URL('/ws', location.href)` and flips
  `https:`→`wss:`. Behind Render's TLS proxy the page is `https:`, so the socket is `wss://host/ws`
  on the same origin — correct. Pages has no `/ws`; the client falls back to offline solo.
- Base path: only `vite.config.ts` `base` is path-dependent; the client uses root-relative
  `/api`/`/ws` (intentionally absent on Pages) and no other absolute asset paths were found.
- `render.yaml` sets `RELAY_GENERATION_MODE=live`, `RELAY_AI_PROVIDER=anthropic`,
  `ANTHROPIC_MODEL=claude-sonnet-4-6`; `ANTHROPIC_API_KEY` is deliberately not in the
  Blueprint and must be a Render secret. No config change was needed.
