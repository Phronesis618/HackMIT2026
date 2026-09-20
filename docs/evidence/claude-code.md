# What the Claude Code orchestrator and its agents built

Factual record, taken from `git log` on `main` between 2026-09-19 12:00 and 2026-09-20 08:15.
Counts are commits, not lines. No adjectives.

## Scale

335 commits on `main` in that window, by 8 committing identities: Curious Droid (218),
jonapplehe (67), Devin AI (21), Jeffrey Li (12), 4dalols (9), Charles1729 (6), Jonathan He (2),
devin-ai-integration[bot] (1). The Claude Code orchestrator committed under `Curious Droid` and
signed agent work with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and a
`Claude-Session:` trailer.

Agents were addressed by short ids in commit subjects (`A8`, `A10`, `A27`, `B1`, `F3`, `H1`,
`O1`, `U2a`, `V1`, `X1`, `Q1`). Each worked in its own git worktree on its own branch and merged
through `main`.

## Feature branches merged

Each line is one merge commit on `main`.

- `feat/world-laws` — law harness, 9 world laws in the sim, 6 palette families, lighting modes,
  materials and atmospheres, `long_dark`, derived laws for offline worlds.
- `feat/tiles` — ramping hazard floor, canisters, pits, vents, low cover, terrain skins, a
  terrain `intensity` knob and a room-safety fuzz over generated rooms.
- `feat/boss-finale` — the Custodian pattern registry, gatekeeper previews, a relay ritual
  shortened by relics read, the collapse escape, carry-one-relic.
- `feat/onboarding` — just-in-time coach prompts, first-encounter notes, a Field Notes menu page,
  hub guidance, `docs/design/ONBOARDING.md`. Client-side only.
- `fix/coop-verify` — `scripts/coop-e2e.mjs`, `docs/QA_COOP.md`, three co-op fixes with
  regression tests.
- `fix/worldgen-latency` — flat call-1 bible; 8/8 worlds with zero hard prose failures; first
  room p50 47 s.
- `fix/writing-vision-audit` — a static-prose lint test plus rewrites, law honesty end to end,
  fixtures editor pass, truncation replaced by regeneration, a blind read and a vision audit.
- `fix/writing-tells-3` — `seeded-kind`, pocket-inventory, handwriting and callout-vocabulary
  rules; signage dashes; a humour note; live-verified 0/7 tells.
- `fix/editor-pass` — non-institutional authors, a fourth exemplar world, varied boss callouts,
  fixtures re-textured, live-verified.
- `fix/followups-sweep` — 14 tracked follow-ups closed: floors rail, guest notice,
  server-authoritative flags, cover vs interactions, `first_light`, escape-through-terrain plus
  two stall fixes, offline operatives, `unstable_matter`, room lines, `src/sim/tuning.ts`, a
  flaky test, audio cues.
- `fix/followups-sweep-2` — opening-strike cap, per-world attunements, haste/slow chips and burn
  trail, floors wording, rally reach, wide-body placement, readiness assertions.
- `fix/ui-final-audit` — UI audit, `scripts/ui-matrix.mjs`, `docs/design/UI_AUDIT_FINAL.md`,
  `HeadquartersCrew`.
- A co-op **READY gate** at the hub departure gate: every connected operative stands at the gate;
  the host's Prepare/Enter is server-gated until all connected seats are ready, with a host
  force-start after 12 s. Offline seats do not count. Solo is unaffected.

Pull requests merged from Devin-authored branches include: attunements and the skill tree (#40),
counting saved worlds when the crew is stranded (#39), the fixture-worlds rewrite with bible,
authors, eight biome briefs, laws, look, Custodian and terrain skins (#37), hub departure and
weapon stands (#35), QA public deploy (#34), responsive status (#33), hub replay scope (#30),
and a bundle split into a Phaser vendor chunk with a lazy debrief and full map (#32).

## Review gates

Three merges record a review gate in the subject line: `feat/tiles`, `feat/boss-finale` and
PR #40 each say "Fable review gate passed" — a separate model reviewed the branch before it
reached `main`.

## Verification harnesses built tonight

- `scripts/shot.mjs` — headless Chromium screenshots with a software-GL fallback; Playwright is
  installed into an isolated temp dir so the repo's `package.json` and lockfile are untouched.
- `scripts/coop-e2e.mjs` — 2–5 isolated browser contexts that actually play co-op with real
  keyboard and mouse input, reading state read-only from the DOM and `window.relay`.
- `scripts/solo-e2e.mjs` — the single-player equivalent, added by Q1 on `qa/final-verification`.
- `scripts/ui-matrix.mjs` — UI screenshot matrix, from the UI audit branch.
- `scripts/eval-worldgen.ts`, `scripts/operator-validate.ts` — generation evaluation and operator
  validation.

## Test count

`npm run check` ran 1009 tests before the onboarding merge, 1071 with it, and 1075 on
`qa/final-verification` after two fixes from this branch (a generalised world-scope prose rule
and a realtime-test correction).

## Design documents written

`docs/design/` holds 15 files written during this window, including `TILES.md`, `BOSS_FINALE.md`,
`FLOORS.md`, `WORLD_MUTATORS.md`, `ONBOARDING.md`, `HUB.md`, `ECONOMY.md`, `ITEMS.md`,
`BLIND_READ.md`, `VISION_AUDIT.md`, `UI_AUDIT.md`, `UI_AUDIT_FINAL.md`, `FLOORS_RENDER.md`,
`WORLDGEN_EVAL.md` and `WRITING_BASELINE.md`. `docs/` adds `QA.md`, `QA_COOP.md`, `DEMO.md`,
`PRESENTATION.md`, `SCREENSHOTS.md`, `WRITING.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `TUNING.md`
and `TEAM_PLAN.md`.
