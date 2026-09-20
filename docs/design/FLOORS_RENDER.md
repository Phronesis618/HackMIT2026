# Floors: renderer, minimap and biome choice (agent F3)

What was built for floors on the presentation side, the rules it follows, and where each rule lives. Contracts and the sim are in `FLOORS.md`.

## 1 · Solid vs walkable: one language

The complaint was "make it clearer which tiles are solid". The fix is one rule applied everywhere, derived from the palette so it survives every biome material (`solidColors` in `src/client/render/color.ts`).

| You cannot walk here | How it is drawn |
| --- | --- |
| `#` wall | Top face at least 0.17 luminance **lighter** than the brightest floor colour, 2.5 px highlight on the north edge; where floor lies to the south, a front face 50 % darker than the top with a near-black base line; near-black 1.5 px outline on every edge that touches non-wall; 12 px cast shadow on the floor to the south, 8 px to the east. Tiles buried inside a thick wall are a step darker so the lit rim carries the silhouette. |
| `B` breakable wall | Same block (top, front face, outline, cast shadow) plus an amber inner frame and a fracture line; the fracture thickens when damaged. When broken the tile is floor and the block is gone. |
| ` ` void | The void colour `#04050a`, same as everything outside the room. |
| Blocking props (`PROP_INFO.blocksMovement`) | A dark footprint plate covering exactly the tiles that block, with a crisp edge and a contact shadow. `monolith_shard` (1×2) now stands on both of its tiles. Props without the plate (lantern, cable bundle, anchor pedestal) can be walked through. |

| You can walk here | How it is drawn |
| --- | --- |
| `.` `P` `A` floor | Floor material of the biome's first motif (`FLOOR_PATTERN`). |
| `=` bridge, `>` ramp | A flat deck at floor value with plank lines and two thin accent rails. No top face, no drop shadow. (Before: a raised grey slab with a black shadow, which read as a wall.) |
| `:` rubble | Small pebbles at floor value with a 1 px shadow each. |
| `+` conduit | Accent inlay with moving chevrons. |
| `~` hazard | Hazard-colour wash and zigzag. Walkable, hurts. |
| `X` door | Floors rooms: a doorway (section 3). Legacy rooms: the old glowing pad, unchanged. |
| Room features on `focus` | Inlays, basins and light only (section 4): the sim keeps `focus` walkable, so nothing there gets a top face or a footprint plate. |

Checked in screenshots across five biomes of the fixture world (motif pairs lanterns+spires, monoliths+arches, lanterns+crystals, cables+roots, spires+monoliths, spires+ruined_machinery) and in `tests/presentation/floors-doors.test.ts` / `floors-rooms.test.ts` on synthetic light, dark and green palettes and on every per-biome palette turn.

Two dressing fixes fell out of the audit: the lantern motif's floor candles were 22 px pools of warm glow that hid hazards (now 9 px points), and overhead dressing hung from the room's bounding box, so in cross- and octagon-shaped rooms it floated in the void (now anchored to the real top edge of that column, and never lit over void).

## 2 · The frame around the room

Before: a gradient sky, seven nebula blobs, 140 stars and three depths of skyline silhouettes with rim light, in the accent colour. It was brighter and busier than the room and competed with it.

Decision: **near-black void** (`VOID_COLOR #04050a`, also the camera and canvas background) with one biome-tinted halo behind the room at a total alpha under 8 %. No stars, no silhouettes, no particles outside the room. The room edge is a clean slab: light wall top, dark outline, a 7 px lip under the outer south edge. Isaac does the same for the same reason: the room is the only thing on screen that has to be read.

Also removed from the canvas because the React HUD now shows them: the controls stencil in the hub (`drawControlsFloorHint`), the room title above the room, and the per-player Integrity strip. The boss bar stays in the canvas.

## 3 · Doors (`src/client/render/doors.ts`)

Each `room.exits[i]` of a floors room is a doorway on the border wall: a floor-level threshold with tread lines, two posts in the solid language, light strips on the posts, a chevron pointing out of the room, and a short lit stub beyond the wall.

| State | Source | Look |
| --- | --- | --- |
| Sealed | `floor.doorsLocked` | Dark shutter plate, three red energy bars closing from both posts, red post strips, a white lock pip when fully shut. |
| Open, leads somewhere new | target room not `visited` in `floor.map` | Accent strips and a double chevron that pulse, lit stub. |
| Open, already visited | target room `visited` | Same frame, dim neutral light, no pulse. |
| Known kind | `FloorMapRoom.kind` not null | The light takes the kind colour (elite red, treasure gold, lore violet, rest green, exit white). Exit rooms and doors to the exit get heavier post strips. |

Seal and unseal ease over 220 ms (`stepSeal`). `selectDoorViews(room, floor)` is pure and tested.

## 4 · Room kinds (`src/client/render/roomKinds.ts`)

