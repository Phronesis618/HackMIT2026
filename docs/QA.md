# RELAY verification

This checklist distinguishes verification from implementation. Leave a check open until its
result has actually been observed.

## Automated checks

- [ ] `npm run check`: typecheck, full Vitest suite, production build.
- [ ] Deterministic combat, cooldowns, class abilities, unlocks, down/revive and Anchor outcomes.
- [ ] Two real WebSocket clients share authoritative snapshots, events and contributions.
- [ ] Authority, identity ownership, invalid messages and disconnect teardown.
- [ ] Incremental generation preserves committed rooms and handles malformed/cancelled streams.
- [x] Production Docker build and non-root startup; `/`, `/api/config`, `/api/health` respond.

## Necessary browser smoke

- [ ] HQ contribution → labelled receipt → portal → arrival keepsake.
- [ ] Move, aim, damage an enemy, take damage, dash and use Q.
- [ ] Earn an unlock and use E.
- [ ] Traverse all three rooms; Guardian → hold F → completed debrief.
- [ ] Failure or co-op down/revive behavior.
- [ ] Two browser clients agree on crew/world/room transitions.
- [ ] Return to HQ and retain real memories after reload.
- [ ] Sound toggle and usable layout.

## External verification

- [ ] Real OpenAI request: accepted schema, usable output, latency and token usage recorded.
- [ ] Public solo URL and honest provenance verified.
- [ ] Two physical laptops on the presentation LAN.

No API key is provisioned in the current development session. The live provider is not
verified by mocked provider tests or by running live mode without credentials.

The production container smoke above was performed on the initial integration revision.
Repeat the build/start smoke after integrating simulation, streaming and multiplayer changes.
