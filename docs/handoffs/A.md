# Handoff — Agent A (Fable, `feat/core`)

## Overnight (Sep 20, 02:40–05:30 ET) — composer, world rules, overlay, party frames, start screen

Local commits on Jeffrey's machine, merged with `origin/main` through `c1abe97` (floors,
writing pipeline, hub, tiles, boss finale, co-op verify, UI audit); `npm run check` green at
**838 tests / 71 files** (merged through `8843860`, M1 world laws). Pushing was deferred to a human (the agent's pushes need approval).

- **Implemented — offline composer (`src/server/composer/`, "Jeffrey's area" per the overnight
  plan):** `RELAY_AI_PROVIDER=composer` builds a validated `WorldRecipe` from the crew's ideas in
  ~1–20 ms, no model call. Sixteen themes (motifs, palette, room banks, enemy/prop pools,
  hazards, relic/remains lore in each theme's voice, attunements); keyword theme selection with
  a secondary-theme middle room; player words echoed into title/room names/lore; mappings only
  for features actually placed (compiler cross-check tested); up to two `rules`; **eight floors
  `BiomeBrief`s** across three themes so a floors run through a composed world changes vocabulary
  at every fork (`resolveBiomeBriefs` uses them, tested with `upgradeToFloors`). New provenance
  source `procedural` (`ATTRIBUTING_SOURCES` = live + procedural) — badge `COMPOSED · relay-composer`,
  never `live`. `RecipeProvider` gained optional `source`/`badge`; the generation service takes a
  `fallbackProvider` so a failed Claude/GPT/operator attempt yields a composed world (with the
  failure in its notes) instead of a canned fixture. `.env` on this laptop runs the composer.
- **Retired — my interim world rules.** I had shipped 8 implemented `rules` overnight; when M1's
  laws harness landed (`src/sim/laws.ts`, 8 laws in the sim + long_dark in the renderer) I removed
  the duplicate system rather than stack two modifier layers. What survives from it: hazard floor
  ('~') now bites 6 Integrity every 0.7 s while stood in (dashing across is free) and hostiles pay
  `ENEMY_INFO.shards` (1–8) on defeat. The composer writes 1–2 **laws** per theme in the world's
  voice (`THEME_LAWS` / `LAW_VOICE` in `compose.ts`, through `sanitizeLaws`), drawn only from the
  in-force set, so composed worlds show real laws on the world panel and HUD chips.
- **Implemented — app shell:** `GenerationOverlay` (forming ring with the crew's ideas orbiting →
  reveal card with title, tagline, palette, rooms, rule chips, honest idea counts, real duration;
  pure state machine in `generationOverlayState.ts`, tested); `PartyPlate` (class portrait +
  Integrity + ult/resources for the local operative, compact frames for crewmates, rule chips);
  `StartScreen` (premise, run loop, controls, class/name pick, solo vs LAN co-op; once per tab,
  `?start=0/1`); bigger pop-in damage/heal numbers and an in-world exit label in `RoomScene`;
  `GameController` syncs connection status on a timer (no false "offline" in throttled tabs) and
  publishes crew vitals + world palette/rooms/rules to the UI model.
- **Implemented — skill tree goes live:** `Simulation.learnSkill(playerId, skillId)` (protocol
  `learn_skill`, `GameSession.learnSkill`, `UiActions.learnSkill`, event `skill_learned`,
  `PlayerState.skills`). Seven nodes have real effects (`IMPLEMENTED_SKILLS` in `skills.ts`):
  core.plating / core.wind / core.salvage, bastion.sweep, shade.edge, beacon.reach, weaver.loom.
  The Tab menu's Skills page has a Learn button (sanctuary/debrief/training only); learned nodes
  tick, live nodes glow. Spends the same `resources` ECONOMY.md calls Salvage; kills now pay
  `ENEMY_INFO.shards` (1–8) on expeditions — an earn source to add to ECONOMY §3's table.
- **Composer ↔ W2 pipeline:** composed text passes `lintRecipeText` with zero hard failures
  (test in `tests/integration/composer.test.ts`); composer recipes carry no `bible`, so the
  pipeline keeps them without a repair round. `RELAY_FLOORS=1` + composer = floors world on
  the composer's eight briefs (tested).
- **Dropped during the merge:** an interim 3-biome recipe extension of mine (superseded by floors).
- **Verified:** unit/integration tests above; composer output inspected for ~20 prompts;
  browser: HQ + composed world + party frames + start screen screenshots on the merged build.
- **Unverified / open:** reveal-card and forming-ring visuals on the merged layout (Cursor's tab
  cannot run rAF unfocused; logic is unit-tested); live Claude/GPT still not run against a real
  key; HQ **shop / currency spend** and in-room **NPC witnesses** not built — left for the morning
  so they extend H1's hub (`HeadquartersStations`) and ECONOMY.md/ITEMS.md rather than fork them.

## Terrain, Custodian finale, and Stillpoint sanctuary — 2026-09-20

- Branch: `devin/1789887155-terrain-boss-sanctuary`; integration commits through `e1e43c2`.
- Implemented: bounded terrain recipes, deterministic fixtures, attackable barriers with
  per-room damage persistence, raised crossings, rubble/conduit movement, and snapshot rendering.
  Three Guardian health phases introduce charges, denser rings, and exposed recovery windows.
  Final rooms charge three relays under expanding pulses, then discharge the central Anchor.
  Legacy rooms without relay metadata preserve the old interaction.
- Implemented: walkable Stillpoint with four class shrines, device-local Archive records,
  Observatory, training access, and the existing portal/contribution flows. Station actions
  read authoritative snapshots; the server remains authoritative for class changes.
- Shared changes are additive: optional recipe terrain, room relay sites, boss phase/recovery,
  Anchor ritual, snapshot terrain, and UI station state/actions. Registry adds five tile
  characters. No dependency changes.
- Verified: `npm run check` passes: 288 tests across 30 files, typecheck and production build.
  Following approval on PR #16 (comment 5748345520), the existing collision test walks to
  the Stillpoint pillar and outer walls with the same bounded assertions; `compactWorld`
  supplies local relay coordinates; the Phaser mock adds `strokeEllipse` and `fillTriangle`.
- Mocked: renderer unit tests use Phaser display mocks; no new gameplay stubs.
- Unverified: live model generation and browser/co-op playthrough of the integrated expansion.
  The team requested to handle the merge of PR #16. Demo instructions are in `docs/DEMO.md`.

## Operator mode + world dressing (Sep 20, early morning)

- **Implemented — operator generation transport (demo-only):** `RELAY_AI_PROVIDER=operator`
  with `RELAY_GENERATION_MODE=live` writes each world request to `.relay/operator/inbox/` and
  waits for a `WorldRecipe` reply in `outbox/` (`src/server/operator/provider.ts`, wired in
  `src/server/app.ts`; additive `recipeProvider` hook + `provider` in `GenerationServiceInfo`
  in B's `src/server/generation/index.ts`). Replies are validated exactly like API output
  (Zod, text guard, compiler); invalid replies are re-issued with `repair` until the deadline
  (`RELAY_OPERATOR_TIMEOUT_MS`, default 180 s), then a labelled fixture is served. Provenance
  is `live` / `LIVE · cursor-agent`. Pre-flight for the operator: `npx tsx
  scripts/operator-validate.ts <reply.json>`. Runbook in `docs/DEMO.md`.
- **Verified:** `tests/integration/operator.test.ts` (8 tests: request file contents, accept,
  repair round-trip, upstream repair, text guard, timeout fallback, abort, HTTP wiring). Two
  real end-to-end runs in the browser with the Cursor agent answering: "The Drowned Carillon"
  (accepted, 63 s) and "The Black Ledger Flotilla" (accepted, 53 s, entered room 1). One
  earlier request fell back after two over-length taglines — the reason the repair loop and
  validator exist.
- **Implemented — world dressing (`src/client/render/dressing.ts`):** the dominant motif
  now decides the room's construction, not just its tint: floor material (lattice / flagstone /
  grating / crystal / organic / slabs / boards), wall dressing (pinnacles, arch openings, pipe
  runs, crystal shards, tendrils, glyph bands, hanging lanterns, gears + vents), floor clutter,
  low-alpha overhead structure (catenaries, vault ribs, lantern strings, canopy, stalactites,
  chains) and particle atmosphere (sparks, dust, flicker, glints, spores, ash, fireflies,
  embers). `showRoom(..., world)` (additive optional param) labels every room with the world
  title and stencils title + tagline into the arrival room's floor. `ProvenanceBadge` no
  longer repeats the model name.
- **Verified:** screenshots of spires, ruined_machinery, arches, roots and crystals rooms are
  visibly different materials/colours; `npm run check` green (229 tests / 20 files).
- **Unverified:** API-key providers still not run against a real key (none available here);
  operator latency depends on the agent (~1 min); Cursor's embedded browser tab freezes
  Phaser's rAF loop when unfocused, so screenshots there need forced `game.step()` frames.

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
