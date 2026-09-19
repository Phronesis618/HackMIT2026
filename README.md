# RELAY

**Worlds end. Your stories don't.**

A desktop-browser, top-down 2D sci-fi action roguelike for HackMIT 2026 (Entertainment track).
Operatives of a multiversal organization pitch ideas for a world at headquarters, step through
a portal into a world generated from those ideas, fight through three rooms, plant an Anchor to
stop the collapse, and come home with shared memories that remember what happened.

Repository: https://github.com/Phronesis618/HackMIT2026

## Quick start

Requires Node **>= 20.19** (developed on Node 26.7.0 / npm 11.19; `.nvmrc` says 26).

```bash
npm ci                # or npm install
cp .env.example .env  # optional; everything works without it
npm run dev           # server on http://127.0.0.1:8787 + Vite client on http://localhost:5173
```

Open http://localhost:5173. You spawn in headquarters. Move with **WASD/arrows**, dash with
**Shift/Space**, attack with **J/click** (no damage yet). Click **Prepare world** — the server
returns the validated offline fixture, clearly labelled **OFFLINE FIXTURE** — then walk onto the
glowing portal (or press **Enter portal**) to enter room 1 of the generated world.

### Scripts

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm run dev`       | Server (tsx watch) + Vite dev client with `/api` + `/ws` proxy         |
| `npm run dev:lan`   | Same, bound to `0.0.0.0` so a second laptop can connect                |
| `npm run typecheck` | `tsc --noEmit` over client, server, shared, sim, tests                 |
| `npm test`          | Vitest, non-interactive, no network, no paid API calls                 |
| `npm run build`     | Production client bundle to `dist/client`                              |
| `npm start`         | One Node process serving `dist/client` + `/api` + `/ws` on `PORT`      |
| `npm run check`     | typecheck + test + build (what CI runs)                                |

### LAN / two-laptop presentation

```bash
npm run build && HOST=0.0.0.0 npm start        # or: npm start -- --host 0.0.0.0
# teammates open http://<your-lan-ip>:8787
```

Real multiplayer (host-authoritative simulation over `/ws`) is Agent A's next slice; today the
server accepts WebSocket connections and answers `hello`/`ping` only.

### Preview path (no backend needed)

- `http://localhost:5173/?world=fixture` — load the bundled fixture world in the browser
- `http://localhost:5173/?world=fixture&room=1` — jump straight into room index 1
- `http://localhost:5173/?world=fixture&autoenter=1` — enter room 0 immediately

## Team and ownership

Three humans, three agents, one repo. **Read [`AGENTS.md`](AGENTS.md) first.**

| Agent | Tool               | Branch              | Owns                                                             | Start prompt                                                   |
| ----- | ------------------ | ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| A     | Fable (Cursor)     | `feat/core`         | contracts, sim, controllers, networking, integration, deployment | [`prompts/START_A_CORE.md`](prompts/START_A_CORE.md)           |
| B     | Codex              | `feat/generation`   | runtime AI world generation + safe compiler                      | [`prompts/START_B_GENERATION.md`](prompts/START_B_GENERATION.md) |
| C     | Devin              | `feat/presentation` | rendering, audio, UI, Chronicle (memories), visual tokens        | [`prompts/START_C_PRESENTATION.md`](prompts/START_C_PRESENTATION.md) |

Docs: [`docs/PRODUCT.md`](docs/PRODUCT.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/ART_DIRECTION.md`](docs/ART_DIRECTION.md) · [`docs/TEAM_PLAN.md`](docs/TEAM_PLAN.md) ·
handoffs in [`docs/handoffs/`](docs/handoffs/).

## What the foundation does (and does not) do

Implemented and verified: keyboard-controlled player in a Phaser canvas, HQ room with a
portal, fixture world request through the server (`POST /api/world`) with honest provenance,
room rendering from `RoomSpec` + `ArtRecipe`, room transitions via exit tiles, creation
receipt + arrival keepsake saved to the device-local memory wall, health endpoint, production
build served by one Node process, typecheck/tests/build in CI.

Not implemented yet (see `docs/TEAM_PLAN.md`): enemy AI and damage, class abilities (Q/E),
live OpenAI generation, later-room streaming, WebSocket multiplayer, final art, audio.

## Configuration

Copy `.env.example` to `.env`. All variables are read by the **server only**
(`src/server/config.ts`). `OPENAI_API_KEY` is optional; without it the server serves the
fixture and says so. Never commit `.env`.
