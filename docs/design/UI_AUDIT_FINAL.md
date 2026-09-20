# Final UI audit (agent U2a, 2026-09-20)

The system this audits is the one in `docs/design/UI_AUDIT.md` (agent U1): 4/8 spacing grid,
one type scale (11 stamp · 12 secondary · 13 body · 15 emphasis · 17 title), token colours only,
one panel treatment (hairline + corner ticks, 2 px radius), three regions — top bar, right rail,
command bar — around an unobstructed stage. This pass looks at what ~20 agents added on top of it.

## How it was shot

`scripts/ui-matrix.mjs` (added by this pass) drives one headless Chromium over a JSON shot list,
against the dev client on **:7073**. It is `scripts/shot.mjs`'s Playwright bootstrap with a batch
loop and a per-shot `eval` hook.

- **Baseline** `/tmp/relay-shots/u2/before/` (35, URL-reachable) and
  `/tmp/relay-shots/u2/before2/` (41, harness-driven).
- **Rounds** `/tmp/relay-shots/u2/round1/`, `round2/`, and `after/`.
- URL-reachable states used only real flags: `?hints=reset|off`, `?world=fixture&autoenter=1`,
  `&room=2`, `?floors=1&laws=1`, `?palette=…&dark=…`, `?mode=coop&as=…`.
- **Harness shots.** Everything in `before2/` and its re-shoots is driven by a shot-list `eval`
  that wraps the existing `window.relay.store` debug handle (`src/client/main.tsx`) so a patch is
  re-applied after each controller write. Nothing ships: the harness lives in `scripts/`, and no
  production code path fakes state. The states that needed it are the eight **hub station
  panels**, **0/1/24-idea and 200-char composer**, **generation in progress**, the **four
  classes**, **cooldowns / ult charging / ult ready / low Integrity / downed / haste+slow chips /
  E unlocked**, the **escape timer** (running, urgent, stranded), the **relic pedestals**, the
  **four debrief outcomes**, **co-op crew of 2 and 4 with 24-char names and an offline marker**,
  the **error notice**, and the **engine-chosen laws** panel.

## Defects

Each row: what, where, why. `▲` = fixed this pass; `○` = left, with the reason.

### Layout and geometry

| # | Screenshot | What / where / why |
|---|---|---|
| ▲1 | `before/combat-1280x800.png`, `before/final-1440x900.png` | **~100–150 px of dead ink under the command bar at 16:10.** `.stage-col` was `align-content: start`, and the 16:9 stage is width-bound at 16:10, so the whole leftover fell in one band at the bottom of the column. Fixed: `align-content: center` — the leftover reads as a letterbox split above and below instead of a hole. |
| ▲2 | `before/menu-p3-1440x900.png` (Operative), `before/menu-p4-…` (Skills) | **Menu frame clipped long pages and left ~320 px dead on short ones.** `height: min(680px, 100%)` is fixed, so "Return to headquarters" was cut in half and the skill tree's right-hand column disappeared under the detail card, while Field Notes ended 370 px above the frame's foot. Fixed: the frame sizes to its page (`height: auto`, `min-height: 440`, `max-height: 860`), widened 980 → 1160 so the tree fits, and the page got a sticky foot fade so a scrollable page looks scrollable. |
| ▲3 | `before/combat-1280x720.png` | **A 180–220 px "Map · no signal" square sat at the top of the rail in every non-floors run.** The slot is reserved for the floors minimap, which only mounts in a floors world. Fixed with `:has()`: when nothing but the placeholder is inside, the square collapses and the stat tiles run across the full rail width. The markup (and `tests/presentation/combat-ui.test.ts`) is untouched. |
| ▲4 | `before/fullmap-1440x900.png` | **Top bar wrapped to two rows** as soon as the telemetry got long (`VANTAGE SPIRE · BIOME 1/5 · ROOM 1 OF 10`), pushing the connection badge onto a second line and moving the stage down — layout shift driven by content. Fixed: `flex-wrap: nowrap` on the bar and its status group, telemetry and tagline clip with an ellipsis, tagline hidden below 1560. |
| ▲5 | `before2/hq-station-archive.png` | **Opening a hub station pushed "Prepare world" below the fold.** The station panel is inserted above the hub panel and nothing gave way. Fixed: `.side__scroll:has(.hq-station) .hq-directory { display: none }` — the directory is wayfinding the open station makes redundant. |
| ▲6 | `before/narrow-800-combat.png` | **At 800 px the fixed `Tab · menu` chip landed in the top bar**, next to the Menu button it duplicates, because `position: static` dropped it into the header flow. Fixed: hidden below 960 px, where the Menu button is already on screen. |
| ○7 | `before/narrow-800-*.png` | At 800 px the stage is small and the command bar wraps to three rows. It is a sanity width, not a supported one, and the game needs ≥ 960 px to be playable. Left as is. |

### Duplicated information

