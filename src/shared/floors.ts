/**
 * RELAY floors model — biome briefs, the biome route DAG, floor plans and built rooms.
 *
 * Owner: Agent F1a (floors). Pure types + Zod schemas: no server imports, no I/O.
 * Spec and integration guide: docs/design/FLOORS.md.
 *
 *  - `BiomeBrief` is the ONLY model-facing shape here. It is bounded, registry-backed
 *    and carries no geometry: the model picks a personality, trusted code builds it.
 *  - `FloorPlan` / `BuiltRoom` are trusted output of src/shared/floorgen.
 *  - `WorldFloors` is what a floors world ships (`PreparedWorld.floors`); the snapshot and
 *    biome-choice shapes at the bottom are what the sim publishes about a floors run.
 *  - contracts.ts imports THIS file, never the reverse; the few primitives needed here are
 *    re-declared with identical bounds.
 */
import { z } from 'zod';
import {
  ENEMY_IDS, HAZARD_BIAS_IDS, MOTIF_IDS, PROP_IDS, TERRAIN_DENSITIES, TERRAIN_FEATURE_IDS, TERRAIN_LAYOUT_IDS,
} from './registry';

// ---------------------------------------------------------------------------
// Primitives (same bounds as contracts.ts IdString / ShortText / TileCoord)
// ---------------------------------------------------------------------------

export const FloorIdString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, 'ids: letters, digits, _ . : -');
const FloorShortText = z.string().trim().min(1).max(80);
const FloorTileCoord = z.number().int().min(0).max(63);

/** Biomes per run and the room budget of each tier (index = tier). */
export const BIOME_TIER_COUNT = 5;
export const ROOM_BUDGETS = [10, 15, 20, 25, 30] as const;
/** Briefs per world: 1 opener + 2 + 2 + 2 + 1 finale. */
export const BIOME_TIER_WIDTHS = [1, 2, 2, 2, 1] as const;
export const BIOME_BRIEF_COUNT = 8;
export const MIN_ROOM_BUDGET = 6;
export const MAX_ROOM_BUDGET = 40;

/** Floor room ids are `r00`..`r63`; the number is the room's position in `FloorPlan.rooms`. */
export const MAX_FLOOR_ROOM_INDEX = 63;
export const FLOOR_ENTRANCE_ROOM_ID = 'r00';
export function floorRoomId(index: number): string {
  return `r${String(index).padStart(2, '0')}`;
}
/** `r07` -> 7; undefined for anything that is not a canonical floor room id. */
export function floorRoomIndex(roomId: string): number | undefined {
  if (!/^r\d{2}$/.test(roomId)) return undefined;
  const index = Number(roomId.slice(1));
  return index <= MAX_FLOOR_ROOM_INDEX ? index : undefined;
}

export const BiomeTierSchema = z.number().int().min(0).max(BIOME_TIER_COUNT - 1);

// ---------------------------------------------------------------------------
// Biome brief (model-facing)
// ---------------------------------------------------------------------------

/** Special-room requests. Small capped ints; the generator clamps to what the floor can hold. */
export const BiomeSpecialsSchema = z.object({
  treasure: z.number().int().min(0).max(2),
  lore: z.number().int().min(0).max(4),
  rest: z.number().int().min(0).max(2),
  elite: z.number().int().min(0).max(4),
});
export type BiomeSpecials = z.infer<typeof BiomeSpecialsSchema>;

/** Layout personality: the crew's ideas change the floor's SHAPE, not only its paint. */
export const BiomeLayoutSchema = z.object({
  /** 0 = sprawling, 1 = one long spine. */
  linearity: z.number().min(0).max(1),
  /** 0 = few side rooms, 1 = a maze of dead ends. */
  branchiness: z.number().min(0).max(1),
  specials: BiomeSpecialsSchema,
});
export type BiomeLayout = z.infer<typeof BiomeLayoutSchema>;

/** Same shape and bounds as contracts `RoomTerrain` (PR #16); applied to the biome's fighting rooms. */
export const BiomeTerrainSchema = z.object({
  features: z.array(z.enum(TERRAIN_FEATURE_IDS)).max(4),
  layout: z.enum(TERRAIN_LAYOUT_IDS),
  density: z.enum(TERRAIN_DENSITIES),
  /** How hard this biome's terrain is tuned, 0..1 (docs/design/TILES.md §4.2). Absent = 0.5. */
  intensity: z.number().min(0).max(1).optional(),
  hazardBias: z.enum(HAZARD_BIAS_IDS).optional(),
});
export type BiomeTerrain = z.infer<typeof BiomeTerrainSchema>;

