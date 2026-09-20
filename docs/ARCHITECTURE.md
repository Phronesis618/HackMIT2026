# RELAY — architecture

One TypeScript repo, one `package.json`, one Node service. Vite + React for the DOM shell,
Phaser 3.90 for the canvas, a pure TypeScript simulation, a Node HTTP server with a small
WebSocket layer, Zod for every trust boundary, Vitest for tests. Node ≥ 20.19 (dev on 26.7).

```
browser (solo)                                    Node server (one process)
┌────────────────────────────────────────┐        ┌──────────────────────────────────┐
│ React UI  ── UiActions ──▶ GameController│        │ /api/health  /api/config         │
│   ▲ UiModel                │           │  fetch  │ /api/world ─▶ GenerationService  │
│ Phaser renderer ◀ snapshots/events      │ ◀─────▶ │   (B: live model ▸ compiler)     │
│   ▲                        │           │         │   fixture fallback (validated)   │
│ WorldRenderer ◀── GameSession (Local) ──│         │ /ws  realtime (A: multiplayer)   │
│                     │  pure sim (src/sim)│        │ dist/client static (production)  │
│ Chronicle reducer ◀─┘ events            │        └──────────────────────────────────┘
│ localStorage adapter                    │
└────────────────────────────────────────┘
```

## Folders and owners

| Path                           | Owner | Purpose                                                              |
| ------------------------------ | ----- | -------------------------------------------------------------------- |
| `src/shared/`                  | A     | Zod contracts, registry, conventions, tokens keys, interfaces        |
| `src/sim/`                     | A     | Pure simulation (no Phaser/React/DOM/HTTP/timers)                    |
| `src/client/main.tsx`          | A     | Application assembly                                                 |
| `src/client/game/`             | A     | `GameController`, input, UI store                                    |
| `src/client/transport/`        | A     | `LocalSession`, streaming world providers, `RemoteSession`            |
| `src/server/{index,app,config}.ts` | A | HTTP assembly, routes, server-only config                            |
| `src/server/network/`          | A     | WebSocket realtime                                                   |
| `src/server/generation/`       | B     | `GenerationService`: live provider, compiler, fixture fallback       |
| `prompts/runtime/`             | B     | Runtime model instructions                                           |
| `fixtures/worlds/`             | B     | Validated `WorldFixture` JSON                                        |
| `src/client/render/`           | C     | `PhaserWorldRenderer`, `RoomScene`, drawing                          |
| `src/client/ui/`, `styles/`    | C     | React panels, CSS (tokens via CSS variables)                         |
| `src/client/audio/`            | C     | Gesture-unlocked procedural Web Audio and persistent mute            |
| `src/chronicle/`               | C     | Pure event → memory reducer                                          |
| `src/client/chronicle/`        | C     | localStorage adapter, thumbnails                                     |
| `design/`                      | C     | `tokens.json` values, original assets                                |
| `tests/{shared,sim,integration}` | A   | Contract, sim and end-to-end tests                                   |
| `tests/generation`, `tests/presentation` | B, C | Owner tests                                                 |

## Data flow and contracts (all real exports)

- **Identity/contributions:** `PlayerIdentity`, `Contribution` — `src/shared/contracts.ts`.
- **Generation:** `GenerationRequest` → `GenerationService.prepareWorld()`
  (`src/server/generation/index.ts`) → `PreparedWorld` { `recipe: WorldRecipe`, `rooms:
  RoomSpec[]`, `art: ArtRecipe`, `provenance: GenerationProvenance`, `receipt:
  CreationReceipt` }. `GenerationStatus` streams phases. `WorldFixture` is the on-disk format.
- **Simulation I/O:** `PlayerIntent` in; `GameSnapshot` + `GameEvent[]` out
  (`createSimulation()` in `src/sim/simulation.ts`). Event ids are `${tick}:${n}` from the
  authority, `meta:${n}` for session-level events.
- **Session:** `GameSession` (`src/shared/session.ts`) — `LocalSession` runs in-process;
  `RemoteSession` consumes authoritative WebSocket snapshots/events through the same
  renderer/UI/Chronicle interface.
