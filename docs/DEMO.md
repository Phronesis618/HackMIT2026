# RELAY demo runbook

Public solo fixture build: https://phronesis618.github.io/HackMIT2026/ (GitHub Pages, redeployed
from `main` by `pages.yml`; older mirror: https://client-gzffunxf.devinapps.com/). A static host
has no generation API or co-op server; its explicit offline notice and **OFFLINE FIXTURE**
label are expected. Full game (live generation + co-op): https://relay-a3yv.onrender.com —
see “Public hosts” below for what is and is not verified. Use the Node host below for local
shared play.

## Start a solo or LAN host

```bash
npm ci
npm run check
npm run build
HOST=0.0.0.0 npm start
```

Open `http://localhost:8787` for solo play. For co-op, everyone opens
`http://<host-lan-ip>:8787/?mode=coop` on the same network, or uses **Join co-op**.
The first connected player hosts the shared crew. One server holds one crew of at most four
players. No player needs an AI provider account; only the Node server uses generation credentials.

For a container host, use the production-container commands in the README.

## Presentation sequence

1. Start at the Stillpoint sanctuary. Walk northwest to the Armory and tap F at a class
   shrine to attune. The northeast Echo Archive shows device-local records; the southwest
   Proving Chamber opens solo training; the southeast Observatory focuses the contribution
   console. Enter a display name in the sidebar. Manual class controls remain available
   as an accessibility shortcut.
2. Each player contributes an idea. The host presses **Prepare world**.
3. Read the creation receipt before entering. State the provenance label aloud:
   **LIVE**, **OFFLINE FIXTURE**, or **FALLBACK FIXTURE**. Unused contributions must remain
   visibly unused; authored fixtures do not become generated worlds because a player typed.
4. Enter the portal together. Pause briefly for the first-room reveal and arrival keepsake.
5. Show movement, a directional attack, a dash through danger and the class's Q ability.
6. Clear a room, spend the earned resource on the E unlock and demonstrate its effect.
7. Continue through three rooms. Break amber cracked barriers with normal attacks; ramps
   cross wall runs, rubble slows walking, and cyan conduits accelerate walking. Dashes keep
   their normal speed.
8. Defeat the three-phase Custodian. Follow the numbered relays and tap F at each lit one.
   Once the first relay is active, the Anchor warns in red before emitting a widening pulse;
   dash through it. Activated relays stay charged. Return to the core and tap F to release
   the signal, watch the discharge, then return to the sanctuary and its Archive.
9. Review the debrief, return to headquarters and show the new event-derived memories.
10. Reload to show that the memory wall persists on this browser. Co-op shares event content;
   storage and captured arrival images belong to each browser.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD or arrows |
| Aim | Mouse |
| Attack | J or left click |
| Dash | Shift or Space |
| Class ability | Q |
| Unlocked ability | E |
| Relays / Anchor release / HQ stations | Tap F nearby |
| Read a relic / revive | Hold F nearby |
| Sound | Sound on/off in the top bar |

Attacks and abilities are presses, not automatic repeats. Release movement before typing an
idea. Sound starts after a user gesture.

## Generation configuration