export const BiomeBriefSchema = z
  .object({
    id: FloorIdString,
    name: FloorShortText,
    tagline: z.string().trim().min(1).max(140),
    motifIds: z.array(z.enum(MOTIF_IDS)).min(1).max(3),
    /** Registry enemy ids. `guardian` is placed by the director only; it may be listed but is never a pack. */
    enemyPool: z.array(z.enum(ENEMY_IDS)).min(1).max(5),
    /** Registry prop ids. `anchor_pedestal` is placed by the director only. */
    propPool: z.array(z.enum(PROP_IDS)).min(1).max(5),
    hazards: z.boolean(),
    layout: BiomeLayoutSchema,
    /** Optional terrain dressing; absent = a default picked from the first motif. floorgen ignores it, the runtime applies it. */
    terrain: BiomeTerrainSchema.optional(),
  })
  .superRefine((brief, ctx) => {
    if (!brief.enemyPool.some((id) => id !== 'guardian')) {
      ctx.addIssue({ code: 'custom', message: 'enemyPool needs at least one non-guardian enemy' });
    }
    if (new Set(brief.enemyPool).size !== brief.enemyPool.length) ctx.addIssue({ code: 'custom', message: 'enemyPool has duplicates' });
    if (new Set(brief.propPool).size !== brief.propPool.length) ctx.addIssue({ code: 'custom', message: 'propPool has duplicates' });
    if (new Set(brief.motifIds).size !== brief.motifIds.length) ctx.addIssue({ code: 'custom', message: 'motifIds has duplicates' });
  });
export type BiomeBrief = z.infer<typeof BiomeBriefSchema>;

// ---------------------------------------------------------------------------
// Biome route (DAG the crew walks: 1 → 2 → 2 → 2 → 1)
// ---------------------------------------------------------------------------

export const BiomeNodeSchema = z.object({
  biomeId: FloorIdString,
  tier: BiomeTierSchema,
  roomBudget: z.number().int().min(MIN_ROOM_BUDGET).max(MAX_ROOM_BUDGET),
});
export type BiomeNode = z.infer<typeof BiomeNodeSchema>;

export const BiomeEdgeSchema = z.object({ from: FloorIdString, to: FloorIdString });
export type BiomeEdge = z.infer<typeof BiomeEdgeSchema>;

export const BiomeGraphSchema = z
  .object({
    nodes: z.array(BiomeNodeSchema).min(1).max(BIOME_BRIEF_COUNT),
    edges: z.array(BiomeEdgeSchema).max(16),
  })
  .superRefine((graph, ctx) => {
    const byId = new Map(graph.nodes.map((n) => [n.biomeId, n]));
    if (byId.size !== graph.nodes.length) ctx.addIssue({ code: 'custom', message: 'duplicate biomeId in graph' });
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) ctx.addIssue({ code: 'custom', message: `edge ${edge.from}->${edge.to} references a missing biome` });
      else if (to.tier !== from.tier + 1) ctx.addIssue({ code: 'custom', message: `edge ${edge.from}->${edge.to} must go exactly one tier deeper` });
    }
    for (const node of graph.nodes) {
      if (node.tier > 0 && !graph.edges.some((e) => e.to === node.biomeId)) {
        ctx.addIssue({ code: 'custom', message: `biome ${node.biomeId} is unreachable` });
      }
    }
  });
export type BiomeGraph = z.infer<typeof BiomeGraphSchema>;

/** `tiers[t]` lists the biome ids offered at depth t; `graph` is the same data as nodes + edges. */
export const WorldRouteSchema = z.object({
  seed: z.string().min(1).max(128),
  tiers: z.array(z.array(FloorIdString).min(1).max(2)).min(1).max(BIOME_TIER_COUNT),
  graph: BiomeGraphSchema,
});
export type WorldRoute = z.infer<typeof WorldRouteSchema>;

// ---------------------------------------------------------------------------
// Floor plan (one biome's room graph on a grid)
// ---------------------------------------------------------------------------

/** `shop` is reserved: schemas accept it, the generator never emits it yet. */
export const ROOM_KINDS = ['entrance', 'combat', 'elite', 'treasure', 'lore', 'rest', 'exit', 'shop'] as const;
export const RoomKindSchema = z.enum(ROOM_KINDS);
export type RoomKind = z.infer<typeof RoomKindSchema>;

export const SIZE_CLASSES = ['small', 'medium', 'large'] as const;
export const SizeClassSchema = z.enum(SIZE_CLASSES);
export type SizeClass = z.infer<typeof SizeClassSchema>;