- **Renderer:** `WorldRenderer` (`src/shared/render.ts`) — draws snapshots and plays events;
  never decides gameplay.
- **UI:** `UiModel`/`UiActions` (`src/shared/ui.ts`) — UI renders the model and calls actions;
  `GameController` is the only writer of the store and the only caller of the session.
- **Chronicle:** `reduceChronicle(state, events, ctx)` (`src/chronicle/reducer.ts`) is pure and
  deterministic (`ctx.now` injected). `createBrowserChronicle(localStorage)` persists.
- **Protocol:** `ClientMessage`/`ServerMessage` (`src/shared/protocol.ts`), validated both ways.
- **Tokens:** keys `src/shared/tokens.ts` (`VisualTokensSchema`), values `design/tokens.json`,
  applied to `:root` as CSS variables and read by Phaser via `hexToInt`.

## Lore is shown, not told

Worldbuilding never reaches the player as sidebar prose. Every path is data → trusted code
→ an in-world moment → a real event, so the Chronicle and the Codex only ever contain what
was actually found:

| Source (data)                          | Placed / triggered by                  | Player experience                                   | Event / record                          |
| -------------------------------------- | -------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `recipe.lore[]` kind `relic`           | compiler → `RoomSpec.relics` (open floor, off the critical route) | glowing tablet on the floor; hold F beside it to read | `lore_discovered` → `lore` memory, Codex |
| `recipe.lore[]` kind `remains`         | sim, first defeat of that `enemyId` per run | shard drops where the enemy fell; pick up by touch | `lore_discovered` → `lore` memory, Codex |
| `RoomSpec.attributions` + receipt lines | renderer, proximity                    | a contributor's own words appear beside the prop/encounter their idea shaped | (renderer only)                         |
| `RoomBlueprint.description`            | renderer, room entry                   | one fading title card over the room                 | (renderer only)                         |

The model writes fragments (`prompts/runtime/world-recipe.md`) in an in-world voice; the
schema bounds them (`LoreFragmentSchema`); fixtures carry hand-authored ones so the loop is
demoable offline. `GameSnapshot.loreNodes` is the authoritative state of what is lying in
the current room and `discoveredLore` what this run has found. Next steps a future agent
can build on the same rails: NPC echoes (a fragment kind that speaks when approached),
guardian phase lines, and lore-gated rooms.

## Conventions (see `src/shared/conventions.ts`)

Pixels are world units; +y is down; tile = 32 px; entity positions are world-space centres;
prop/exit/encounter coordinates are tile coords; angles in radians, 0 = +x, clockwise on
screen. Fixed 60 Hz tick. Circles vs tile AABBs with per-axis slide. Depth bands in `DEPTH`,
entities y-sorted within their band. Inputs in `INPUT_BINDINGS`; buttons are edge-triggered
per tick and merged by the session so presses between ticks are not lost.

## Boundaries that must hold

- Simulation never imports Phaser/React/DOM/HTTP. Tests run it in Node.
- Model output is data; compiled by trusted code; validated with `PreparedWorldSchema` before
  it reaches a client; the client validates again.
- One host/controller owns generation for a multiplayer run.
- Renderer and UI never mutate game state; Chronicle only consumes real events.

## Runtime modes

- `npm run dev`: server `:8787` + Vite `:5173` proxying `/api` and `/ws`.
- `npm run build && npm start`: one Node process serves `dist/client` + API + WS on `PORT`.
- LAN: `--host 0.0.0.0` / `HOST=0.0.0.0` / `npm run dev:lan`.
- Preview: `?world=fixture[&room=N|&autoenter=1]` loads the bundled fixture in the browser.

## Config boundary

`src/server/config.ts` reads `PORT`, `HOST`, `RELAY_GENERATION_MODE`, `RELAY_AI_PROVIDER`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, and `OPENAI_MODEL` (plus a tiny
`.env` loader). Provider selection is shared by solo and co-op generation.
`describeForClient()` is the only configuration shape that
leaves the server (`/api/config`): `{ generationMode, liveGenerationAvailable }`.
