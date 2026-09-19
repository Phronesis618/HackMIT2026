# Evidence — Codex (Agent B)

**Status: implemented with mocked provider verification; real live measurements pending.**
The original entry records Codex's compiler contribution. The continuation below was performed
by **Devin** at the user's request to take on Agent B; it is not additional Codex usage.

| Date/time | Commit / branch | What Codex did (files, feature) | Tests run + result | Notes (latency, tokens, model) |
| --------- | --------------- | ------------------------------- | ------------------ | ------------------------------ |
| 2026-09-19 18:36 ET | `46666e6` / `feat/generation` | Added deterministic `WorldRecipe` compiler, schema validation, safe placement/path guarantee, repair notes, contribution attributions, and compiler tests. | Generation: 14/14 passed. Full check: typecheck, 54/54 tests, production build passed. | No model call; no latency/token claim. |

## Devin continuation of Agent B — 2026-09-19 22:49 UTC

- Implementation: `5c1f79c` on `devin/1789857733-agent-b-generation`;
  [PR #7](https://github.com/Phronesis618/HackMIT2026/pull/7).
- Built the Responses provider, strict schema and runtime registry prompt, timeout/abort,
  one repair, honest fallback, usage hook, deterministic feature receipts, safe placement,
  incremental committed-room iterator, two additional authored fixtures and mocked tests.
- Verification: `npm run check` passed typecheck, **9 files / 87 tests**, and production build.
  `git diff --check` passed. Provider cases use synthetic responses only.
- Integration request to A:
  https://github.com/Phronesis618/HackMIT2026/issues/2#issuecomment-5745909580.

### Actual local HTTP measurements

Used the existing `createRelayServer` on an ephemeral port, GET health, then 20 POST world
requests per mode with seeds 0–19 and three planned rooms. Each result was parsed by
`PreparedWorldSchema` and checked for fixture provenance, zero attempts and three rooms.

| Requested mode | Effective mode | HTTP requests | Provider requests | Tokens | Median HTTP latency | Min / max |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| fixture | fixture | 20 | 0 | 0 | 1.45 ms | 0.96 / 6.33 ms |
| live, no key | fixture | 20 | 0 | 0 | 1.12 ms | 0.89 / 2.06 ms |

All three fixture identities occurred in each sample. These are offline local-process
measurements; they establish neither live model latency nor live token usage.

### Real live run — unverified

No OpenAI credential was available, so no real provider request occurred. Model, real token
totals, and live first-room latency are **not measured**. The test payload's token counts
are fabricated test data, not evidence of API usage. A provisioned key and selected model
are required to finish START_B deliverable 9. Incremental delivery through Agent A's app
transport remains unverified.

### Browser verification

The user approved browser testing, then asked to deprioritize further testing. Completed
checks against the actual server-backed HQ flow passed for both new fixtures: three-room
traversal to Anchor areas, honest offline/zero-call/unused-idea receipts, literal display
of markup-shaped contributions, repeated world replacement, and memory persistence
after reload. No inspected browser runtime errors occurred. Initial Root Archive exit
alignment required HQ re-entry before traversal worked; no blocked corridor was confirmed.
Live provider behavior, streaming, busy-state timing, concurrent sessions, and combat
victories were not verified in the browser. Screenshots and recording are in the Devin
session linked from PR #7.
