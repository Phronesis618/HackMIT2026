# START — Agent B (Codex): Runtime AI world generation for RELAY

You are Agent B, working with OpenAI Codex, on the HackMIT 2026 project **RELAY** in the
repository https://github.com/Phronesis618/HackMIT2026. You have never seen the team's chat.
Everything you need is in this file and the files it names. **Implement, run, test and repair
— do not stop at a plan.**

## 1. What RELAY is (product context)

RELAY ("Worlds end. Your stories don't.") is a desktop-browser, top-down 2D sci-fi action
roguelike. Players are operatives of a multiversal organization. At headquarters they each
contribute a short idea for a world. A portal opens into a world generated from those ideas:
three connected rooms, the third holding a guardian and the Anchor site. Players fight through,
plant the Anchor, and return with shared memories. The emotional hook: *"We imagined this
place together, experienced something there together, and brought back something that
remembers it."*

**Your purpose:** make world generation real, fast, safe and honest. Runtime AI produces
**validated structured data**, never code. Pipeline:

```
player contributions -> WorldRecipe (model output, bounded JSON)
                     -> validation + deterministic compiler (trusted TypeScript)
                     -> RoomSpec[] + ArtRecipe (what the renderer and simulation consume)
```

Product rules that bind you:

- Theme differences must show in **structures, motifs, props and encounters** — not only
  palette or flavor text.
- **First room first.** Target first-room readiness within **60 seconds**. A bounded live
  attempt must resolve to a **clearly labelled** playable fallback when it fails.
- Later rooms may be generated while players play, but a **committed room never changes**.
- **Never present fixture or cached content as fresh generation.** Provenance must be truthful:
  `source: 'fixture' | 'live' | 'live_fallback_fixture'`.
- **No model calls in the combat loop.** Generation is request/response on the server.
- **No** generated HTML, JavaScript, SVG/XML, external asset URLs or executable expressions.
- Attribute **actual** player contributions to **observable** world features
  (`contributionMappings`, `RoomSpec.attributions`, and the creation receipt).

## 2. Required reading (in order, all of it)

1. `AGENTS.md` — team rules, ownership, git workflow.
2. `docs/ARCHITECTURE.md` — boundaries and data flow.
3. `src/shared/contracts.ts` — **the** schemas you must satisfy: `GenerationRequestSchema`,
   `WorldRecipeSchema`, `RoomSpecSchema`, `ArtRecipeSchema`, `PreparedWorldSchema`,
   `GenerationProvenanceSchema`, `GenerationStatusSchema`, `CreationReceiptSchema`,
   `WorldFixtureSchema`.
4. `src/shared/registry.ts` — the closed ID sets (`MOTIF_IDS`, `PROP_IDS`, `ENEMY_IDS`,
   `TILE_CHARS`) you may emit. Unknown IDs fail validation.
5. `src/shared/conventions.ts` — tile grid, coordinates, what tile chars mean.
6. `src/server/generation/index.ts`, `fixtureService.ts`, `receipt.ts` — the exact interface
   you implement behind and the fallback you reuse.
7. `src/server/config.ts` — how `OPENAI_API_KEY`, `OPENAI_MODEL`, `RELAY_GENERATION_MODE`
   reach you (server-only; never expose them).
8. `fixtures/worlds/vantage-spire.json` — a validated fixture; copy its shape for new ones.
9. `tests/generation/` — existing tests you must keep green.
10. `docs/PRODUCT.md`, `docs/TEAM_PLAN.md`, `docs/handoffs/B.md`.

## 3. Your branch and owned paths

- Branch: **`feat/generation`** (already exists on origin; `git checkout feat/generation`).
- You own: `src/server/generation/**`, `prompts/runtime/**`, `fixtures/worlds/**`,
  `tests/generation/**`, `docs/handoffs/B.md`, `docs/evidence/codex.md`.

## 4. Forbidden edits and how to request shared changes

Do **not** edit: `src/shared/**`, `src/sim/**`, `src/client/**`, `src/server/app.ts`,
`src/server/index.ts`, `src/server/config.ts`, `src/server/network/**`, `package.json`,
`package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.github/**`,
or anyone else's handoff/evidence file.

If you need a schema field, a new registry ID, an env var or a dependency (for example an
OpenAI SDK — note the foundation has **no** OpenAI dependency; use `fetch` against the
Responses/Chat Completions HTTP API unless A approves adding a package): open an issue or PR
titled `[integration] <what>` with the **smallest** patch and the reason, then keep working
with the current contract. Agent A merges shared changes.

## 5. The interface you implement (real exported names)

`src/server/generation/index.ts` exports:

```ts
export interface GenerationService {
  prepareWorld(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void): Promise<PreparedWorld>;
  info(): GenerationServiceInfo; // { requestedMode, effectiveMode, liveConfigured, liveImplemented, fixtureIds }
}
export function createGenerationService(options: {
  mode: 'fixture' | 'live'; openaiApiKey: string | null; openaiModel: string; fixturesDir: string; log?: (m: string) => void;
}): GenerationService;
```

`src/server/app.ts` (Agent A) calls `createGenerationService(...)` once at startup and
`prepareWorld(request, onStatus)` for every `POST /api/world`. Keep both signatures. Set
`liveImplemented: true` only when live generation actually works.

Helpers you can reuse: `loadWorldFixtures(dir)`, `prepareFromFixture({...})` (in
`fixtureService.ts`) and `buildReceipt({...})` (in `receipt.ts`). `prepareFromFixture` accepts
`source: 'live_fallback_fixture'`, `attempts`, `notes` and `model` so a failed live attempt
produces honest provenance.

