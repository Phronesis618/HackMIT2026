# FLOORS — spec as implemented (F1a) + integration guide (F1b / F2 / F3)

Status: **library done, not wired in.** F1a added new files only; nothing in the game calls this yet.

| File | What |
| --- | --- |
| `src/shared/floors.ts` | Types + Zod schemas: `BiomeBrief`, `BiomeGraph`, `WorldRoute`, `FloorPlan`, `FloorRoom`, `BuiltRoom`, `RoomDoor`, `RoomAddress`. Imports only `registry.ts`. |
| `src/server/generation/floorgen/rng.ts` | Seeded PRNG (FNV-1a + murmur3 finaliser → mulberry32). |
| `…/floorgen/route.ts` | `planWorldRoute`, `nextBiomeChoices`, `DEFAULT_BIOME_BRIEFS` (8 offline briefs). |
| `…/floorgen/floorplan.ts` | Isaac floor-plan generator, validation, kind assignment, `renderFloorPlan`. |
| `…/floorgen/templates.ts` | 17 hand-made room templates (6 small 13×9, 6 medium 19×13, 5 large 27×17) + `pickTemplate`. |
| `…/floorgen/rooms.ts` | Room assembler: flips, doors, pillar/hazard mutators, connectivity repair, props, encounter placement. |
| `…/floorgen/director.ts` | Encounter director (who is in the room). |
| `…/floorgen/index.ts` | Public API barrel. |
| `tests/generation/floorgen/*.test.ts` | 42 tests, ~2.5 s, including a 1 000-seed fuzz per budget. |

Everything is pure (no `Math.random`, no `Date`, no I/O) and imports only from `src/shared`, so **the client can import floorgen too**. If the bundler objects to a `src/server` path, move the folder to `src/shared/floorgen/` unchanged.

## 1 · Public API

```ts
planWorldRoute(seed: string, biomeIds?: readonly string[]): WorldRoute
nextBiomeChoices(route: WorldRoute, biomeId: string): string[]
generateFloorPlan(brief: BiomeBrief, tier: number, seed: string, options?: { roomBudget?: number }): FloorPlan
buildRoom(plan: FloorPlan, roomId: string, brief: BiomeBrief, seed: string): BuiltRoom
buildFloor(plan: FloorPlan, brief: BiomeBrief, seed: string): { plan: FloorPlan; rooms: BuiltRoom[] }
createLazyFloor(plan, brief, seed): { plan; room(roomId): BuiltRoom; builtRoomIds(): string[] }
renderFloorPlan(plan: FloorPlan): string          // ASCII debug map
rollEncounters(ctx: DirectorContext, rng: Rng): EncounterGroup[]
```

`seed` is the **world seed string** everywhere. Streams are keyed internally: floor plan = `(seed, biomeId, 'plan', attempt)`, template choice = `(seed, biomeId, 'template', roomIndex)`, room = `(seed, biomeId, 'room', roomId)`. A room never depends on which rooms were built before it, so lazy compile on two machines gives byte-identical JSON (tested).

## 2 · The run

5 biomes deep, room budgets **10 / 15 / 20 / 25 / 30** (`ROOM_BUDGETS`). After each exit the crew picks 1 of 2, so a world has **8 briefs** on a DAG `1 → 2 → 2 → 2 → 1` with full bipartite edges between tiers. `planWorldRoute(seed, ids)` keeps `ids[0]` as opener and `ids[7]` as finale and deals the middle six onto tiers 1–3 with a seeded shuffle. Without ids it returns slots `b0, b1a, b1b, b2a, b2b, b3a, b3b, b4`.

## 3 · BiomeBrief (the only model-facing shape)

```ts
{ id, name (≤80), tagline (≤140),
  motifIds: MotifId[1..3], enemyPool: EnemyId[1..5], propPool: PropId[1..5], hazards: boolean,
  layout: { linearity: 0..1, branchiness: 0..1,
            specials: { treasure: 0..2, lore: 0..4, rest: 0..2, elite: 0..4 } } }
```

No geometry, no free-form code. Pools must be duplicate-free; `enemyPool` needs at least one non-`guardian` id. `guardian` and `anchor_pedestal` may be listed but only the director places them.

## 4 · Floor plan — Isaac's algorithm

