# FLOORS — spec as implemented (F1a + F1b) + checklists for F2 / F3

Status: **generator, contracts, shared room provider and server path done; behind a flag (default off).** The sim, netcode, renderer and UI do not use floors yet: that is F2 and F3, see §9–§11. With the flag off every output is byte-identical to before.

| File | What |
| --- | --- |
| `src/shared/floors.ts` | Types + Zod schemas: `BiomeBrief`, `BiomeGraph`, `WorldRoute`, `FloorPlan`, `FloorRoom`, `BuiltRoom`, `RoomDoor`, `RoomAddress`. Imports only `registry.ts`. |
| `src/shared/floorgen/rng.ts` | Seeded PRNG (FNV-1a + murmur3 finaliser → mulberry32). |
| `…/floorgen/route.ts` | `planWorldRoute`, `nextBiomeChoices`, `DEFAULT_BIOME_BRIEFS` (8 offline briefs). |
| `…/floorgen/floorplan.ts` | Isaac floor-plan generator, validation, kind assignment, `renderFloorPlan`. |
| `…/floorgen/templates.ts` | 17 hand-made room templates (6 small 13×9, 6 medium 19×13, 5 large 27×17) + `pickTemplate`. |
| `…/floorgen/rooms.ts` | Room assembler: flips, doors, pillar/hazard mutators, connectivity repair, props, encounter placement. |
| `…/floorgen/director.ts` | Encounter director (who is in the room). |
| `…/floorgen/briefs.ts` | **F1b** `deriveBiomeBriefs`, `resolveBiomeBriefs`: 8 briefs for any recipe. |
| `…/floorgen/terrain.ts` | **F1b** `applyBiomeTerrain`: PR #16 terrain as a post-build mutator. |
| `…/floorgen/runtime.ts` | **F1b** `createFloorRuntime` (the shared room provider), `upgradeToFloors`. |
| `…/floorgen/index.ts` | Public API barrel. Import from `src/shared/floorgen`. |
| `tests/shared/floorgen/*.test.ts` | F1a: 42 tests incl. a 1 000-seed fuzz per budget. F1b: `runtime.test.ts` (480 rooms over all 3 fixtures). |
| `tests/shared/floors-contracts.test.ts`, `tests/generation/floors-service.test.ts` | **F1b** schema strictness, bad floors worlds, flag on/off, HTTP. |

Everything is pure (no `Math.random`, no `Date`, no I/O) and imports only from `src/shared`, so **the client can import floorgen too**. F1b moved the folder from `src/server/generation/floorgen/` to `src/shared/floorgen/` for that reason.

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

## 7 · Integration guide F1a wrote for F1b (all five points are now implemented; kept for the reasoning)

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