| # | Screenshot | What / where / why |
|---|---|---|
| ▲8 | `before/combat-1280x720.png` | **`PREVIEW · CLIENT FIXTURE` and `OFFLINE FIXTURE` sat side by side in the top bar** — two labels for one fact. Fixed: the preview badge only shows before a world is loaded; after that the world's own provenance badge is the single source. |
| ▲9 | `before/hub-cold-1920x1080.png` | **The hub rail explained the controls the onboarding prompts were showing at the same moment** ("Walk up to a station and press F. Take a weapon from its stand…"), and closed with a second key-bindings paragraph that CSS had already hidden. Both cut from the markup; the rail keeps one lead line. |
| ▲10 | `before/final-1440x900.png` | **The world title and tagline appeared four times at once**: top-bar telemetry, the in-canvas floor stencil, the rail's World brief, and (at debrief) the full dossier. Reduced by #8 and by moving the arrival description out of the playfield (#13); the stencil is diegetic and stays. |
| ○11 | `before2/debrief-anchored.png` | At debrief the full world dossier renders under the debrief panel and repeats its title and tagline. Left: `compact` is driven by `inRun`, and the dossier is the honest creation receipt the product asks for after a run. It is below the primary action, not above it. |

### Clipping, truncation, overlap

| # | Screenshot | What / where / why |
|---|---|---|
| ▲12 | `before2/crew-4-longnames-720.png` | **Crew class stamps were cut mid-word at the rail edge** ("BASTION · Y", "SHA", "OFFL") with a 24-character name, because the stamp was `nowrap` but still shrinkable. Fixed: both name and stamp shrink and ellipsise. |
| ▲13 | `before/fullmap-1440x900.png`, `before/final-1440x900.png` | **The arrival description card was drawn at 30 % of the room's height — on the spawn** — so it printed across the operative and their name label. Fixed in `RoomScene.ts`: 14 px inside the room's top edge, 11 px, opaque plane. |
| ▲14 | `before/combat-1280x720.png` | **The floor-stencilled world title clipped its own tagline.** The plate was a fixed 46 px tall; a tagline that wrapped to two lines broke out of the bottom and ran over the props. Fixed: the text is laid out and measured first, the plate is drawn around it. |
| ▲15 | `before/palette-void.png` | **Two hostiles standing together printed their names on top of each other** ("HuHusk k") and on the operative's. Fixed: the operative's plate is lifted clear of the hostile band and both carry a dark outline, so an overlap stays readable. |
| ▲16 | `before/final-1440x900.png` | **A light shaft hung in the void off the room's left edge.** `drawLightShafts` slants each band by 20 % of the room height without clamping. Fixed: every corner is clamped into the room. |
| ▲17 | `before/combat-1280x720.png` | **The rail's world meta ran on and wrapped into three ragged lines** around the floated Codex link ("3/3 ROOMS · RATED FOR 400 / · CLIPPED TO THE RAIL · / OPEN SHAFT"). Fixed: a grid — facts clipped to one line on the left, Codex held on the right, law names on their own row. |
| ▲18 | `before/hub-cold-1280x720.png` | **The training-range line was ragged to three words a row** beside a `nowrap` button in a two-column squeeze. Fixed: stacked. |

### Off-system styling

| # | What / where / why |
|---|---|
| ▲19 | **`headquarters.css` was a second design language**: ~22 one-off hex colours (`#e7d6b2`, `#dfc28b`, `#1a2738f5`, `#f2dcae`, …), radii of 4/6/8 px in a 2–4 px system, a 3 px coloured top border where every other panel has a hairline, and type at 9/10/11 px under the ≥ 12 px rule in `ART_DIRECTION.md`. Rewritten onto tokens, the 4/8 grid, the type scale and the shared panel treatment. |
| ▲20 | **`finale.css`** used `#fff` and `rgba(255,255,255,.x)` for every colour, radii of 8/10/12 px, and referenced `--color-accent`, which does not exist. Rewritten onto tokens; the 34 px clock stays oversized on purpose. |
| ▲21 | **`floors.css`** had 9 px and 10 px type (minimap head, full-map legend and hint, biome-door facts), eight one-off hexes, a 999 px pill, and spacing at 3/5/6/9/10/14/26/28 px. Brought to ≥ 11 px, tokens, 2 px radii, 4/8 spacing. |
| ▲22 | **`memory-archive.css`** used 5/6/10/12 px spacing off the grid and a raw `--color-ink800` plane instead of the shared `--plane`. Aligned; memory cards now top-align so their buttons line up. |
| ▲23 | **`onboarding.css`** referenced `--color-alarm` (does not exist — the finale band fell back to a literal) and used 6/10 px padding off the grid. Fixed to `--color-danger` and the grid. |
| ▲24 | **The ultimate's charge fill read as mud**: the lamp at 22 % over ink with a near-black overlay on top gave an olive-brown block with a white percentage in it. Fixed: the frame carries the lamp, the uncharged part stays ink, the number is `mist100`. |

### Honesty and labelling

| # | What / where / why |
|---|---|
| ▲25 | **"Engine-chosen" was only visible inside a collapsed provenance note.** `WorldLaws` put it in an eyebrow and a disclosure, but the law *names* also appear in the rail's World brief with no marker at all — exactly where a judge reads them. Fixed: a `derived-stamp` beside the names in both the rail brief and each dossier row. |

### `app.css` hygiene

| # | What / where / why |
|---|---|
| ▲26 | **Three "round N fixes" blocks had accreted at the end of the file** with rules that contradicted each other in source order: `.notice { top: … }` set three times, `.hud-strip { top: … }` twice, `.vitals__id { flex: 1 0 96px }` then `{ flex: initial }`, `.vitals__class { display: none }` then `{ display: inline }`. Folded into one block grouped by region (geometry · top bar · prompts · notice · command bar · run rail · headquarters rail · narrow), with the dead declarations dropped. |

## Rounds

1. **Round 1** — #1–#26 above. Re-shot the full matrix.
2. **Round 2** — see the round-2 section below.
3. **Round 3** — full pass, nothing new.
