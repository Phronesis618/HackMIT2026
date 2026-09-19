# RELAY — team plan (three agents, one repo, a few hours)

**Workflow (hackathon mode):** no pull requests required. Each agent works on its branch,
pushes often, and merges its own branch into `main` whenever `npm run check` is green
(`git checkout main && git pull && git merge <branch> && npm run check && git push origin main`).
A is the integration owner and fixes `main` if it breaks. Never force-push shared branches.
Never commit secrets.

| Agent | Tool           | Branch              | Owns (see AGENTS.md for exact paths)                                  |
| ----- | -------------- | ------------------- | --------------------------------------------------------------------- |
| A     | Fable (Cursor) | `feat/core`         | contracts, sim, controllers/transport, server assembly, networking, CI, deploy |
| B     | Codex          | `feat/generation`   | generation service, compiler, runtime prompts, world fixtures, gen tests |
| C     | Devin          | `feat/presentation` | renderer, audio, UI, styles, Chronicle, browser persistence, design tokens values |

## A — core (Fable)

1. **Slice 1 – real solo loop:** attack hit resolution + damage, husk AI, health, down state,
   room clear objective + reward, Bastion Q/E with one real unlock transaction, return/retry.
2. **Slice 2 – integrated opening:** HQ → contributions → generation (B) → receipt → portal →
   first room → arrival keepsake (C); recoverable generation failures; production smoke test.
3. **Slice 3 – co-op:** `RemoteSession` + host-authoritative sim over `/ws`; two browsers share
   contributions, world, enemies, damage, rewards, transitions; down/revive.
4. **Slice 4 – expand:** remaining classes, rooms 2–3, guardian/Anchor, return-to-HQ loop.
5. **Slice 5 – presentation readiness:** bugs, deployed solo build, LAN steps, DEMO/QA docs.

## B — generation (Codex)

1. Live OpenAI generation behind `createGenerationService`/`prepareWorld` with strict JSON
   schema, bounded tokens, timeout, honest provenance, labelled fixture fallback, mocked tests.
2. Deterministic compiler `WorldRecipe → RoomSpec[] + ArtRecipe` (spawn→exit path guaranteed).
3. Three visibly distinct fallback themes; later-room generation without touching committed
   rooms; real latency/token measurements.

## C — presentation (Devin)

1. HQ visual baseline (sanctuary, portal focal point, memory wall surface), one expressive
   player, portal animation; contribution UI polish. Push early.
2. Motif/prop/enemy rendering per registry; combat effects from events; creation receipt;
   arrival keepsake with thumbnail; physical memory wall; local persistence; class/unlock UI
   backed by real state; reducer tests.

## Integration rules

- Only A edits `src/shared/**`, `package.json`/lockfile, tsconfig/vite/vitest config,
  `.github/**`. Ask A with an `[integration]` issue/commit message containing the smallest patch.
- B never starts a second HTTP server or adds routes; C never builds a second engine/frontend.
- Everyone keeps `main` runnable and pushes frequently so others see progress.
- Each agent keeps its own `docs/handoffs/<X>.md` current (no shared status file).
- B/C record real tool contributions in `docs/evidence/`.

## Cut order if time runs out

voice/extra integrations → elaborate generated ornaments → extra relics/skill branches →
later-room variety → (last resort, documented) class count / run length. Never cut: the
opening, the receipt + first memory, readable responsive combat, real co-op.
