# Handoff — Agent A (Fable, `feat/core`)

## Offline replay follow-up

- Branch: `devin/1789861332-offline-expedition-memories`, based on merged PR #10.
- **Implemented:** browser fixtures use a request-specific world identity, matching the
  server convention. Preparing again or reloading no longer suppresses new receipt/arrival
  memories as duplicates of a previous expedition. Provenance stays explicitly fixture.
- **Verified:** regressions failed before the fix for both same-session and reload paths.
  Real LocalSession events and Chronicle persistence now pass; full check **174 tests /
  15 files**, typecheck/build/whitespace passed. A focused browser smoke at `b9790a9`
  used the production bundle without API routes: three physical portal entries with a
  reload before the third retained three receipts, three arrivals and three abort summaries.
- **Mocked:** the integration test injects in-memory storage; session events are real.
- **Published:** the corrected bundle is live at https://client-gzffunxf.devinapps.com/;
  deployed HTML references the new JavaScript bundle and both return HTTP 200.
- **Unverified:** live OpenAI verification remains deferred by user choice. Hosted browser,
  public co-op, and full victory were outside the focused replay check. Optional console
  inspection was unavailable at the CDP tooling layer; visible UI and DOM supplied evidence.

## Current integration — Devin across all roles

- [PR #10](https://github.com/Phronesis618/HackMIT2026/pull/10), branch
  `devin/1789859304-complete-relay`, code/test revision `083d1e0`, combines child PRs #11–13.
- **Implemented:** pure directional combat, four enemy behaviors and telegraphs,
  four classes/Q/E, real purchases/rewards, down/revive, Guardian/Anchor, success/collapse/
  abort and retry. Combat-gated exits preserve cleared rooms on revisits.
- **Implemented:** host-authoritative four-player co-op, shared ideas/worlds/events,
  owned inputs, host controls, reconnect recovery, host succession and bounded teardown.
- **Implemented:** cancellable HTTP NDJSON and WebSocket prefixes, early entry and
  immutable later rooms without simulation reset; progression HUD and procedural audio.
- **Verified:** `npm run check`: **14 files / 172 tests**, typecheck/build passed.
  Obsolete assertions were updated with user permission; tests now fight before traversing
  and select players by identity. Non-root Docker build/start/health/config/static entry passed.
- **Browser verified:** short solo contribution/receipt/portal, actual defeat/reward/unlock,
  Q/dash/E cooldowns, four persisted memories; isolated co-op clients shared world/movement
  and truthful collapse/HQ return. No injected gameplay state/events.
- **Mocked / unverified:** provider calls mocked; no OpenAI key. Browser full victory,
  other classes, revive/retry/reconnect, audio and physical LAN outside the short pass.
- Public static fixture site: https://client-gzffunxf.devinapps.com/; HTTP-checked.
  Live/co-op Node hosting is not configured publicly. See [QA](../QA.md) and [demo](../DEMO.md).
- This Devin environment rejects PR merge commands despite user authorization.
  A maintainer must perform the final merge after required checks/reviews.

## Historical foundation handoff

## Branch / latest commit
- `main` and `feat/core` @ foundation (see `git log` — tag `foundation-v0`).
- Repo: https://github.com/Phronesis618/HackMIT2026

## What works (verified locally: `npm run check` green, 50 tests)
- Keyboard-controlled player in a Phaser canvas; HQ room with a glowing portal tile.
- `POST /api/world` returns the validated offline fixture with honest provenance/receipt.
- Room rendering from `RoomSpec` + `ArtRecipe`; exit tiles transition between committed rooms.
- Dash with cooldown + i-frames; attack **state/event only** (no damage yet).
- Enemies spawn from `RoomSpec.encounters` and stand still (no AI yet).
- Chronicle: creation receipt + arrival keepsake saved to localStorage, shown on the wall.
- Server: `/api/health`, `/api/config`, `/ws` hello/ping, static `dist/client` in production.
- CI (typecheck + test + build) passing on `main` and all `feat/*` branches.

## What remains (A)
- Slice 1: hit resolution + damage, husk AI, health/down, room clear + reward, Bastion Q/E +
  unlock transaction, return/retry.
- Slice 3: `RemoteSession`, host-authoritative sim over `/ws`, lobby, down/revive.
- Deployment smoke test of `npm run build && npm start` on a public host.

## Interface requests received
- none yet

## Integration notes for B and C
- B: implement behind `createGenerationService`/`prepareWorld(request, onStatus)` in
  `src/server/generation/index.ts`; `app.ts` already calls it.
- C: `PhaserWorldRenderer` + `RoomScene` are the registered renderer; `GameController` calls
  `renderSnapshot` per frame and `playEvents` + `chronicle.ingest` per event batch.
