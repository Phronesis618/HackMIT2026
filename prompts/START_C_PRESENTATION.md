# START — Agent C (Devin): Visual presentation, headquarters UI and shared memories for RELAY

You are Agent C, working with Devin, on the HackMIT 2026 project **RELAY** in the repository
https://github.com/Phronesis618/HackMIT2026. You have never seen the team's chat. Everything
you need is in this file and the files it names. **Implement, run, test and repair — do not
stop at a plan.** You own BOTH the visual renderer AND the social/UI layer; there is no
separate art agent to wait for.

## 1. What RELAY is (product context)

RELAY ("Worlds end. Your stories don't.") is a desktop-browser, top-down 2D sci-fi action
roguelike. Players are operatives of a multiversal organization. At a walkable cyberpunk
headquarters they contribute ideas for a world, step through a luminous portal into a world
generated from those ideas (three connected rooms; the third has the guardian and the Anchor
site), fight, plant the Anchor, and return with shared memories displayed on a physical memory
wall. The emotional hook: *"We imagined this place together, experienced something there
together, and brought back something that remembers it."*

The presentation is 5–7 minutes with gameplay as one segment; the moments that must land are
**headquarters → world generation → first-room reveal → immediate gameplay → visible social
payoff (receipt, keepsake, memory wall)**.

**Your purpose:** one unified, original visual system and the social presentation.

Visual direction (details in `docs/ART_DIRECTION.md`):

- Original top-down 2D illustrated sci-fi. Hollow Knight / Nine Sols are references for
  atmosphere, readable silhouettes, layered depth and fluid motion — not assets to copy, and
  this is not a side-scroller.
- Headquarters: walkable cyberpunk sanctuary, luminous portal, architectural silhouettes, warm
  lights, physical memory wall.
- Restrained ink-and-neon palette, soft shadows, clear attack telegraphs, satisfying
  movement/attack/dash effects. One shared visual system across every generated theme.
- Theme differences come from **motifs, props, structures and encounters** (`ArtRecipe` +
  `RoomSpec`), rendered through your single system.

Social rules that bind you:

- Show a **creation receipt** immediately after generation (real contributions → real features;
  fixture content says so).
- Save an **arrival keepsake** when players actually enter the first room — no run completion
  required. Later memories come from actual gameplay events.
- Memories live on the **headquarters wall** with **device-local persistence**.
- **Never invent** friends, rescues, completed runs or past experiences. Memories derive only
  from `GameEvent`s.

## 2. Required reading (in order, all of it)

1. `AGENTS.md` — team rules, ownership, git workflow.
2. `docs/ART_DIRECTION.md` and `docs/ARCHITECTURE.md`.
3. `src/shared/render.ts` — the `WorldRenderer` interface you implement.
4. `src/shared/ui.ts` — `UiModel` / `UiActions`: the UI renders the model and calls the
   actions; nothing else.
5. `src/shared/contracts.ts` — `RoomSpec`, `ArtRecipe`, `GameSnapshot`, `PlayerState`,
   `EnemyState`, `GameEvent` (all variants), `MemoryRecord`, `CreationReceipt`,
   `GenerationProvenance`.
6. `src/shared/conventions.ts` — coordinates (+y down, tile = 32 px, tile vs world coords),
   `DEPTH` draw order, input bindings, event-id semantics.
7. `src/shared/registry.ts` — every `MotifId`, `PropId`, `EnemyId`, `ClassId` you must render.
   Do not rename any.
8. `src/shared/tokens.ts` (keys) + `design/tokens.json` (values you may tune).
9. `src/shared/samples.ts` — `sampleSnapshot`, `sampleEvents`, `sampleContributions`.
10. `src/client/render/RoomScene.ts`, `PhaserWorldRenderer.ts`, `drawing.ts` — the placeholder
    renderer you replace/evolve (keep the public methods).
11. `src/client/ui/*.tsx`, `src/client/styles/app.css` — the UI you own.
12. `src/chronicle/reducer.ts` and `src/client/chronicle/*` — the pure event→memory reducer
    and the localStorage adapter you own.