export const DOOR_SIDES = ['n', 's', 'e', 'w'] as const;
export type DoorSide = (typeof DOOR_SIDES)[number];
/** Long names match the legacy `RoomExit.direction` enum. */
export const DoorDirectionSchema = z.enum(['north', 'south', 'east', 'west']);
export type DoorDirection = z.infer<typeof DoorDirectionSchema>;
export const SIDE_TO_DIRECTION: Record<DoorSide, DoorDirection> = { n: 'north', s: 'south', e: 'east', w: 'west' };
export const OPPOSITE_SIDE: Record<DoorSide, DoorSide> = { n: 's', s: 'n', e: 'w', w: 'e' };
/** Grid step per side. y grows downward (south), like tile rows. */
export const SIDE_DELTA: Record<DoorSide, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  e: { dx: 1, dy: 0 },
  w: { dx: -1, dy: 0 },
};

export const RoomAddressSchema = z.object({ biomeId: FloorIdString, roomId: FloorIdString });
export type RoomAddress = z.infer<typeof RoomAddressSchema>;

export const FloorDoorsSchema = z.object({
  n: FloorIdString.optional(),
  s: FloorIdString.optional(),
  e: FloorIdString.optional(),
  w: FloorIdString.optional(),
});
export type FloorDoors = z.infer<typeof FloorDoorsSchema>;

export const FloorRoomSchema = z.object({
  id: FloorIdString,
  cell: z.object({ x: z.number().int().min(0).max(15), y: z.number().int().min(0).max(15) }),
  kind: RoomKindSchema,
  /** Side → neighbour room id. A door always has a twin on the neighbour's opposite side. */
  doors: FloorDoorsSchema,
  /** Steps from the entrance along the graph (the graph is a tree, so this is unique). */
  depth: z.number().int().min(0).max(MAX_ROOM_BUDGET),
  templateId: FloorIdString,
  sizeClass: SizeClassSchema,
});
export type FloorRoom = z.infer<typeof FloorRoomSchema>;

export const FloorPlanStatsSchema = z.object({
  /** Generate-validate-retry attempts used (1 = first try). */
  attempts: z.number().int().min(1),
  /** True only if the retry cap was hit and the deterministic comb fallback was used. */
  usedFallback: z.boolean(),
  deadEnds: z.number().int().min(0),
  maxDepth: z.number().int().min(0),
  /** Specials actually placed, after clamping to the floor's capacity. */
  specials: BiomeSpecialsSchema,
});
export type FloorPlanStats = z.infer<typeof FloorPlanStatsSchema>;

export const FloorPlanSchema = z
  .object({
    biomeId: FloorIdString,
    tier: BiomeTierSchema,
    seed: z.string().min(1).max(128),
    grid: z.object({ width: z.number().int().min(5).max(16), height: z.number().int().min(5).max(16) }),
    rooms: z.array(FloorRoomSchema).min(2).max(MAX_ROOM_BUDGET),
    entranceId: FloorIdString,
    exitId: FloorIdString,
    stats: FloorPlanStatsSchema,
  })
  .superRefine((plan, ctx) => {
    const byId = new Map(plan.rooms.map((r) => [r.id, r]));
    if (byId.size !== plan.rooms.length) ctx.addIssue({ code: 'custom', message: 'duplicate room id' });
    if (byId.get(plan.entranceId)?.kind !== 'entrance') ctx.addIssue({ code: 'custom', message: 'entranceId is not an entrance room' });
    if (byId.get(plan.exitId)?.kind !== 'exit') ctx.addIssue({ code: 'custom', message: 'exitId is not an exit room' });
    for (const room of plan.rooms) {
      if (room.cell.x >= plan.grid.width || room.cell.y >= plan.grid.height) {
        ctx.addIssue({ code: 'custom', message: `room ${room.id} is outside the grid` });
      }
      for (const side of DOOR_SIDES) {
        const toId = room.doors[side];
        if (toId === undefined) continue;
        const other = byId.get(toId);
        const delta = SIDE_DELTA[side];
        if (!other) ctx.addIssue({ code: 'custom', message: `room ${room.id} door ${side} leads to missing room ${toId}` });
        else if (other.doors[OPPOSITE_SIDE[side]] !== room.id) {
          ctx.addIssue({ code: 'custom', message: `room ${room.id} door ${side} has no twin on ${toId}` });
        } else if (other.cell.x !== room.cell.x + delta.dx || other.cell.y !== room.cell.y + delta.dy) {
          ctx.addIssue({ code: 'custom', message: `room ${room.id} door ${side} does not lead to the adjacent cell` });
        }
      }
    }
  });
