# RELAY — art direction (owner: Agent C; tokens keys approved by A)

## Direction

Original top-down 2D illustrated sci-fi. **Hollow Knight** and **Nine Sols** are references
for atmosphere, readable silhouettes, layered depth and fluid motion — not assets to copy and
not a reason to build a side-scroller.

- **Headquarters:** a walkable cyberpunk sanctuary. Architectural silhouettes, warm lamps, a
  luminous portal as the focal point, and a physical memory wall where keepsakes hang.
- **Expedition rooms:** ink-dark planes, neon accents, soft shadows, clear attack telegraphs,
  satisfying movement/attack/dash effects. Theme identity comes from **motifs, props,
  structures and encounters** (`ArtRecipe.motifIds`, `ArtRecipe.skyline`, `RoomSpec.props`,
  `RoomSpec.encounters`) rendered through one shared system.
- **Palette:** restrained ink-and-neon. Base inks from `design/tokens.json`
  (`ink900…ink500`), one cool neon (`neonCyan`) for the organization/portal/local player, one
  warm accent (`neonCoral`/`warmLamp`) for lamps and telegraphs, `danger` for enemies and
  hazards, `neonViolet` for remote players. Per-world `ArtRecipe.palette` may shift floor/wall
  hues but must stay inside this family (`paletteFamily: 'ink-neon'`).

## Layering (see `DEPTH` in `src/shared/conventions.ts`)

background silhouettes → floor → floor decals (hazards, exits, grid) → props behind →
entities (y-sorted) → props in front → effects → fog/vignette → overlay text.

## Readability rules

- Player silhouette always readable against any floor; local player = cyan accent, allies =
  violet, enemies = danger red. Facing is always visible.
- Attack telegraphs in `telegraph` (warm) before damage; hits flash; dashes leave a short
  trail. Effects never obscure enemies or gameplay telegraphs.
- Exits glow; the Anchor site is unmistakable; hazard tiles read as hazards.
- HUD text ≥ 12 px, high contrast, `font.display` for titles, `font.body` for copy,
  `font.mono` for badges/provenance.

## Tokens

- Values: `design/tokens.json` — **C may tune freely.**
- Keys/schema: `src/shared/tokens.ts` (`VisualTokensSchema`) — **A approves changes**;
  `tests/shared/contracts.test.ts` validates the JSON.
- UI reads tokens as CSS variables (`--color-neonCyan`, `--space-md`, …); Phaser reads them
  via `tokens` + `hexToInt`.

## Assets

Original art or assets whose license permits this use (state which in `design/README.md`).
No copied game assets. Keep sprite sheets and audio under `design/`; reference them from
`src/client/render` / `src/client/audio`. No external asset URLs at runtime.

## Current state

The foundation ships procedural vector placeholders (`src/client/render/drawing.ts`,
`RoomScene.ts`) that establish palette and layering only. Plain circles are **not** final
character art.
