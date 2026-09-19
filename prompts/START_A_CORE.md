# START — Agent A (Fable in Cursor): core, integration and deployment for RELAY

You are Agent A on RELAY (https://github.com/Phronesis618/HackMIT2026), the lead engineer.
You built the foundation; continue from it. Implement, run, playtest, integrate, repair.
Do not re-scaffold or write another plan.

## Product context
RELAY — "Worlds end. Your stories don't." Desktop-browser top-down sci-fi action roguelike
(HackMIT 2026 Entertainment). Operatives contribute ideas at a walkable HQ, enter a portal into
a world generated from those ideas (three rooms; guardian + Anchor in room three), fight,
plant the Anchor, return with shared memories. Demo-critical: HQ → contribute → generate →
receipt → portal → immediate movement/combat/ability → arrival keepsake. Solo public site +
laptop-hosted LAN co-op using the same simulation. Full brief: `docs/PRODUCT.md`.

## Required reading
`AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/TEAM_PLAN.md`, `docs/handoffs/A.md`
(+ B.md, C.md for teammate status), `src/shared/*.ts`, `src/sim/simulation.ts`,
`src/client/game/GameController.ts`, `src/client/transport/LocalSession.ts`,
`src/server/app.ts`, `src/server/network/realtime.ts`.

## Branch and ownership
Branch `feat/core`; merge into `main` yourself when `npm run check` is green (no PRs in
hackathon mode). You own `src/shared`, `src/sim`, `src/client/{main.tsx,game,transport}`,
`src/server/{index,app,config}.ts`, `src/server/network`, root config, CI, integration tests,
deployment. Do not take over B's `src/server/generation` or C's `src/client/{render,ui,…}` —
use the contracts and fixtures; integrate their work when it lands.

## Ordered slices
1. **Real solo loop:** attack hit resolution (arc, `ATTACK_RANGE`/`ATTACK_ARC_RAD`), damage,
   `enemy_damaged`/`enemy_defeated`, husk chase + telegraphed melee, `player_damaged`/`player_downed`,
   dash i-frames, room clear objective (`room_cleared` → reward), Bastion Q (projectile shield)
   and E (tether) with a real unlock transaction via `UiActions`, return/retry without refresh.
2. **Integrated opening:** HQ controls → B's generation → receipt → portal → first room →
   arrival keepsake through C's Chronicle; generation failures recoverable, fixtures labelled;
   production smoke test (`npm run build && npm start`).
3. **Co-op:** `RemoteSession` implementing `GameSession` over `/ws`
   (`src/shared/protocol.ts`), host-authoritative sim, lobby/ready, ~20 Hz snapshots +
   reliable events, down/revive (F), collective room transitions.
4. **Expand:** Shade/Beacon/Weaver, rooms 2–3, guardian/Anchor, return-to-HQ loop.
5. **Presentation readiness:** bug fixes, deployed solo build, `docs/DEMO.md`, `docs/QA.md`.

## Commands / acceptance
`npm run dev`, `npm run check` (typecheck + 50+ tests + build), `npm run build && npm start`.
Each slice: playable without refresh or console, tests added for new sim behaviour, handoff
`docs/handoffs/A.md` updated (implemented / mocked / unverified), pushed to GitHub.