export type FloorPlan = z.infer<typeof FloorPlanSchema>;

// ---------------------------------------------------------------------------
// Built room (tiles + doors + dressing + encounters for one FloorRoom)
// ---------------------------------------------------------------------------

export const RoomDoorSchema = z.object({
  /** The door tile itself: an 'X' on the room's border wall. */
  x: FloorTileCoord,
  y: FloorTileCoord,
  direction: DoorDirectionSchema,
  toRoomId: FloorIdString,
  /** Walkable interior tile just inside the door: where a player arriving through it stands. */
  entry: z.object({ x: FloorTileCoord, y: FloorTileCoord }),
});
export type RoomDoor = z.infer<typeof RoomDoorSchema>;

/** What stands on the room's focus tile. */
export const RoomFeatureSchema = z.enum(['none', 'anchor', 'biome_exit', 'treasure', 'lore', 'rest']);
export type RoomFeature = z.infer<typeof RoomFeatureSchema>;

export const EncounterRoleSchema = z.enum(['pack', 'elite', 'gatekeeper', 'guardian']);
export type EncounterRole = z.infer<typeof EncounterRoleSchema>;

/** Field-compatible with contracts RoomProp (id, propId, x, y). */
export const BuiltPropSchema = z.object({
  id: FloorIdString,
  propId: z.enum(PROP_IDS),
  x: FloorTileCoord,
  y: FloorTileCoord,
});
export type BuiltProp = z.infer<typeof BuiltPropSchema>;

/** Field-compatible with contracts RoomEncounter (id, enemyId, x, y, count) plus `role`. */
export const BuiltEncounterSchema = z.object({
  id: FloorIdString,
  enemyId: z.enum(ENEMY_IDS),
  x: FloorTileCoord,
  y: FloorTileCoord,
  count: z.number().int().min(1).max(6),
  role: EncounterRoleSchema,
});
export type BuiltEncounter = z.infer<typeof BuiltEncounterSchema>;

export const BuiltRoomSchema = z.object({
  address: RoomAddressSchema,
  kind: RoomKindSchema,
  depth: z.number().int().min(0),
  templateId: FloorIdString,
  sizeClass: SizeClassSchema,
  width: z.number().int().min(8).max(48),
  height: z.number().int().min(6).max(32),
  tiles: z.array(z.string()).min(6).max(32),
  doors: z.array(RoomDoorSchema).min(1).max(4),
  /** The single 'P' tile: default spawn (used when a room is entered without a door, e.g. the entrance). */
  spawn: z.object({ x: FloorTileCoord, y: FloorTileCoord }),
  /** The room's point of interest. It is the 'A' tile when `feature` is `anchor`, plain floor otherwise. */
  focus: z.object({ x: FloorTileCoord, y: FloorTileCoord }),
  feature: RoomFeatureSchema,
  props: z.array(BuiltPropSchema).max(64),
  encounters: z.array(BuiltEncounterSchema).max(12),
});
export type BuiltRoom = z.infer<typeof BuiltRoomSchema>;

// ---------------------------------------------------------------------------
// World floors (what a floors world ships) — added by F1b
// ---------------------------------------------------------------------------

/** Exactly 8 briefs with distinct ids: opener, 2+2+2 choices, finale (in that order before routing). */
export const BiomeBriefListSchema = z
  .array(BiomeBriefSchema)
  .length(BIOME_BRIEF_COUNT)
  .superRefine((briefs, ctx) => {
    if (new Set(briefs.map((brief) => brief.id)).size !== briefs.length) ctx.addIssue({ code: 'custom', message: 'biome brief ids must be distinct' });
  });
export type BiomeBriefList = z.infer<typeof BiomeBriefListSchema>;

/**
 * Everything needed to rebuild every room of a run on any machine: rooms are compiled
 * lazily from `(seed, brief, tier)` by `createFloorRuntime` (src/shared/floorgen/runtime.ts).
 * Plans and rooms are never persisted or sent.
 */
