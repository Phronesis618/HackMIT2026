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
- [ ] Traverse all three rooms; Guardian → hold F → completed debrief.
- [x] Co-op collapse debrief and host-led shared return to HQ.
- [ ] Co-op revive/retry through browser controls.
- [x] Two browser clients agree on crew, contribution, world, entry, movement and HQ return.
- [x] Return to HQ and retain four real memories after reload.
- [ ] Audible sound and mute persistence (implemented; not checked during short smoke).

## External verification

- [ ] Real OpenAI request: accepted schema, usable output, latency and token usage recorded.
- [ ] Public solo URL and honest provenance verified.
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