Types you produce/consume (all in `src/shared/contracts.ts`): `GenerationRequest`
(`requestId`, `sessionId`, `contributions[]`, `seed?`, `plannedRoomCount`), `WorldRecipe`,
`RoomSpec` (ASCII `tiles` rows using `#`, `.`, ` `, `~`, `P`, `X`, `A`; exactly one `P`; every
`X` has a matching `exits` entry; the final room has exactly one `A`), `ArtRecipe`
(`paletteFamily: 'ink-neon'`, hex `palette`, `motifIds`, `skyline`, `fog`, `glowIntensity`),
`PreparedWorld` (`rooms[i].index === i`, `rooms.length <= plannedRoomCount`,
`isFinal` only on the last planned room), `GenerationProvenance`, `CreationReceipt`.

Run `npm test -- tests/generation` to see validation failures spelled out.

## 6. Ordered first deliverables

1. **Live provider behind the interface.** `src/server/generation/liveService.ts` (or similar)
   that, when `mode === 'live'` and a key exists, calls OpenAI with a **strict JSON schema
   derived from `WorldRecipeSchema`** (no free-form text output), `max_output_tokens` bounded,
   a hard timeout (start with 25 s), and `AbortController`. Put the model instructions in
   `prompts/runtime/world-recipe.md` (or `.txt`) and load them from disk — no prompt text in
   code. Include the allowed registry IDs in the prompt from `src/shared/registry.ts` at runtime
   so they can never drift.
2. **Compiler.** `src/server/generation/compiler.ts`: deterministic `WorldRecipe ->
   RoomSpec[] + ArtRecipe`. Rooms are 18–28 wide, 12–16 tall, bordered walls, one `P`, exits
   to the next room, `A` in the final room, props/encounters from the blueprint's IDs placed on
   floor tiles without blocking the spawn-to-exit path (simple flood fill check). Repair rather
   than reject when possible; log what you repaired into `provenance.notes`.
3. **Honest provenance + receipt.** `source: 'live'`, `model`, `attempts`, `durationMs`.
   Map each contribution to a real feature (`contributionMappings` → `RoomSpec.attributions`
   → receipt lines with `used: true`). Unused contributions stay `used: false`.
4. **Fallback.** Any failure (no key, timeout, HTTP error, invalid JSON, schema failure after
   one repair attempt) → `prepareFromFixture({ source: 'live_fallback_fixture', attempts,
   notes: [why] })`. Startup with no key must keep working exactly as today.
5. **Status streaming.** Call `onStatus` at `queued`, `generating`, `validating`, `ready` /
   `fallback` / `failed` with elapsed ms so the UI can show progress.
6. **Tests with mocked provider responses** in `tests/generation/`: valid recipe compiles and
   validates; recipe with unknown IDs is repaired or falls back; timeout → fallback with
   `live_fallback_fixture`; missing key → fixture; compiler output always passes
   `PreparedWorldSchema`. **No real API calls in tests.** Inject `fetch` (or the provider
   function) so tests can stub it.

Then:

7. **Three visibly distinct fallback themes** in `fixtures/worlds/` (different motifs, props,
   encounters and layouts — not just colors). Each must pass `WorldFixtureSchema`
   (`tests/shared/contracts.test.ts` validates every file in that folder).
8. **Later-room generation**: `prepareWorld` returns room 0 fast; rooms 1–2 are produced
   afterwards without changing room 0. Propose the delivery mechanism (e.g. an
   `onRoomCommitted` callback or a `GET /api/world/:id/rooms` poll) to A as an integration
   request — do not add routes yourself.
9. **Measure**: real latency, token counts and request counts for a live run; record them in
   `docs/evidence/codex.md` and `docs/handoffs/B.md`.

## 7. Commands and acceptance criteria

```bash
npm ci
npm run dev                 # server :8787 + client :5173; click "Prepare world"
npm test -- tests/generation
npm run check               # typecheck + all tests + build; must be green before a PR
curl -s localhost:8787/api/health
curl -s -X POST localhost:8787/api/world -H 'content-type: application/json' \
  -d '{"requestId":"req-1","sessionId":"s-1","contributions":[],"plannedRoomCount":3}' | head -c 400
```

Accept when: with a key and `RELAY_GENERATION_MODE=live`, `POST /api/world` returns a
`PreparedWorld` with `provenance.source === 'live'` whose rooms differ visibly from the fixture
and whose receipt attributes real contributions; without a key, startup and requests behave
exactly like the foundation; with a stubbed failing provider, the result is
`live_fallback_fixture` with the reason in `notes`; `npm run check` is green.

## 8. Submitting

- Commit small and often; push `feat/generation` to origin frequently so teammates see progress.
- Open a PR to `main` as soon as deliverable 1–4 work (even partially, clearly labelled). Use
  the PR template; state **implemented / mocked / unverified** explicitly.
- Update `docs/handoffs/B.md` after every PR: branch + latest commit, what works, what remains,
  exact `npm test` output summary, integration requests, how A should integrate.
- Record real Codex contributions (commits, PRs, tests run) in `docs/evidence/codex.md`.

## 9. Working style

Fetch `origin/main` before new work and merge it into your branch; never rewrite shared
history. Do not scaffold a replacement app, add speculative dependencies, or redesign the
architecture. When blocked on a shared change, send the integration request and continue on
something else in your scope. Distinguish clearly, always, between what you implemented, what
is mocked, and what is unverified.