Default mode uses validated fixtures and makes no paid requests. To enable live generation,
set `RELAY_GENERATION_MODE=live`, `RELAY_AI_PROVIDER=anthropic`, and `ANTHROPIC_API_KEY`
on the server, then restart it. Claude defaults to `claude-sonnet-4-6`; override with
`ANTHROPIC_MODEL` if needed. To switch to GPT, set `RELAY_AI_PROVIDER=openai` and
`OPENAI_API_KEY` (`OPENAI_MODEL` defaults to `gpt-5-mini`), then restart. Both keys may
remain configured; only the selected provider is called. Never expose keys through a
`VITE_` variable. Full examples are in [the README](../README.md#configuration).

The receipt reports the actual generation source. Missing credentials, timeouts, rejected
model output, or unavailable models can fall back to an explicitly labelled fixture.
The first committed room can be entered while later rooms arrive; an uncommitted exit must
wait for its destination.

### Operator mode (demo-only, no API key)

`RELAY_AI_PROVIDER=operator` with `RELAY_GENERATION_MODE=live` turns the world-generation
call into a watched folder so a coding agent (the Cursor session running Agent A) can play
the model live:

1. The server writes `.relay/operator/inbox/<requestId>-<attempt>.json` per world request:
   the players' real ideas, the runtime instructions, the closed registry, and `reply.path`.
2. The watching agent authors one `WorldRecipe` JSON object and writes it to `reply.path`
   (`.relay/operator/outbox/…`). The protocol and schema are written into
   `.relay/operator/README.md` and `world-recipe.schema.json` on first use.
3. The server validates the reply exactly like API output (Zod schema, no markup/URLs/code),
   compiles it into rooms, and shows it as `LIVE · cursor-agent`. An invalid reply is retired
   and re-issued as attempt+1 with a `repair` message, as often as needed; no accepted reply
   within `RELAY_OPERATOR_TIMEOUT_MS` (default 180 s) of the first request serves a clearly
   labelled fixture instead. Consumed pairs land in `.relay/operator/done/`.

Runbook: set the two variables in `.env`, start the server, then in the Cursor chat with Agent A
say "watch the operator inbox". The agent arms a background watcher on the inbox and answers
each request as it appears (expect roughly one minute from *Prepare world* to *ready*). Keep
that chat open for the whole demo; `GET /api/health` reports `provider: "operator"` and
`operatorPending`. Do not describe operator output as an unattended API call; the badge and
the receipt already say what it is.

## Recovery

- If the crew disconnects, use the displayed connection state to rejoin; do not present a
  frozen scene as active multiplayer.
- If the host leaves, check who now owns the host controls before requesting another world.
- A failed run returns through the debrief to headquarters for another attempt.
- Do not clear the memory wall while demonstrating persistence.
- For an offline solo rehearsal, use `/?world=fixture`. Preview room jumps
  (`&room=1` or `&room=2`) are inspection aids, not evidence of completing an expedition.

## Public hosts

Status as of 2026-09-20 09:20 UTC (`main` `c1abe97`); details in `docs/QA.md` → “Public
deployment verification”.

| Host | Verified | Unverified |
| --- | --- | --- |
| Pages `https://phronesis618.github.io/HackMIT2026/` | Pages enabled + last 5 deploy runs green (GitHub API); the exact artifact boots under `/HackMIT2026/`, shows the offline notice, labels OFFLINE FIXTURE, plays room 1, keeps memories across reload, `?world=fixture&floors=1` works (browser, static emulation) | The hosted URL itself was network-blocked for the QA session |
| Render `https://relay-a3yv.onrender.com` | Only PR #17's earlier record: health/config, one live Claude world after manual redeploy, wss welcome/pong | Whether it is live now, its commit, live-generation config, two-context wss co-op, provenance labels |

### Human checklist for the Render service (≈5 minutes)

If the service still exists (Render Dashboard → `relay`):

1. Open https://relay-a3yv.onrender.com/api/health. Expect `ok: true`. Note
   `generation.effectiveMode`: `live` means the key is configured, `fixture` means it is not.
   Record the JSON and the time in `docs/QA.md`. If the first request takes ~1 min, the free
   instance was asleep — that is normal.
2. Live generation needs three env vars. `RELAY_GENERATION_MODE=live` and
   `RELAY_AI_PROVIDER=anthropic` come from `render.yaml`; `ANTHROPIC_API_KEY` must be added
   by hand: service → **Environment** → **Add Environment Variable** (or **Add Secret**) →
   key `ANTHROPIC_API_KEY`, paste the key → save; Render redeploys with the new value (exact
   button labels may differ by dashboard version). Never put the key
   in Git, in `render.yaml`, or in a `VITE_` variable.
3. Confirm the deployed commit: service → **Events**. If it lags `main`, use
   **Manual Deploy → Deploy latest commit** (PR #17 found commit-triggered deploys were not
   firing; check the Render GitHub app is authorised for `Phronesis618/HackMIT2026`).
4. Co-op over wss: open `https://relay-a3yv.onrender.com/?mode=coop` in two browser
   profiles (or one normal + one private window). Both should show the same crew and the
   sidebar connection state should read connected, not offline. DevTools → Network → WS
   should show `wss://relay-a3yv.onrender.com/ws` with status 101.
5. Provenance: from HQ, prepare a world and read the receipt aloud. `LIVE · claude-sonnet-4-6`
   only with a working key; `FALLBACK FIXTURE` if the provider failed/timed out;
   `OFFLINE FIXTURE` if no server. Any other wording is a bug — file it.

If no service exists, create one from the Blueprint (≈5 minutes, no code changes):

1. Sign in at https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect GitHub and pick `Phronesis618/HackMIT2026` (authorise the Render GitHub app for
   the repo if prompted; the repo owner may need to approve).
3. Render reads `render.yaml`: one **Free** Docker web service `relay`, branch `main`,
   health check `/api/health`, auto-deploy on commit. Click **Apply**.
4. While it builds (~3–4 min), open the new service → **Environment** and add the secret
   `ANTHROPIC_API_KEY` (step 2 above). Skip this for a fixture-only host; the game then
   labels every world OFFLINE/FALLBACK FIXTURE honestly.
5. When the deploy is live, run the five-step checklist above and paste the results into
   `docs/QA.md`. The URL will be `https://relay-<hash>.onrender.com`; update `README.md`
   and this file if it differs from the one recorded here.

## Evidence

Use `docs/QA.md` for the verified scope and external prerequisites. A local two-client test
does not establish Wi-Fi/firewall behavior on the venue's network. Rehearse that network
before presenting.