Source: Boris the Brave, [Dungeon Generation in Binding of Isaac](https://www.boristhebrave.com/2020/09/12/dungeon-generation-in-binding-of-isaac/).

1. Grid by budget: ≤16 → 9×8 (Isaac's), ≤20 → 11×9, ≤25 → 12×10, ≤30 → 13×11, above → 15×13. Start cell = grid centre.
2. BFS queue. For each cardinal neighbour of the dequeued cell, give up if: occupied/off-grid · **neighbour already has >1 filled neighbour** · budget reached · coin flip (`giveUp`).
3. The ">1 filled neighbour" rule is kept verbatim. Consequence: a new cell touches only its parent, so **the floor is a tree and every grid adjacency is a door** (tested). No loops.
4. Budgets >16 re-queue the start every 6 dequeues (Isaac's reseed).
5. Dead end = room with one door. **Exit = farthest dead end** (ties → last placed). Treasure/lore/rest take the deepest remaining dead ends, dealt round-robin. Elites take through-rooms at depth ≥ 2 (so a linear biome can be a spine of elites).
6. Validate: exact room count · exit depth ≥ `max(3, floor(sqrt(budget)))` (3/3/4/5/5) · exit not grid-adjacent to the entrance · enough dead ends for the requested specials. Invalid → regenerate with the next attempt stream, up to `MAX_ATTEMPTS = 60`.
7. **Cannot fail**: after the cap a deterministic comb (spine + non-touching teeth) is returned with `stats.usedFallback = true`. It is proven valid for every budget 6..40. Across the 5 000-plan fuzz the worst case seen is ≤ 40 attempts and zero fallbacks.

Where we depart from Isaac, on purpose:

- **Personality.** `giveUp = clamp(0.5 + 0.3·linearity − 0.35·branchiness, 0.12, 0.85)`; `siblingStop = clamp(0.95·linearity − 0.25·branchiness, 0, 0.95)` refuses second children so linear floors keep one child per cell; when the queue runs dry below budget we keep growing instead of restarting — linear floors extend the deepest tip, others sprout from a random room or the start.
- **Dead-end reserve.** A spine has ~2 natural dead ends. Growth stops `treasure+lore+rest` rooms early; any shortfall is added as one-room stubs on through-rooms (same neighbour rule), then the rest of the budget grows normally.

Measured over 300 seeds (tier 4, 30 rooms): linear → max depth ≈ 24.6, 4 dead ends; branchy → max depth ≈ 5.7, 12.6 dead ends.

```
linear (Siege Wall, 15 rooms)        branchy (30 rooms)
  E-o-o                                      o
  |   |                                      |
o-o   o-T                                  o-o-o
|     |                                      |
E   L-E                                      o   o   X
|     |                                      |   |   |
X     o                                R   o-S-o-o-o-o-o
      |                                |   |   |   |
      o-S                            T-o-o-o   o   o
        |                              |   |       |
        R                              o   E-o     L
```
Glyphs: `S` entrance · `o` combat · `E` elite · `T` treasure · `L` lore · `R` rest · `X` exit.

**Clamping (documented, tested).** Dead-end specials are capped at `floor(budget/4)+1` (3/4/6/7/8). Over-asks are trimmed one at a time from the largest request; ties trim treasure, then rest, then lore. Elites are capped at `floor((budget−2)/4)` (2/3/4/5/7); on 10-room floors there may be fewer eligible rooms than that, so the elite count can fall short there. `plan.stats.specials` always reports what was placed. `shop` is in the enum and never generated.

## 5 · Rooms

Dead Cells ([Bénard, a hybrid approach](https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/)): handcrafted tiles tagged by purpose, assembled under constraints. Templates carry `{id, kinds[], sizeClass, motifAffinity[], sockets{n,s,e,w}, tiles[]}`. `pickTemplate` filters by kind → size class → needed sockets and weights ×(1+4·shared motifs), so biomes with different motifs draw visibly different pools. Deeper tiers lean larger.

Tile chars used: only `# . ' ' ~ P X A`. In template data `A` marks the room **focus**; the assembler keeps it as a real `A` only in the final biome's exit and writes `.` elsewhere.

Assembly: template → seeded mirror/flip (sockets transform with it) → open exactly the planned sockets as `X` on the border, all others stay `#` → pillar clusters (combat/elite; a pillar needs 8 floor neighbours, so it cannot close a passage) → hazard pools (only if `brief.hazards`, never in quiet rooms, reverted if they would leave no hazard-free route) → connectivity repair (L-shaped carve to the spawn) → props → encounters.

Guarantees, all tested on 1 920 rooms per run: rectangular rows within RoomSpec limits · legal chars only · border is wall/void/door · exactly one `P` · spawn, focus and all door entries mutually reachable **with blocking props in place and without stepping on `~`** · props (with footprints) and encounters on walkable tiles · encounters reachable, not inside props, not in doorways · ≤ 12 encounters, ≤ 64 props.

`BuiltRoom.feature`: `none | treasure | lore | rest | biome_exit | anchor`. `focus` is where that thing goes.

## 6 · Encounter director

Budget points = `round((5 + 3·tier) · (0.8 + 0.5·depth/maxDepth) · kindFactor)`, kindFactor 1 combat / 0.6 elite / 0.5 exit. Costs: swarmling 1, husk 2, lurker 2, spewer 3, channeler 4, sentinel 4, warden 5. Purchases are weighted `1/√cost`.

- entrance / rest / treasure / lore / shop: no enemies.
- Caps by size class: enemies 5 / 9 / 13, ranged (sentinel, spewer, warden, channeler) 1 / 3 / 5.
- elite: one pack of the pool's most expensive enemy, `2 + floor(tier/2)` strong, `role: 'elite'`, plus escorts.
- exit: one `role: 'gatekeeper'` (warden if pooled, else the toughest) plus escorts. Final biome: `guardian` with `role: 'guardian'`, and an `anchor_pedestal` prop on the `A` tile. Bosses stand next to the focus.
- Packs are split into groups of ≤ 3 and spread by farthest-point sampling, keeping the largest door/spawn clearance (Manhattan 5 → 1) that fits.

## 7 · Integration guide for F1b

1. **Doors vs legacy exits.** `BuiltRoom.doors[] = {x, y, direction, toRoomId, entry{x,y}}`; each door is an `X` tile, so `X`-count == `doors.length` holds like the legacy rule. `RoomExit.toRoomIndex` (0..2) cannot address a graph. Add `toRoomId: IdString` to `RoomExitSchema` (keep `toRoomIndex` optional for 3-room worlds) and map `doors[i] → {x, y, direction, toRoomId}`. When a player walks through door `d` of room R, place them on the `entry` of the door in room `d.toRoomId` whose `toRoomId === R` (the twin always exists; direction is the opposite).
2. **`P` is only the default spawn.** Use it for the entrance room at biome start and for HQ-style teleports. Every other arrival uses a door `entry`. The legacy "non-final room needs ≥1 exit" rule still holds (every room has ≥1 door).
3. **`isFinal` / `A`.** Only `{tier 4, kind 'exit'}` has an `A` tile + pedestal + guardian: set `isFinal = room.feature === 'anchor'`. Exits of tiers 0–3 have `feature: 'biome_exit'` and **no tile for the portal**: spawn the biome-choice interaction at `focus` once the gatekeeper is dead. `RoomSpec.index` (0..2) has no meaning in a graph; address rooms as `{biomeId, roomId}` (`RoomAddressSchema`), ids are `r00`…`r29`, `r00` is always the entrance.
4. **Roles are hooks.** `BuiltEncounter` is `RoomEncounter` + `role`. B1 should replace `role: 'gatekeeper'` with the scaled one-pattern Custodian and leave `guardian` for PR #16's three-phase fight. Zod strips `role` if you parse with the legacy schema. `BuiltProp` is field-identical to `RoomProp`. Relics, attributions, names and descriptions are not produced here: put lore relics on `focus` of `lore` rooms, treasure on `focus` of `treasure` rooms.
5. **PR #16 terrain.** Output never contains `B = > : +`, and the tests read `TILE_CHARS` / `WALKABLE_TILES` from the registry, so they stay green after #16 merges. Apply `RoomTerrain {features, layout, density}` as a further mutator **after** `buildRoom`, then re-check reachability with the exported `flood(tiles, from, allow, blocked)`; treat `B` as solid. Keep door `entry` tiles and `focus` clear (the assembler keeps a 2-tile Chebyshev margin around them; do the same).

Also worth knowing:

- **Seed.** Legacy `compileWorldRecipe` takes a numeric seed; pass `String(seed)` (or the world id). Persist only `(worldSeed, briefs, route)`; plans and rooms are recomputable. Snapshots need only visited room ids.
- **Validation.** `generateFloorPlan` and `buildRoom` `parse` the brief and throw on an invalid one. Validate model output with `BiomeBriefSchema` first and substitute `DEFAULT_BIOME_BRIEFS[i]` on failure.
- **Doors locking in combat (F2).** Doors are plain walkable `X` tiles; the sim must treat `X` as solid while the room has live encounters.
- **Minimap (F3).** `FloorRoom.cell` is the grid position; `doors` gives the links; `renderFloorPlan` shows the intended look.
- **Cost.** ~0.1–0.4 ms per plan, ~0.3 ms per room.

## 8 · Not done

- Nothing is wired into contracts/compiler/sim/renderer (by design).
- Secret rooms (Isaac's "empty cell touching 3+ rooms" pass) are not generated.
- No per-biome exclusive template sets yet: affinity weighting only. More templates = more distinct biomes.
- Encounter numbers are untuned against real play.
