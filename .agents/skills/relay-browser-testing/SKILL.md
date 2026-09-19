---
name: relay-fixture-browser-testing
description: Run RELAY locally and verify honest fixture exploration, rendering, and device-local memories through the browser.
---

# RELAY fixture browser testing

## Setup
- Read AGENTS.md, README.md, prompts/START_C_PRESENTATION.md and linked product/architecture/art/handoff docs.
- In the repo, source `/home/ubuntu/.nvm/nvm.sh`, select Node 26 with `nvm use 26`, then `npm ci`.
- Run `npm run dev`; expect Vite at http://localhost:5173 and the local server at http://127.0.0.1:8787.
- Fixture mode works without an .env file. Check that the page says connected and the Phaser stage actually renders before recording.
- Maximize the browser before recording. Use held keys for frame-based movement, not instant key presses.

## Browser coverage
- Begin at `/` for the actual HQ contribution/generation flow. Preview URLs bypass parts of that flow and are not substitutes.
- Expand operative details; verify class appearance changes and partial/planned disclosures. Submit a uniquely named idea, prepare a world, and verify explicit fixture provenance and recorded-but-not-used attribution.
- Walk into the physical HQ portal. Consult `src/sim/headquarters.ts` for authoritative spawn/exit coordinates instead of inferring collision from art.
- Read fixture room exits from `fixtures/worlds/vantage-spire.json`; use WASD/arrows, Shift/Space dash, mouse aim and J/click attack.
- Verify attack/dash visuals and HUD cooldown/state together. These effects are brief: preserve a raw recording clip or extract frames rather than relying only on post-action screenshots. Auto-edited videos can compress held-key intervals.
- Verify directional exits, changing hostile silhouettes/counts, absence of stale room objects, and return to HQ.
- A normal prepared-world + first-room entry yields receipt and arrival memories. Wait for the delayed thumbnail, return, reload, and verify count, text and image without duplicates.
- Clear requires confirmation: first cancel and check preservation, then erase and reload. Preview URLs can immediately create new memories again; use plain `/` to verify persistent clearing.
- Test `/?world=fixture&autoenter=1` for room 0 and `/?world=fixture&room=1` for room 1 (zero-based), checking PREVIEW/client fixture labelling.
- For responsive coverage, zoom until `window.innerWidth` is approximately 800 CSS px. Check vertical scrolling, all controls/cards, and document width; restore zoom afterward.
- Submit 24 ideas through the textarea to exercise the cap; check disabled input/button and rejection of a 25th.
- Inspect console logs for runtime errors after navigation.

## Honest scope
- Consult ABILITY_STATUS and current simulation emissions. Never inject defeat/hit/Anchor events to manufacture milestones.
- When combat damage or completion is absent, mark enemy-defeat milestones, hit flashes and debrief completion E2E untested.
- Fast fixture generation may be too brief to prove busy-state disabling visually; report that limitation unless deliberately tested with controlled latency.

## Devin Secrets Needed
- None for offline fixture coverage.