| Kind | Reads as |
| --- | --- |
| entrance | Arrival pad under the spawn. |
| combat | Nothing extra. |
| elite | Red threat ring with eight ticks at the focus, red sills inside every door, a slow red pulse until the room is clear. |
| treasure | Gold-framed pad, a low case with a floating gem, gold glow. Goes dark once taken. |
| lore | Book shelves on the north wall **faces** (on the wall, never on the floor), violet ring around the relic. |
| rest | Warm light pool, a font with a green cross, rising motes. Dim once used. |
| exit (tiers 0–3) | Large white gate ring and a plinth with **two portals**: red and barred while the gatekeeper lives, lit in accent and white once the room is clear, with `HOLD F · CHOOSE THE WAY ON`. |
| exit (final) | The same large ring around the existing Anchor site. |

State comes from the snapshot only (`roomKindState`): `roomCleared`, the current room's `cleared` flag in `floor.map` (the sim sets it when a rest site or cache is used), and `floor.biomeChoice`.

Per-biome art (`biomeArt.ts`): the world ships one `ArtRecipe`; each biome swaps in its own `motifIds` (floor material, wall dressing, motes, overhead) and turns the palette hue by a fixed step of 12° per biome, at most ±36°, never the hazard colour. The opener keeps the world palette. The briefs reach the renderer through `registerBiomes`, called by `connectFloorsUi`, because the renderer contract only passes a room and the world art.

## 5 · Minimap (`Minimap.tsx`, `FullMap.tsx`, `floorsModel.ts`, `floors.css`)

Built from `floor.map` only. The plan is never read, so the HUD cannot leak rooms the sim has not revealed.

- Visited rooms are solid; visited but not cleared are darker. Seen neighbours are dashed outlines. The current room is cyan with a pulsing halo (red halo while doors are sealed). Everything else is absent: the dotted slot background is the fog.
- Icons for exit, treasure, rest, lore, elite and entrance, only when `kind` is not null. Visited special rooms keep their kind colour as the fill so they stay findable.
- Connectors are drawn from visited rooms only; a seen room never shows its other doors.
- Header: biome name, five pips, "Biome 2/5". Footer: rooms visited / room budget, and "Doors sealed" or "Hold M · map".
- Scale: the revealed bounding box is normalised and the cell pitch is `floor(size / (max(cols, rows) + 1))`, clamped to 8–24 px, so a 15 × 13 grid fits the 180–220 px slot.
- Mounting: a portal into U1's `.hud-minimap-slot`; if the slot is not on the page (narrow layouts), a corner box over the stage.
- Full map: hold **M** (Tab is the menu), or click the minimap to pin. Larger grid, route so far, counts, legend.

## 6 · Biome choice (`BiomeChoice.tsx`)

Shown while `floor.biomeChoice` is open and `chosenBiomeId` is null. Two arched doors. Each states: biome depth, name, tagline, room count, layout in plain words, hostiles, what it is built from, floor hazards yes/none.

Layout words come from the brief: linearity ≥ 0.66 "Long and direct", ≤ 0.34 "Wide and sprawling", else "Winding"; branchiness ≥ 0.66 "Many dead ends.", ≤ 0.34 "Few side rooms.", else "Some side rooms."

Solo and the co-op host pick with 1 / 2, ← → + Enter, or a click, through `actions.chooseBiome` → `session.chooseBiome`. Guests see the same doors, disabled, with "Waiting for <host> to choose" and the host's marked door in lamp colour. One option (before the finale) is a confirm. `pickBiome` is the only path to `onChoose` and refuses guests and ids not on offer.

Data path: `connectFloorsUi(session, store, actions)` (one line in `main.tsx`) subscribes to snapshots, publishes `UiModel.floor` when a cheap change key differs, and adds `actions.chooseBiome`. `GameController` was not touched.

## 7 · Sources

From memory; not re-fetched during this work.

- The Binding of Isaac: Rebirth — minimap conventions (visited solid, adjacent outlined, icons for special rooms, current room lit), door frames that take the colour of the room behind them, doors barred during a fight, plain black outside the room.
- Enter the Gungeon — minimap connectors between rooms and a hold-to-expand full map.
- Hades — doors preview what is behind them before you commit.
- Dead Cells — two exits at the end of a biome, each naming the biome it leads to; the Bénard "hybrid approach" article already cited in `FLOORS.md`.
- Top-down tile depth: the common 3/4-view convention of a light top face, a darker south face and a cast shadow to tell raised tiles from floor (Zelda: A Link to the Past, Hyper Light Drifter, Nuclear Throne).

## 8 · Not done / open

- Treasure and rest rooms have no dedicated prop art beyond the focus feature.
- Shop rooms are reserved in the contracts; they get the treasure colour and a coin icon, nothing else.
- The spire overhead light shafts are still rectangles and can brush the void in non-rectangular rooms (alpha 0.02).
- ~~`GameController` still has the 1 / 2 key stopgap and the "The way on is open" notice~~ — both removed (Z1, A3). The choice screen is the only path: it owns 1 / 2 / arrows / Enter / click, and `GameController.actions.chooseBiome` is what it calls.