- The sim, sessions, realtime server, renderer and UI ignore `world.floors` (F2 / F3).
- Secret rooms (Isaac's "empty cell touching 3+ rooms" pass) are not generated.
- No per-biome exclusive template sets yet: affinity weighting only. More templates = more distinct biomes.
- Encounter numbers are untuned against real play.

## 9 · Contracts as landed (F1b)

Everything is additive and optional. `src/shared/floors.ts` never imports `contracts.ts`; `contracts.ts` imports `floors.ts`.

**Flags.** Server: env `RELAY_FLOORS=1` (`config.generation.floors`, passed to `createGenerationService({ floors })`). Per request: `GenerationRequest.floors?: boolean` wins over the env. Browser: `?floors=1` makes `worldProviders.ts` send `floors: true` and upgrades the bundled offline fixture. Default off.

**Rooms.** A `RoomSpec` is either legacy or a floors room, never a mix (`refineRoomAddressing`).

| | legacy room | floors room |
| --- | --- | --- |
| `biomeId`, `roomId`, `kind`, `feature`, `focus` | must be absent | all required (`depth` optional, always set by the runtime) |
| `index` | 0..2, position in `world.rooms` | floor-plan index: `r07` → 7 (max 63) |
| `exits[].toRoomIndex` | 0..2 | plan index of `toRoomId` (so old code reads a number) |
| `exits[].toRoomId`, `exits[].entry` | must be absent | required; `entry` is the walkable tile next to the door, **inside this room** |
| `isFinal` | last planned room | `feature === 'anchor'` (only the tier-4 exit room) |
| `id` | free | `${biomeId}:${roomId}`, for logs and event keys only. Never parse it. |
| `encounters[].role` | absent | `pack · elite · gatekeeper · guardian` |
| `relics` | compiler | lore rooms: one relic on `focus`, a `relic` fragment of `recipe.lore` |
| `anchorRelays` | final room | the anchor room (3 sites) |

Helpers in `floors.ts`: `floorRoomId(7) === 'r07'`, `floorRoomIndex('r07') === 7`, `FLOOR_ENTRANCE_ROOM_ID = 'r00'`, `MAX_FLOOR_ROOM_INDEX = 63`.

**Recipe.** `WorldRecipeSchema` is unchanged because it is the JSON schema sent to the model and strict structured output rejects optional keys. `FloorsWorldRecipeSchema = WorldRecipeSchema.extend({ biomes?: BiomeBrief[8] })` is what worlds and fixtures store, and `type WorldRecipe` is inferred from it. The `bible` extension point for W2 is marked in a comment there. `BiomeBrief` gained optional `terrain {features, layout, density}`.

**World.** `PreparedWorld.floors?: WorldFloors = { seed, route: WorldRoute, briefs: BiomeBrief[8] }`. `WorldFloorsSchema` checks: distinct brief ids · `route.seed === seed` · tiers exactly 1/2/2/2/1 wide · every brief routed once · graph nodes match tiers · full bipartite edges. When `floors` is present:

- `rooms` is exactly `[entrance]` = room `r00` of `floors.route.tiers[0][0]`, byte-identical to what the runtime builds.
- `plannedRoomCount` is `1` and means "`rooms` is complete, nothing else streams". Run length = `floors.route.graph.nodes[].roomBudget`.
- `rooms[0].isFinal` is false. Entrance exits must stay inside the opening biome's room budget (a dangling `toRoomId` is rejected).
- A world without `floors` may not contain floors rooms.

**Snapshot / events / protocol (types only; F2 fills them).**

```ts
GameSnapshot.floor?: FloorRunState = {
  biomeId, roomId, tier /*0..4*/, path: string[] /*biomes entered, current last*/,
  map: FloorMapRoom[] /*{roomId, cell, state:'visited'|'seen', kind|null, cleared, doors:('n'|'s'|'e'|'w')[]}*/,
  doorsLocked: boolean,
  biomeChoice: { fromBiomeId, options: string[1..2], votes: Record<playerId, biomeId>, hostPlayerId|null, chosenBiomeId|null } | null }
room_entered  + biomeId?, floorRoomId?, kind?        exit_reached + toRoomId?
biome_choice_offered { worldId, fromBiomeId, options }
biome_entered { worldId, biomeId, biomeName, tier, chosenByPlayerId|null, playerIds }
ClientMessage { type: 'choose_biome', biomeId }      GameSession.chooseBiome?(biomeId)
```

**Runtime API** (`src/shared/floorgen`, pure, safe in the browser):

```ts
createFloorRuntime(floors: WorldFloors, context?: { recipe?: Pick<WorldRecipe,'lore'> }): FloorRuntime
createWorldFloorRuntime(world)        // = createFloorRuntime(world.floors, { recipe: world.recipe }); use this one
isFloorsWorld(world): boolean
upgradeToFloors(world: PreparedWorld, seed: string): PreparedWorld   // pure, idempotent; also exported from src/server/generation
floorsSeedFor(world, requestSeed?): string                            // String(seed) or the worldId
deriveBiomeBriefs(recipe, seed): BiomeBrief[]   resolveBiomeBriefs(recipe, seed)   // recipe.biomes if valid, else derived
applyBiomeTerrain(built: BuiltRoom, terrain, seed): string[]

FloorRuntime {
  floors; entranceRef(); biomeEntranceRef(biomeId); brief(biomeId); tier(biomeId); plan(biomeId): FloorPlan;
  getRoom(ref: RoomAddress): RoomSpec;            // lazy, cached, RoomSpecSchema-validated, throws on a bad address
  neighbours(ref): { side, direction, ref, kind }[];
  arrivalTile(from, to): {x,y};                   // entry tile of the twin door in `to`
  nextBiomeChoices(biomeId): string[];            // 2, then 1 before the finale, [] after it
  exitRef(biomeId); isBiomeExit(ref); isFinalRoom(ref);
  mapRooms(biomeId, visitedRoomIds, clearedRoomIds?): FloorMapRoom[] }
```

Always create the runtime with the recipe (`createWorldFloorRuntime`): relics depend on `recipe.lore`, so a runtime without it builds lore rooms that differ from the other machine's.

**Terrain.** Combat, elite and exit rooms get the brief's `terrain` (default by first motif, same table as the legacy compiler). Rubble and conduits replace free floor; `B` replaces interior walls that do not touch the void; a bridge is a new wall run with a `=` crossing and `>` ramps, kept only if everything reachable before is still reachable (no `~`, no `B`, props in place). Nothing is stamped within 2 tiles of the spawn, the focus or a door entry, or on a prop or encounter tile.

**Derived briefs.** `biome-1`…`biome-8`. The recipe's first and last blueprint become opener and finale (name, motifs, hazards, terrain). The six between take one archetype each (Warren, Wall, Crossing, Vaults, Shelter, Works: different linearity, branchiness and specials), one world motif plus one motif the world lacks, and an enemy pool that starts from the world's own enemies and adds registry enemies the brief's tier can afford.

## 10 · Checklist for F2 (sim / netcode)

1. Branch on `isFloorsWorld(world)`. Legacy worlds keep today's `rooms[toRoomIndex]` path untouched.
2. One runtime per world on whichever machine runs the sim: `createWorldFloorRuntime(world)` in `LocalSession` and in `realtime.ts`. Remote clients need one too, but only for `getRoom` (rendering): rooms are never sent.
3. `enterPortal` → `runtime.getRoom(runtime.entranceRef())` (equal to `world.rooms[0]`), players on the `P` tile.
4. Door: on an `X` tile, `exit.toRoomId` gives the target `{biomeId: current, roomId}`; place players on `runtime.arrivalTile(from, to)`, not on `P`. Today's `LocalSession`/`realtime` handle `exit_reached` by `toRoomIndex < rooms.length`; with a floors world that is false for every door, so nothing happens until you add the floors branch (no crash). Put `toRoomId` on the event.
5. Door locks: while the room has live encounters treat every `X` as solid and publish `floor.doorsLocked = true`. Cleared rooms stay cleared when re-entered: keep a per-biome set of cleared room ids, and do not respawn their encounters. Also keep dead-enemy/terrain/relic state per visited room if you want it to persist; nothing in the contracts stores it.
6. Snapshot: `roomId = room.id`, `roomIndex = room.index`, and `floor` per §9. Build `floor.map` with `runtime.mapRooms(biomeId, visited, cleared)`.
7. Biome exit: `runtime.isBiomeExit(ref) && !runtime.isFinalRoom(ref)`. When the `gatekeeper` group is dead, open the choice at `room.focus` (hold F, like the Anchor): set `floor.biomeChoice` with `options = runtime.nextBiomeChoices(biomeId)`, emit `biome_choice_offered`. Votes arrive as `choose_biome` (remote) or `chooseBiome()` (local); the host's pick decides, solo decides at once. Then emit `biome_entered`, move everyone to `runtime.biomeEntranceRef(next)` on `P`, reset visited/cleared for the new biome, push to `floor.path`.
8. Final room: `room.isFinal` already drives the existing Anchor + relay code (`A` tile, `anchorRelays`, `guardian` encounter). The sim adds a guardian when a final room has none; floors rooms always have one.
9. `encounters[].role === 'gatekeeper'` is the hook for B1's scaled Custodian. Until then it is an ordinary enemy of that id.
10. `feature: 'treasure' | 'rest'` rooms have an empty `focus` tile and no mechanics yet: yours or B1's to define. `lore` rooms already carry a `RoomRelic`, which the existing lore code reads.
11. Determinism: never build rooms from anything but the runtime; never mutate a returned `RoomSpec` (it is the cached instance).
12. Two-client test: both sides `createWorldFloorRuntime(world)` from the same `world` JSON and compare `JSON.stringify(getRoom(ref))`.

## 11 · Checklist for F3 (renderer / minimap / biome-choice UI)

1. Room to draw: if `snapshot.floor` is set, `createWorldFloorRuntime(world).getRoom({ biomeId: floor.biomeId, roomId: floor.roomId })`; keep the runtime per world id. Otherwise `world.rooms[snapshot.roomIndex]` as today.
2. Theme per biome: `runtime.brief(biomeId)` gives `name`, `tagline`, `motifIds`, `propPool`. `world.art.palette` is still one palette per world; per-biome tinting from `motifIds` is yours.
3. Dressing by `room.kind` and `room.feature`; draw the feature at `room.focus` (store for `treasure`, camp for `rest`, portal for `biome_exit` once the room is cleared; `lore` has a relic there; `anchor` is the existing `A` tile).
4. Doors: every `room.exits[i]` is an `X` tile with a `direction`. Draw them shut while `floor.doorsLocked`.
5. Minimap: `floor.map` only. `cell` is the grid position (max 15×13), `doors` the links, `state: 'seen'` = outline with `kind` hidden, `cleared` for a tick mark, current room = `floor.roomId`. `renderFloorPlan(plan)` shows the intended look in ASCII. Do not read `runtime.plan()` for the minimap: it would reveal the whole floor.
6. Biome choice: shown while `floor.biomeChoice && !chosenBiomeId`. One card per `options[i]` from `runtime.brief(id)` (name, tagline, motifs, enemy pool; room count from `floors.route.graph.nodes`). Click → `session.chooseBiome?.(biomeId)`. Show `votes` next to player names and mark the host. One option (before the finale) is a confirm, not a choice.
7. HUD depth: `floor.tier + 1` of 5, `floor.path` for the breadcrumb, `runtime.brief(floor.biomeId).name` as the area title. Room names and descriptions are plain placeholders until W2 writes them.
8. New tiles never appear in floors rooms beyond the registry's `TILE_CHARS`; terrain chars `B = > : +` do appear in combat, elite and exit rooms.

## 12 · For W2 (prompt / pipeline)

- To have the model write briefs, parse with `FloorsWorldRecipeSchema` (or a second call returning `BiomeBriefListSchema`) and put them on `recipe.biomes`; `upgradeToFloors` picks them up. Order matters: first = opener, last = finale; the middle six are dealt onto tiers 1–3 by the seed. An invalid set falls back to derived briefs without an error.
- `withFloors` in `src/server/generation/index.ts` wraps any service: it takes the first world the legacy pipeline yields and upgrades it, so `liveService.ts` and `provider.ts` were not touched.
- Known gap: a live floors world keeps `recipe.contributionMappings` and the receipt, but floors rooms have no `attributions`, and `LoreFragment.roomIndex` / `ContributionMapping.roomIndex` are still 0..2. The client check in `parseWorldPrefix` skips the mapping↔attribution match for floors worlds. Mapping ideas to briefs is open.