export const WorldFloorsSchema = z
  .object({
    seed: z.string().min(1).max(128),
    route: WorldRouteSchema,
    briefs: BiomeBriefListSchema,
  })
  .superRefine((floors, ctx) => {
    const { route } = floors;
    if (route.seed !== floors.seed) ctx.addIssue({ code: 'custom', message: 'route.seed differs from floors.seed' });
    const widths = route.tiers.map((tier) => tier.length);
    if (widths.length !== BIOME_TIER_COUNT || widths.some((width, tier) => width !== BIOME_TIER_WIDTHS[tier])) {
      ctx.addIssue({ code: 'custom', message: `route tiers must be ${BIOME_TIER_WIDTHS.join('/')} wide, found ${widths.join('/')}` });
      return;
    }
    const briefIds = new Set(floors.briefs.map((brief) => brief.id));
    const routed = route.tiers.flat();
    if (new Set(routed).size !== routed.length || routed.some((id) => !briefIds.has(id))) {
      ctx.addIssue({ code: 'custom', message: 'route tiers must place every brief id exactly once' });
    }
    route.tiers.forEach((ids, tier) => {
      for (const id of ids) {
        const node = route.graph.nodes.find((candidate) => candidate.biomeId === id);
        if (!node || node.tier !== tier) ctx.addIssue({ code: 'custom', message: `route graph has no tier-${tier} node for ${id}` });
        else if (node.roomBudget > MAX_FLOOR_ROOM_INDEX + 1) ctx.addIssue({ code: 'custom', message: `biome ${id} room budget exceeds ${MAX_FLOOR_ROOM_INDEX + 1}` });
        if (tier < BIOME_TIER_COUNT - 1) {
          for (const next of route.tiers[tier + 1]!) {
            if (!route.graph.edges.some((edge) => edge.from === id && edge.to === next)) {
              ctx.addIssue({ code: 'custom', message: `route graph is missing edge ${id}->${next}` });
            }
          }
        }
      }
    });
    if (route.graph.nodes.length !== routed.length) ctx.addIssue({ code: 'custom', message: 'route graph has nodes outside the tiers' });
  });
export type WorldFloors = z.infer<typeof WorldFloorsSchema>;

// ---------------------------------------------------------------------------
// Floors run state (published by the sim in GameSnapshot.floor) — types by F1b, filled by F2
// ---------------------------------------------------------------------------

/** One room the minimap may draw. Derived from the floor plan; only seen rooms are listed. */
export const FloorMapRoomSchema = z.object({
  roomId: FloorIdString,
  cell: z.object({ x: z.number().int().min(0).max(15), y: z.number().int().min(0).max(15) }),
  /** `visited` = a player has stood in it. `seen` = a neighbour of a visited room: draw as an outline. */
  state: z.enum(['visited', 'seen']),
  /** Hidden (`null`) for `seen` rooms unless the sim decides to reveal it (e.g. the exit). */
  kind: RoomKindSchema.nullable(),
  cleared: z.boolean(),
  /** Sides with a door, so links can be drawn without the plan. */
  doors: z.array(z.enum(DOOR_SIDES)).max(4),
});
export type FloorMapRoom = z.infer<typeof FloorMapRoomSchema>;

/**
 * Offered once the gatekeeper of a non-final biome exit is dead. Every player may vote;
 * the host's pick decides in co-op (solo: the only vote). `chosenBiomeId` is set on the
 * tick the choice resolves, just before the crew is moved to the next biome's entrance.
 */
export const BiomeChoiceStateSchema = z.object({
  fromBiomeId: FloorIdString,
  /** 1 option before the finale, otherwise 2. Ids index into `PreparedWorld.floors.briefs`. */
  options: z.array(FloorIdString).min(1).max(2),
  /** playerId -> biomeId. */
  votes: z.record(z.string().max(64), FloorIdString),
  hostPlayerId: z.string().max(64).nullable(),
  chosenBiomeId: FloorIdString.nullable(),
});
export type BiomeChoiceState = z.infer<typeof BiomeChoiceStateSchema>;

export const FloorRunStateSchema = z.object({
  biomeId: FloorIdString,
  roomId: FloorIdString,
  /** Depth of the current biome in the run, 0..4. */
  tier: BiomeTierSchema,
  /** Biome ids entered so far, current one last (length = tier + 1). */
  path: z.array(FloorIdString).min(1).max(BIOME_TIER_COUNT),
  /** Current biome only: visited rooms plus their not-yet-visited neighbours (fog of war). */
  map: z.array(FloorMapRoomSchema).max(MAX_FLOOR_ROOM_INDEX + 1),
  /** True while the current room has live encounters: door tiles are solid. */
  doorsLocked: z.boolean(),
  /** Biome-local destinations that the current room can no longer enter. */
  blockedDoorRoomIds: z.array(FloorIdString).max(DOOR_SIDES.length).optional(),
  biomeChoice: BiomeChoiceStateSchema.nullable(),
});
export type FloorRunState = z.infer<typeof FloorRunStateSchema>;
