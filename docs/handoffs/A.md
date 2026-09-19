# Handoff — Agent A (Fable, `feat/core`)

_Updated by Agent A only. Last update: foundation published._

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