13. `src/sim/headquarters.ts` — the HQ room layout (A owns the layout because the simulation
    walks it; you own how it looks).
14. `tests/presentation/` — tests you must keep green and extend.
15. `docs/PRODUCT.md`, `docs/TEAM_PLAN.md`, `docs/handoffs/C.md`.

## 3. Your branch and owned paths

- Branch: **`feat/presentation`** (already on origin; `git checkout feat/presentation`).
- You own: `src/client/render/**`, `src/client/audio/**`, `src/client/ui/**`,
  `src/client/styles/**`, `src/chronicle/**`, `src/client/chronicle/**`, `design/**`,
  `tests/presentation/**`, `docs/handoffs/C.md`, `docs/evidence/devin.md`.

## 4. Forbidden edits and how to request shared changes

Do **not** edit: `src/shared/**` (including `tokens.ts` keys — values in `design/tokens.json`
are yours), `src/sim/**`, `src/server/**`, `src/client/main.tsx`, `src/client/game/**`,
`src/client/transport/**`, `package.json`, `package-lock.json`, `tsconfig.json`,
`vite.config.ts`, `vitest.config.ts`, `.github/**`, or anyone else's handoff/evidence file.

Need a new `UiModel` field, `UiActions` method, `WorldRenderer` method, `GameEvent` variant,
registry ID, token key, or a dependency (e.g. `jsdom` for DOM tests)? Comment on your
workstream issue (#3) with `[integration] <what>`, the **smallest** patch and why, then keep
working. Agent A applies shared changes on `main`. A small, purely additive change you
urgently need may be pushed directly if `npm run check` stays green — flag it in the commit
message.

## 5. The interfaces you implement (real exported names)

```ts
// src/shared/render.ts — implemented by src/client/render/PhaserWorldRenderer.ts
export interface WorldRenderer {
  mount(container: HTMLElement): Promise<void>;
  showHeadquarters(room: RoomSpec, art: ArtRecipe): void;
  showRoom(room: RoomSpec, art: ArtRecipe): void;
  renderSnapshot(snapshot: GameSnapshot, localPlayerId: string): void;
  playEvents(events: GameEvent[]): void;
  screenToWorld(px: number, py: number): { x: number; y: number };
  captureThumbnail(): Promise<string | null>;
  destroy(): void;
}
// src/shared/ui.ts — consumed by src/client/ui/App.tsx and friends
export interface UiModel { phase; connection; localPlayer; players; contributions; generation; liveGenerationAvailable; world; room; hud; memories; classStatus; preview; notice }
export interface UiActions { setDisplayName; selectClass; submitContribution; requestWorld; enterPortal; returnToHeadquarters; clearMemories; dismissNotice }
// src/chronicle/reducer.ts — pure, browser-independent
export function reduceChronicle(state: ChronicleState, events: GameEvent[], ctx: ChronicleContext): { state; created: MemoryRecord[] };
// src/client/chronicle/index.ts — browser adapter
export function createBrowserChronicle(storage: KeyValueStorage, now?: () => number): BrowserChronicle;
// src/client/audio/index.ts
export interface AudioPort { play(cue: AudioCueId): void; setMuted(m: boolean): void; isMuted(): boolean }
```

How the app is wired (do not change it, just know it): `src/client/main.tsx` constructs
`PhaserWorldRenderer`, `createBrowserChronicle(localStorage)`, `createSilentAudio()`, a
`UiStore`, and a `GameController` that feeds `renderSnapshot` every frame, `playEvents` +
`chronicle.ingest` on every event batch, and exposes `controller.actions` (a `UiActions`) to
`App`. `App` receives `{ store, actions, onStageReady }` and must call `onStageReady(el)` once
with the canvas container.

## 6. Fixtures and preview path (work without a backend or finished combat)

- `npm run dev` then open `http://localhost:5173/?world=fixture&autoenter=1` — bundled
  fixture world, no server needed, lands in room 0. `?room=2` lands in the Anchor room.
- `src/shared/samples.ts` — `sampleSnapshot` (two players, two enemies incl. one damaged),
  `sampleEvents` (dash, attack, damage, defeat, room_entered, world_prepared), all with
  `sample-`/`test-` prefixed ids so they can never be mistaken for real memories.
- `fixtures/worlds/vantage-spire.json` — a full 3-room `WorldFixture`.

## 7. Ordered first deliverables

1. **Coherent visual baseline (PR #1, within the first hour, even if small).** Replace the
   placeholder headquarters look in `RoomScene.buildRoom(..., { headquarters: true })`: sanctuary
   silhouettes, warm lamps, the portal as the luminous focal point, a wall surface where memories
   will hang. Keep the tile grid and the `X` portal tile position from `headquartersRoom`
   walkable and visible. One expressive player: readable silhouette, facing, idle/move/dash
   poses (procedural or original sprite sheets under `design/`). Portal animation.
2. **Contribution interface** in `HeadquartersPanel.tsx` connected to the existing
   `UiModel`/`UiActions` — make it inviting and demo-legible (large type, who-said-what). Show
   `generation.phase/message/elapsedMs` as a real progress state.
3. **Theme/motif rendering.** Render every `MotifId` (skyline + decals), every `PropId`,
   every `EnemyId` distinctly, driven by `ArtRecipe` + `RoomSpec`. Hazard tiles readable.
   Exit tiles inviting. Anchor site unmistakable.
4. **Combat feel** from events: `player_dashed` trail, `player_attacked` telegraph arc,
   `enemy_damaged`/`player_damaged` hit flashes, `enemy_defeated` burst, `room_entered`
   reveal. Effects are driven **only** by `GameEvent`s and `GameSnapshot` states.
5. **Creation receipt** (`WorldPanel.tsx`) that celebrates real attribution and is honest when
   the world is a fixture (`provenance.source`, `receipt.lines[].used`).
6. **Arrival keepsake + memory wall**: polish the `arrival_keepsake` card with the captured
   thumbnail (`captureThumbnail` is already called by the controller), make the wall feel
   physical in HQ, add `milestone` memories from real events (e.g. first `enemy_defeated`,
   `anchor_planted`) in `src/chronicle/reducer.ts` with dedupe by event id.
7. **Class/unlock controls** backed by the truthful `classStatus` in `UiModel` — planned
   classes must read as planned.
8. **Tests** in `tests/presentation/`: reducer creates receipt + keepsake exactly once per
   world, dedupes repeated event ids, milestone rules, `loadMemories` salvages valid entries and
   drops invalid ones, tokens JSON still matches the schema.
9. **Audio** (optional, later): original or licensed cues behind `AudioPort`; keep
   `createSilentAudio` as the default until assets exist.

## 8. Commands and acceptance criteria

```bash
npm ci
npm run dev                          # http://localhost:5173  (server :8787)
npm test -- tests/presentation
npm run check                        # typecheck + all tests + build; green before a PR
```

Accept when: HQ reads as a lit sanctuary with a portal focal point; every registry ID renders
distinctly; dash/attack/hit effects fire from events only; the receipt and memory wall show
exactly what happened (fixture labelled as fixture); memories persist across reload on the
same device; `npm run check` is green; screenshots attached to the PR.

## 9. Shipping (hackathon mode — no pull requests)

- Commit small; **push `feat/presentation` every few minutes** so teammates see updates on
  GitHub.
- Merge into `main` yourself as soon as the HQ visual baseline runs, then after each
  deliverable: `git fetch origin && git merge origin/main && npm run check && git checkout
  main && git pull && git merge feat/presentation && git push origin main`. Keep `main` green.
- Update `docs/handoffs/C.md` after every merge (branch + latest commit, what works, what
  remains, exact test results, integration requests, notes for A). State **implemented /
  mocked / unverified** explicitly; put screenshots under `docs/evidence/` (no secrets).
- Record real Devin contributions in `docs/evidence/devin.md`.

## 10. Working style

Fetch `origin/main` and merge it before new work; never rewrite a shared branch. Do not build a
second engine, scaffold another frontend, add frameworks/CSS libraries, or redesign the
architecture. Use only original assets or assets whose license permits this use, and say
which. When blocked on a shared change, send the integration request and continue elsewhere in
your scope.
