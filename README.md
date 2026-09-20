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
**Shift/Space**, attack with **J/click**, and use **Q**. Click **Prepare world** — the server
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
# teammates open http://<your-lan-ip>:8787/?mode=coop
```

The first connected co-op player hosts a crew of up to four. The server owns combat,
contributions, generation and room transitions; the host prepares worlds and returns the crew
to HQ. Solo and co-op use the same simulation. See [the demo runbook](docs/DEMO.md).

### Preview path (no backend needed)

- `http://localhost:5173/?world=fixture` — load the bundled fixture world in the browser
- `http://localhost:5173/?world=fixture&room=1` — jump straight into room index 1
- `http://localhost:5173/?world=fixture&autoenter=1` — enter room 0 immediately

### Production container

```bash
docker build -t relay .
docker run --rm -p 8787:8787 relay
```

The image runs as a non-root user and serves the built client, API and WebSocket endpoint
from one Node process. `/api/health` is the healthcheck. No credential is needed for the
labelled offline fixture mode. For live Claude generation, pass `RELAY_GENERATION_MODE=live`,
`RELAY_AI_PROVIDER=anthropic`, and `ANTHROPIC_API_KEY` through your hosting provider's secret
configuration. Set `ANTHROPIC_MODEL` to override the default `claude-sonnet-4-6`.
Do not bake secrets into the image.

Static hosting supports the solo fixture demo: if the generation server is unavailable, the
client displays an explicit offline notice and uses a bundled fixture. Live generation and
LAN co-op require the Node server.

### Host the full game on Render

Current hosted game: [RELAY](https://relay-a3yv.onrender.com). Redeploying this service keeps
the same URL.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Phronesis618/HackMIT2026)

1. Open the button, sign in to Render, and authorize access to this repository if prompted.
2. Review the Blueprint and create its **Free** web service. `render.yaml` uses the existing
   Dockerfile to serve the game, `/api`, and `/ws` together. No database is required.
3. Once the deploy is live, open the service's Render URL. Share that URL for solo play or
   append `/?mode=coop` for the shared crew.

The initial deployment works without an AI key and clearly labels its offline fixtures.
To activate Claude, add `ANTHROPIC_API_KEY` in the service's **Environment** settings, then
save and redeploy. Create a key at [Claude Console](https://platform.claude.com/settings/keys)
if needed. The Blueprint already selects live mode, Anthropic, and `claude-sonnet-4-6`.
Keep the key in Render's environment settings; never put it in Git or a `VITE_` variable.
For GPT instead, use the [provider configuration below](#switch-back-to-gpt).

Verify the deployed service:

- `/api/health` should report `ok: true`. Without a key, `generation.effectiveMode` is
  `fixture`; with the selected key configured, it is `live`.
- `/api/config` should report `liveGenerationAvailable: true` after adding the key.
  This confirms configuration, not that the provider accepted a request.
- Prepare a world from HQ and check its receipt for `LIVE · claude-sonnet-4-6`.
  A fixture/fallback receipt means no fresh AI world was produced; inspect Render's logs.
- Open `/?mode=coop` in two browsers to join the same crew.

Keep **one service instance**: the current backend has one in-memory crew of up to four
players. Restarts/redeploys reset that crew; saved memories remain in each browser's local
storage. The Blueprint automatically deploys new pushes or merges to `main`
(`autoDeployTrigger: commit`). Auto-deploys require a connected GitHub repository. For an
existing service, sync the updated Blueprint, or select **Settings → Auto-Deploy → On Commit**
and confirm the linked branch is `main`. Keep the existing `ANTHROPIC_API_KEY` in Render;
the Blueprint does not replace it.

Render's [free instance](https://render.com/docs/free) sleeps after 15 minutes without
inbound traffic and takes about a minute to wake. Open the site before presenting, or
choose a paid instance for an always-on demo. AI provider usage is billed separately.

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

### Claude comments → Devin

The `Claude comments to Devin` GitHub Action forwards new conversation comments on open
issues and pull requests from `curious-droid` to a Devin automation webhook. The author
must also be an owner, member, or collaborator. To change the author, set the repository
Actions variable `CLAUDE_GITHUB_LOGIN`.

Enable it after the workflow is merged to `main`:

1. Create a [Devin automation](https://docs.devin.ai/product-guides/automations) with an
   incoming webhook trigger and a **Start session** action for `@Phronesis618/HackMIT2026`.
   Instruct it to act on the supplied comment, skip status-only/already-completed requests,
   and coordinate with any Devin session already working on the issue or PR.
2. Copy the webhook URL and its generated secret into repository
   [Actions secrets](https://github.com/Phronesis618/HackMIT2026/settings/secrets/actions),
   named `DEVIN_WEBHOOK_URL` and `DEVIN_WEBHOOK_SECRET`. The webhook secret is shown only
   once; regenerate it in Devin if needed.
3. Post a new task comment from the configured account and check the **Claude comments to
   Devin** workflow run.

Edits, inline review comments, comments on closed threads, and other authors do not trigger
this workflow. Comments posted using a workflow's `GITHUB_TOKEN` do not trigger another
GitHub Actions workflow; Claude must post through its own user/app credentials.
The bridge checks out no repository code and has no GitHub token permissions.

## Current playable loop

HQ contributions → honest creation receipt → portal → three combat rooms → Guardian and
Anchor → debrief and persistent memories. All four classes have Q abilities and an E unlock
purchased with room-clear rewards. Clear enemies before using exits; hold F to revive a
nearby teammate or plant the cleared final room's Anchor.

Implemented: deterministic combat and enemy telegraphs, host-authoritative co-op, immutable
incremental room delivery, procedural rendering/audio and mute, event-derived Chronicle,
validated live generation with bounded fallback, and non-root production container.

[Public solo fixture demo](https://client-gzffunxf.devinapps.com/) — anyone with the URL can
access it. This static deployment uses the explicitly labelled bundled fixture; live
generation and co-op require the Node server.

Verified scope and remaining external prerequisites are in [QA](docs/QA.md). Live Claude/OpenAI
and physical LAN remain unverified; mocked provider tests do not establish live generation.

## Configuration

Copy `.env.example` to `.env`. All variables are read by the **server only**
(`src/server/config.ts`). Never commit `.env` or put API keys in `VITE_` variables.

### Claude now

Set these values in `.env` (or your Node server's hosting environment), then restart the server:

```dotenv
RELAY_GENERATION_MODE=live
RELAY_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Claude uses the Messages API with a forced recipe tool. Its output goes through the same
Zod validation, bounded repair, safe compiler, and incremental room delivery as OpenAI.
Each Claude request has a 55-second deadline; OpenAI retains a 25-second deadline.
Invalid recipes can receive one repair attempt within a new request deadline.

### Switch back to GPT

Add the OpenAI key and change the provider, then restart; no code changes are needed:

```dotenv
RELAY_GENERATION_MODE=live
RELAY_AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
```

You can keep both keys configured. Only the selected provider is called. If
`RELAY_AI_PROVIDER` is omitted, a nonempty Anthropic key selects Claude; otherwise OpenAI
is selected, preserving existing OpenAI-only setups. Unsupported provider names fail
startup with a configuration error.

Generation stays offline unless `RELAY_GENERATION_MODE=live`. A missing selected key uses
a labelled fixture; provider errors, timeouts and rejected output use a labelled fallback.
The server never silently switches to the other paid provider. The receipt shows the model
used, and `/api/config` exposes availability without either key.
