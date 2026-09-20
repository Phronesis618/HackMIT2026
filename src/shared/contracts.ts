/**
 * RELAY shared contracts: Zod runtime schemas + inferred TypeScript types for every
 * piece of data that crosses an agent or trust boundary.
 *
 * Owner: Agent A. Agents B and C consume these; propose changes as the smallest
 * possible patch in an integration request (see AGENTS.md).
 *
 * Validate at the boundary, trust inside:
 *  - HTTP/WebSocket bodies  -> parse with these schemas in src/server.
 *  - Model output (Agent B) -> WorldRecipe, then compile to RoomSpec/ArtRecipe and
 *    validate again with PreparedWorld before anything reaches the client.
 *  - Fixture files          -> WorldFixture (tests enforce).
 *  - localStorage (Agent C) -> MemoryRecord array.
 */
import { z } from 'zod';
import {
  ABILITY_IDS,
  ATTUNEMENT_EFFECT_IDS,
  CLASS_IDS,
  ENEMY_IDS,
  MOTIF_IDS,
  PROP_IDS,
  PROP_INFO,
  TERRAIN_DENSITIES,
  TERRAIN_FEATURE_IDS,
  TERRAIN_LAYOUT_IDS,
  TILE_CHARS,
  WALKABLE_TILES,
} from './registry';
import {
  BiomeBriefListSchema,
  EncounterRoleSchema,
  FloorIdString,
  FLOOR_ENTRANCE_ROOM_ID,
  FloorRunStateSchema,
  floorRoomIndex,
  MAX_FLOOR_ROOM_INDEX,
  RoomFeatureSchema,
  RoomKindSchema,
  WorldFloorsSchema,
} from './floors';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const IdString = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, 'ids: letters, digits, _ . : -');
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');
export const ShortText = z.string().trim().min(1).max(80);
export const ContributionText = z.string().trim().min(1).max(200);
export const Paragraph = z.string().trim().min(1).max(600);
export const Timestamp = z.number().int().nonnegative(); // Unix ms
export const TileCoord = z.number().int().min(0).max(63);
/** Sparse per-tile state is keyed "col,row" (TILES.md R6). */
export const TileKey = z.string().regex(/^\d+,\d+$/);

export const ClassIdSchema = z.enum(CLASS_IDS);
export const AbilityIdSchema = z.enum(ABILITY_IDS);
export const EnemyIdSchema = z.enum(ENEMY_IDS);
export const MotifIdSchema = z.enum(MOTIF_IDS);
export const PropIdSchema = z.enum(PROP_IDS);

// ---------------------------------------------------------------------------
// Identity & contributions
// ---------------------------------------------------------------------------

export const PlayerIdentitySchema = z.object({
  id: IdString,
  displayName: z.string().trim().min(1).max(24),
  classId: ClassIdSchema,
});
export type PlayerIdentity = z.infer<typeof PlayerIdentitySchema>;

/** An actual player-authored idea for the world, attributed to a real player. */
export const ContributionSchema = z.object({
  id: IdString,
  playerId: IdString,
  playerName: z.string().trim().min(1).max(24),
  text: ContributionText,
  submittedAt: Timestamp,
});
export type Contribution = z.infer<typeof ContributionSchema>;

// ---------------------------------------------------------------------------
// Generation request / provenance / status
// ---------------------------------------------------------------------------

export const GenerationRequestSchema = z.object({
  requestId: IdString,
  sessionId: IdString,
  contributions: z.array(ContributionSchema).max(24),
  /** Deterministic seed for fixture selection / layout jitter. */
  seed: z.number().int().nonnegative().optional(),
  /** How many rooms the run will eventually have (rooms may be committed one at a time). */
  plannedRoomCount: z.number().int().min(1).max(3).default(3),
  /**
   * Floors mode override for this request: true = attach `PreparedWorld.floors`, false = never,
   * absent = the server's RELAY_FLOORS default. `plannedRoomCount` only shapes the legacy rooms.
   */
  floors: z.boolean().optional(),
});
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
export type GenerationRequestInput = z.input<typeof GenerationRequestSchema>;

/**
 * Where the world came from. This is shown to players; it must never lie.
 *  fixture               — authored offline content (no model call was made)
 *  live                  — produced by a model call during this request
 *  live_fallback_fixture — a live attempt was made and FAILED; fixture served instead
 */
export const GenerationSourceSchema = z.enum(['fixture', 'live', 'live_fallback_fixture']);
export type GenerationSource = z.infer<typeof GenerationSourceSchema>;

export const GenerationProvenanceSchema = z.object({
  source: GenerationSourceSchema,
  /** Human-readable badge text, e.g. "OFFLINE FIXTURE" or "LIVE · gpt-x". */
  label: z.string().min(1).max(80),
  fixtureId: IdString.optional(),
  model: z.string().max(80).optional(),
  generatedAt: Timestamp,
  durationMs: z.number().nonnegative(),
  /** Number of model calls attempted (0 for pure fixture). */
  attempts: z.number().int().nonnegative(),
  notes: z.array(z.string().max(200)).max(10),
});
export type GenerationProvenance = z.infer<typeof GenerationProvenanceSchema>;

export const GenerationPhaseSchema = z.enum([
  'idle',
  'queued',
  'generating',
  'validating',
  'ready',
  'fallback',
  'failed',
]);
export type GenerationPhase = z.infer<typeof GenerationPhaseSchema>;

export const GenerationStatusSchema = z.object({
  phase: GenerationPhaseSchema,
  message: z.string().max(200),
  requestId: IdString.nullable(),
  startedAt: Timestamp.nullable(),
  elapsedMs: z.number().nonnegative(),
});
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const IDLE_GENERATION_STATUS: GenerationStatus = {
  phase: 'idle',
  message: 'No world requested yet.',
  requestId: null,
  startedAt: null,
  elapsedMs: 0,
};

// ---------------------------------------------------------------------------
// Art recipe (palette + motifs). One shared visual system; recipes pick variants.
// ---------------------------------------------------------------------------

export const PaletteSchema = z.object({
  background: HexColor,
  floor: HexColor,
  floorAlt: HexColor,
  wall: HexColor,
  wallEdge: HexColor,
  accent: HexColor,
  accentSoft: HexColor,
  glow: HexColor,
  hazard: HexColor,
  text: HexColor,
});
export type Palette = z.infer<typeof PaletteSchema>;

export const ArtRecipeSchema = z.object({
  paletteFamily: z.literal('ink-neon'),
  palette: PaletteSchema,
  /** Structural motifs, most dominant first. Drives silhouettes, props, decals. */
  motifIds: z.array(MotifIdSchema).min(1).max(4),
  /** Background skyline silhouette motif. */
  skyline: MotifIdSchema,
  fog: z.number().min(0).max(1),
  glowIntensity: z.number().min(0).max(1),
});
export type ArtRecipe = z.infer<typeof ArtRecipeSchema>;

// ---------------------------------------------------------------------------
// Room spec (compiled, trusted, renderable, simulatable)
// ---------------------------------------------------------------------------

export const AttributionKindSchema = z.enum(['structure', 'prop', 'encounter', 'motif', 'name', 'hazard']);

/** Links a real contribution to an observable feature of the world. */
export const AttributionSchema = z.object({
  contributionId: IdString,
  kind: AttributionKindSchema,
  featureDescription: z.string().trim().min(1).max(200),
  /** Optional room-local target so the renderer can highlight it. */
  target: z.object({ roomIndex: z.number().int().min(0), x: TileCoord, y: TileCoord }).optional(),
});
export type Attribution = z.infer<typeof AttributionSchema>;

export const RoomPropSchema = z.object({
  id: IdString,
  propId: PropIdSchema,
  x: TileCoord,
  y: TileCoord,
  attributionId: IdString.optional(),
});
export type RoomProp = z.infer<typeof RoomPropSchema>;

export const RoomEncounterSchema = z.object({
  id: IdString,
  enemyId: EnemyIdSchema,
  x: TileCoord,
  y: TileCoord,
  count: z.number().int().min(1).max(6),
  attributionId: IdString.optional(),
  /** Floors rooms only: why the director placed this group (hook for gatekeeper/guardian fights). */
  role: EncounterRoleSchema.optional(),
});
export type RoomEncounter = z.infer<typeof RoomEncounterSchema>;

/** A `relic` lore fragment lying on the floor of this room (see LoreFragmentSchema). */
export const RoomRelicSchema = z.object({
  id: IdString,
  x: TileCoord,
  y: TileCoord,
  /** Index into `WorldRecipe.lore`; validated against the recipe in PreparedWorldSchema. */
  fragmentIndex: z.number().int().min(0),
});
export type RoomRelic = z.infer<typeof RoomRelicSchema>;

/**
 * A door tile. Legacy 3-room worlds address the target by `toRoomIndex` (0..2) alone.
 * Floors rooms address it by `toRoomId` within the same biome and also carry `entry`;
 * there `toRoomIndex` is the target's position in its floor plan (`r07` -> 7), kept so
 * legacy consumers still read a number. RoomSpecSchema enforces which form a room uses.
 */
export const RoomExitSchema = z.object({
  x: TileCoord,
  y: TileCoord,
  toRoomIndex: z.number().int().min(0).max(MAX_FLOOR_ROOM_INDEX),
  direction: z.enum(['north', 'south', 'east', 'west']),
  /** Floors: id of the neighbouring room in the same biome. */
  toRoomId: FloorIdString.optional(),
  /** Floors: walkable tile just inside THIS door; a player arriving through it stands here. */
  entry: z.object({ x: TileCoord, y: TileCoord }).optional(),
});
export type RoomExit = z.infer<typeof RoomExitSchema>;

const tileCharSet = new Set<string>(TILE_CHARS);

export const RoomSpecSchema = z
  .object({
    id: IdString,
    /** Legacy: position in `PreparedWorld.rooms` (0..2). Floors: position in the biome's floor plan (0..63). */
    index: z.number().int().min(0).max(MAX_FLOOR_ROOM_INDEX),
    name: ShortText,
    description: z.string().trim().max(300),
    width: z.number().int().min(8).max(48),
    height: z.number().int().min(6).max(32),
    /** Row-major tile rows; see registry TILE_CHARS. */
    tiles: z.array(z.string()).min(6).max(32),
    props: z.array(RoomPropSchema).max(64),
    encounters: z.array(RoomEncounterSchema).max(12),
    exits: z.array(RoomExitSchema).max(4),
    isFinal: z.boolean(),
    attributions: z.array(AttributionSchema).max(24),
    relics: z.array(RoomRelicSchema).max(6).default([]),
    anchorRelays: z.array(z.object({ x: TileCoord, y: TileCoord })).length(3).optional(),
    /**
     * How hard this room's terrain was tuned (docs/design/TILES.md §4.2). The model asks for a
     * number in [0,1]; trusted code decides what it means (`terrainTuning` in shared/terrain.ts).
     * Absent = the baseline 0.5, so every legacy room and fixture keeps today's numbers.
     */
    terrainIntensity: z.number().min(0).max(1).optional(),
    // --- floors rooms only (all absent on legacy rooms; see docs/design/FLOORS.md) ---
    /** Address of this room: `{biomeId, roomId}`. `id` is `${biomeId}:${roomId}`. */
    biomeId: FloorIdString.optional(),
    roomId: FloorIdString.optional(),
    kind: RoomKindSchema.optional(),
    /** What stands on `focus`: treasure, a lore relic, a rest site, the biome exit or the Anchor. */
    feature: RoomFeatureSchema.optional(),
    /** The room's point of interest; the 'A' tile when `feature` is `anchor`, plain floor otherwise. */
    focus: z.object({ x: TileCoord, y: TileCoord }).optional(),
    /** Steps from the biome entrance along the floor graph. */
    depth: z.number().int().min(0).max(MAX_FLOOR_ROOM_INDEX).optional(),
  })
  .superRefine((room, ctx) => {
    refineRoomAddressing(room, ctx);
    if (room.tiles.length !== room.height) {
      ctx.addIssue({ code: 'custom', message: `tiles has ${room.tiles.length} rows, height is ${room.height}` });
      return;
    }
    let spawns = 0;
    let anchors = 0;
    const exitTiles = new Set<string>();
    room.tiles.forEach((row, y) => {
      if (row.length !== room.width) {
        ctx.addIssue({ code: 'custom', message: `row ${y} has width ${row.length}, expected ${room.width}` });
      }
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!;
        if (!tileCharSet.has(ch)) {
          ctx.addIssue({ code: 'custom', message: `row ${y} col ${x}: unknown tile '${ch}'` });
        }
        if (ch === 'P') spawns++;
        if (ch === 'A') anchors++;
        if (ch === 'X') exitTiles.add(`${x},${y}`);
      }
    });
    if (spawns !== 1) ctx.addIssue({ code: 'custom', message: `expected exactly one 'P' spawn, found ${spawns}` });
    if (room.isFinal && anchors !== 1) {
      ctx.addIssue({ code: 'custom', message: `final room needs exactly one 'A' anchor site, found ${anchors}` });
    }
    if (!room.isFinal && anchors !== 0) {
      ctx.addIssue({ code: 'custom', message: `only the final room may contain an 'A' tile` });
    }
    for (const exit of room.exits) {
      if (!exitTiles.has(`${exit.x},${exit.y}`)) {
        ctx.addIssue({ code: 'custom', message: `exit at (${exit.x},${exit.y}) is not an 'X' tile` });
      }
    }
    if (exitTiles.size !== room.exits.length) {
      ctx.addIssue({ code: 'custom', message: `${exitTiles.size} 'X' tiles but ${room.exits.length} exits entries` });
    }
    if (!room.isFinal && room.exits.length === 0) {
      ctx.addIssue({ code: 'custom', message: `non-final room needs at least one exit` });
    }
    const inBounds = (x: number, y: number) => x < room.width && y < room.height;
    const walkable = (x: number, y: number) => {
      const ch = room.tiles[y]?.[x];
      return ch !== undefined && WALKABLE_TILES.has(ch);
    };
    for (const p of room.props) {
      if (!inBounds(p.x, p.y)) ctx.addIssue({ code: 'custom', message: `prop ${p.id} out of bounds` });
      else if (!walkable(p.x, p.y)) ctx.addIssue({ code: 'custom', message: `prop ${p.id} is placed on a wall/void tile` });
      const info = PROP_INFO[p.propId];
      if (info.blocksMovement) {
        for (let dy = 0; dy < info.footprint.h; dy++) {
          for (let dx = 0; dx < info.footprint.w; dx++) {
            const tile = room.tiles[p.y + dy]?.[p.x + dx];
            if (tile !== '.') {
              ctx.addIssue({ code: 'custom', message: `blocking prop ${p.id} overlaps a solid, special tile or boundary` });
            }
          }
        }
      }
    }
    for (const e of room.encounters) {
      if (!inBounds(e.x, e.y)) ctx.addIssue({ code: 'custom', message: `encounter ${e.id} out of bounds` });
      else if (!walkable(e.x, e.y)) ctx.addIssue({ code: 'custom', message: `encounter ${e.id} is placed on a wall/void tile` });
    }
    for (const r of room.relics) {
      if (!inBounds(r.x, r.y)) ctx.addIssue({ code: 'custom', message: `relic ${r.id} out of bounds` });
      else if (!walkable(r.x, r.y)) ctx.addIssue({ code: 'custom', message: `relic ${r.id} is placed on a wall/void tile` });
    }
    if (room.anchorRelays) {
      const unique = new Set(room.anchorRelays.map((relay) => `${relay.x},${relay.y}`));
      if (!room.isFinal || unique.size !== 3) ctx.addIssue({ code: 'custom', message: 'Anchor relays require three distinct sites in the final room' });
      for (const relay of room.anchorRelays) {
        if (!inBounds(relay.x, relay.y) || !walkable(relay.x, relay.y) || room.tiles[relay.y]?.[relay.x] === '~') {
          ctx.addIssue({ code: 'custom', message: 'Anchor relay must be on safe walkable ground' });
        }
      }
    }
  });
export type RoomSpec = z.infer<typeof RoomSpecSchema>;

/**
 * A room is either legacy (no address, index/toRoomIndex 0..2 exactly as before floors) or a
 * floors room (full address, every exit carries `toRoomId` + `entry`). Nothing in between.
 */
function refineRoomAddressing(
  room: {
    index: number; width: number; height: number; tiles: string[]; isFinal: boolean;
    biomeId?: string; roomId?: string; kind?: string; feature?: string; focus?: { x: number; y: number };
    exits: Array<{ x: number; y: number; toRoomIndex: number; toRoomId?: string; entry?: { x: number; y: number } }>;
  },
  ctx: z.RefinementCtx,
): void {
  const floors = room.biomeId !== undefined || room.roomId !== undefined;
  if (!floors) {
    if (room.index > 2) ctx.addIssue({ code: 'custom', message: `legacy room index ${room.index} exceeds 2` });
    if (room.kind !== undefined || room.feature !== undefined || room.focus !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'kind/feature/focus need a floors address (biomeId + roomId)' });
    }
    for (const exit of room.exits) {
      if (exit.toRoomIndex > 2) ctx.addIssue({ code: 'custom', message: `legacy exit targets room ${exit.toRoomIndex}, max is 2` });
      if (exit.toRoomId !== undefined || exit.entry !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'exit toRoomId/entry need a floors address on the room' });
      }
    }
    return;
  }
  if (room.biomeId === undefined || room.roomId === undefined || room.kind === undefined || room.feature === undefined || room.focus === undefined) {
    ctx.addIssue({ code: 'custom', message: 'floors room needs biomeId, roomId, kind, feature and focus' });
    return;
  }
  if (floorRoomIndex(room.roomId) !== room.index) {
    ctx.addIssue({ code: 'custom', message: `floors room ${room.roomId} must have index ${floorRoomIndex(room.roomId) ?? '<rNN>'}, found ${room.index}` });
  }
  if (room.isFinal !== (room.feature === 'anchor')) {
    ctx.addIssue({ code: 'custom', message: `floors room isFinal must equal feature === 'anchor'` });
  }
  const walkable = (x: number, y: number) => WALKABLE_TILES.has(room.tiles[y]?.[x] ?? ' ');
  if (!walkable(room.focus.x, room.focus.y)) ctx.addIssue({ code: 'custom', message: 'focus is not on a walkable tile' });
  if (room.exits.length === 0) ctx.addIssue({ code: 'custom', message: 'floors room needs at least one door' });
  const targets = new Set<string>();
  for (const exit of room.exits) {
    if (exit.toRoomId === undefined || exit.entry === undefined) {
      ctx.addIssue({ code: 'custom', message: `floors exit at (${exit.x},${exit.y}) needs toRoomId and entry` });
      continue;
    }
    if (exit.toRoomId === room.roomId) ctx.addIssue({ code: 'custom', message: 'exit leads back to its own room' });
    if (floorRoomIndex(exit.toRoomId) !== exit.toRoomIndex) {
      ctx.addIssue({ code: 'custom', message: `exit toRoomIndex ${exit.toRoomIndex} does not match toRoomId ${exit.toRoomId}` });
    }
    if (targets.has(exit.toRoomId)) ctx.addIssue({ code: 'custom', message: `two doors lead to ${exit.toRoomId}` });
    targets.add(exit.toRoomId);
    const adjacent = Math.abs(exit.entry.x - exit.x) + Math.abs(exit.entry.y - exit.y) === 1;
    if (!adjacent || !walkable(exit.entry.x, exit.entry.y) || room.tiles[exit.entry.y]?.[exit.entry.x] === 'X') {
      ctx.addIssue({ code: 'custom', message: `exit entry (${exit.entry.x},${exit.entry.y}) must be a walkable tile next to its door` });
    }
  }
}

/** Every room relic must point at a `relic` fragment of the recipe it ships with. */
function refineRelicReferences(world: { recipe: WorldRecipe; rooms: RoomSpec[] }, ctx: z.RefinementCtx): void {
  world.rooms.forEach((room, i) => {
    for (const relic of room.relics) {
      const fragment = world.recipe.lore[relic.fragmentIndex];
      if (!fragment) ctx.addIssue({ code: 'custom', message: `room ${i} relic ${relic.id} references missing lore fragment ${relic.fragmentIndex}` });
      else if (fragment.kind !== 'relic') ctx.addIssue({ code: 'custom', message: `room ${i} relic ${relic.id} references a ${fragment.kind} fragment` });
    }
  });
}

// ---------------------------------------------------------------------------
// World recipe (model-facing structured output) and prepared world (client-facing)
// ---------------------------------------------------------------------------

export const RoomTerrainSchema = z.object({
  features: z.array(z.enum(TERRAIN_FEATURE_IDS)).max(4),
  layout: z.enum(TERRAIN_LAYOUT_IDS),
  density: z.enum(TERRAIN_DENSITIES),
});
export type RoomTerrain = z.infer<typeof RoomTerrainSchema>;

const roomBlueprintShape = {
  name: ShortText,
  description: z.string().trim().max(300),
  motifIds: z.array(MotifIdSchema).min(1).max(3),
  propIds: z.array(PropIdSchema).max(6),
  enemyIds: z.array(EnemyIdSchema).max(3),
  hazards: z.boolean(),
  terrain: RoomTerrainSchema.nullable().optional(),
};
// Provider JSON requires nullable keys; local parsing also accepts legacy recipes.
export const RoomBlueprintSchema = z.object(roomBlueprintShape).meta({ required: Object.keys(roomBlueprintShape) });
export type RoomBlueprint = z.infer<typeof RoomBlueprintSchema>;

export const ContributionMappingSchema = z.object({
  contributionId: IdString,
  kind: AttributionKindSchema,
  featureDescription: z.string().trim().min(1).max(200),
  roomIndex: z.number().int().min(0).max(2),
});
export type ContributionMapping = z.infer<typeof ContributionMappingSchema>;

/**
 * The bounded, structured output a model may produce. No code, markup, URLs or
 * expressions — only enumerated IDs, short text and numbers. Agent B compiles this
 * into RoomSpec[] + ArtRecipe with a deterministic, trusted compiler.
 */
/**
 * Lore is shown, not told. The model writes each fragment as bounded data and trusted
 * code decides how it reaches the player:
 *  - `relic`: an artifact lying in `roomIndex`; a player holds F beside it to read it.
 *  - `remains`: what `enemyId` leaves behind. Drops the first time that kind is defeated
 *    in a run and is picked up by touch, so the bestiary is earned in combat.
 * Fragments are referenced by their index in `recipe.lore` everywhere else.
 */
export const LoreFragmentSchema = z.object({
  kind: z.enum(['relic', 'remains']),
  title: z.string().trim().min(1).max(40),
  /** Where it comes from, in-world: "scratched into a tide gauge", "from a warden's lamp". */
  source: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(520),
  /** `relic`: the room it lies in. `remains`: ignored (drops wherever the enemy falls). */
  roomIndex: z.number().int().min(0).max(2),
  /** `remains` only; null for relics. */
  enemyId: EnemyIdSchema.nullable(),
});
export type LoreFragment = z.infer<typeof LoreFragmentSchema>;

/**
 * A world-grown skill: the mechanical effect is one of the registry's closed set (what a
 * future sim pass implements); the name and description are the world speaking.
 */
export const AttunementSchema = z.object({
  effectId: z.enum(ATTUNEMENT_EFFECT_IDS),
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(160),
});
export type Attunement = z.infer<typeof AttunementSchema>;

export const WorldRecipeSchema = z.object({
  title: z.string().trim().min(1).max(40),
  tagline: z.string().trim().min(1).max(80),
  themeSummary: z.string().trim().min(1).max(400),
  motifIds: z.array(MotifIdSchema).min(1).max(4),
  palette: PaletteSchema,
  rooms: z.array(RoomBlueprintSchema).min(1).max(3),
  contributionMappings: z.array(ContributionMappingSchema).max(24),
  lore: z.array(LoreFragmentSchema).max(12),
  /** 2–4 world-specific skill nodes; see `src/shared/skills.ts` for how they join the tree. */
  attunements: z.array(AttunementSchema).max(4).default([]),
});

/**
 * The recipe as stored in a world or fixture: today's model output plus optional floors data.
 * `WorldRecipeSchema` above stays the exact JSON schema of the current model call (strict
 * structured output rejects optional keys), so providers keep using it unchanged. A
 * pipeline that has the model write biome briefs parses with THIS schema instead.
 * When `biomes` is absent the briefs are derived (`deriveBiomeBriefs` in src/shared/floorgen).
 *
 * EXTENSION POINT (agent W2): add the optional world `bible` here, next to `biomes`.
 */
export const FloorsWorldRecipeSchema = WorldRecipeSchema.extend({
  /** Exactly 8 bounded biome briefs: opener, three pairs of choices, finale. Model-facing. */
  biomes: BiomeBriefListSchema.optional(),
});
export type WorldRecipe = z.infer<typeof FloorsWorldRecipeSchema>;

export const ReceiptLineSchema = z.object({
  contributionId: IdString,
  playerId: IdString,
  playerName: z.string().max(24),
  text: ContributionText,
  /** true only when the contribution actually shaped an observable feature. */
  used: z.boolean(),
  featureDescription: z.string().max(200).nullable(),
});
export type ReceiptLine = z.infer<typeof ReceiptLineSchema>;

/** Shown immediately after generation. Honest about fixture vs live. */
export const CreationReceiptSchema = z.object({
  worldTitle: z.string().max(40),
  source: GenerationSourceSchema,
  headline: z.string().max(160),
  lines: z.array(ReceiptLineSchema).max(24),
});
export type CreationReceipt = z.infer<typeof CreationReceiptSchema>;

/**
 * What the client receives and plays. `rooms` holds only COMMITTED rooms (rooms[i].index
 * === i). Later rooms may be appended by a follow-up message while players play, but a
 * committed room is never changed.
 *
 * FLOORS WORLD (`floors` present). Every other room is compiled lazily from `floors` with
 * `createFloorRuntime` and is never sent. For legacy consumers and refinements:
 *  - `rooms` is exactly `[entrance]`: room `r00` of the opening biome (`floors.route.tiers[0][0]`),
 *    byte-identical to `createFloorRuntime(world).getRoom(entranceRef())`.
 *  - `plannedRoomCount` is 1 = "`rooms` is complete, nothing else will stream". It is NOT
 *    the length of the run; use `floors.route.graph.nodes[].roomBudget` for that.
 *  - `rooms[0].isFinal` is false. In floors mode `isFinal` means `feature === 'anchor'`, which
 *    only the exit room of the tier-4 biome has.
 *  - exits carry `toRoomId`; their `toRoomIndex` is the target's floor-plan index, so a legacy
 *    consumer sees a room that "is not committed yet" rather than a crash.
 */
export const PreparedWorldSchema = z
  .object({
    worldId: IdString,
    createdAt: Timestamp,
    recipe: FloorsWorldRecipeSchema,
    art: ArtRecipeSchema,
    rooms: z.array(RoomSpecSchema).min(1).max(3),
    plannedRoomCount: z.number().int().min(1).max(3),
    provenance: GenerationProvenanceSchema,
    receipt: CreationReceiptSchema,
    floors: WorldFloorsSchema.optional(),
  })
  .superRefine((world, ctx) => {
    if (world.floors) {
      refineFloorsWorld(world.floors, world.rooms, world.plannedRoomCount, ctx);
      refineRelicReferences(world, ctx);
      return;
    }
    world.rooms.forEach((room, i) => {
      if (room.roomId !== undefined) ctx.addIssue({ code: 'custom', message: `rooms[${i}] is a floors room but the world has no floors` });
      if (room.index !== i) ctx.addIssue({ code: 'custom', message: `rooms[${i}].index is ${room.index}` });
      for (const exit of room.exits) {
        if (exit.toRoomIndex >= world.plannedRoomCount) {
          ctx.addIssue({ code: 'custom', message: `room ${i} exit targets room ${exit.toRoomIndex} beyond planned count` });
        }
      }
      const finalExpected = i === world.plannedRoomCount - 1;
      if (room.isFinal !== finalExpected) {
        ctx.addIssue({ code: 'custom', message: `room ${i} isFinal=${room.isFinal}, expected ${finalExpected}` });
      }
    });
    if (world.rooms.length > world.plannedRoomCount) {
      ctx.addIssue({ code: 'custom', message: 'more rooms than plannedRoomCount' });
    }
    refineRelicReferences(world, ctx);
  });
export type PreparedWorld = z.infer<typeof PreparedWorldSchema>;

function refineFloorsWorld(floors: z.infer<typeof WorldFloorsSchema>, rooms: RoomSpec[], plannedRoomCount: number, ctx: z.RefinementCtx): void {
  const entrance = rooms[0];
  if (!entrance) return;
  const openerId = floors.route.tiers[0]?.[0];
  if (rooms.length !== 1 || plannedRoomCount !== 1) {
    ctx.addIssue({ code: 'custom', message: 'a floors world carries exactly its entrance room (rooms.length 1, plannedRoomCount 1)' });
  }
  if (entrance.biomeId !== openerId || entrance.roomId !== FLOOR_ENTRANCE_ROOM_ID || entrance.kind !== 'entrance') {
    ctx.addIssue({ code: 'custom', message: `rooms[0] must be the entrance r00 of opening biome ${openerId}` });
  }
  const budget = floors.route.graph.nodes.find((node) => node.biomeId === openerId)?.roomBudget ?? 0;
  for (const exit of entrance.exits) {
    if (exit.toRoomIndex >= budget) ctx.addIssue({ code: 'custom', message: `entrance exit targets ${exit.toRoomId}, beyond the biome's ${budget} rooms` });
  }
}

/** On-disk fixture format (fixtures/worlds/*.json). Provenance/receipt are stamped at runtime. */
export const WorldFixtureSchema = z.object({
  fixtureId: IdString,
  /** Free-text note shown in provenance so nobody mistakes it for live output. */
  fixtureNote: z.string().max(200),
  recipe: FloorsWorldRecipeSchema,
  art: ArtRecipeSchema,
  rooms: z.array(RoomSpecSchema).min(1).max(3),
  plannedRoomCount: z.number().int().min(1).max(3),
}).superRefine(refineRelicReferences);
export type WorldFixture = z.infer<typeof WorldFixtureSchema>;

// ---------------------------------------------------------------------------
// Simulation I/O: intent in, snapshot + events out
// ---------------------------------------------------------------------------

export const PlayerIntentSchema = z.object({
  playerId: IdString,
  /** Client-side monotonically increasing sequence, for remote reconciliation. */
  seq: z.number().int().nonnegative(),
  moveX: z.number().min(-1).max(1),
  moveY: z.number().min(-1).max(1),
  /** Aim point in world coordinates. */
  aimX: z.number(),
  aimY: z.number(),
  attack: z.boolean(),
  dash: z.boolean(),
  /** Pressed ability slot: Q, E (unlockable) or R (ultimate, needs full charge). */
  ability: z.enum(['q', 'e', 'r']).nullable(),
  /** Held every tick, unlike attack/dash/ability presses. */
  interact: z.boolean().optional(),
});
export type PlayerIntent = z.infer<typeof PlayerIntentSchema>;

export const PlayerActionStateSchema = z.enum(['idle', 'moving', 'dashing', 'attacking', 'hit', 'down']);
export type PlayerActionState = z.infer<typeof PlayerActionStateSchema>;

export const PlayerStateSchema = z.object({
  id: IdString,
  displayName: z.string().max(24),
  classId: ClassIdSchema,
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  facing: z.number(),
  hp: z.number(),
  maxHp: z.number().positive(),
  state: PlayerActionStateSchema,
  dashCooldownMs: z.number().nonnegative(),
  attackCooldownMs: z.number().nonnegative(),
  invulnerableMs: z.number().nonnegative(),
  resources: z.number().int().nonnegative().optional(),
  abilityEUnlocked: z.boolean().optional(),
  abilityQCooldownMs: z.number().nonnegative().optional(),
  abilityECooldownMs: z.number().nonnegative().optional(),
  shieldMs: z.number().nonnegative().optional(),
  shroudMs: z.number().nonnegative().optional(),
  rallyMs: z.number().nonnegative().optional(),
  reviveProgress: z.number().min(0).max(1).optional(),
  /** Ultimate charge 0..100; R fires at 100 and resets to 0. */
  ultCharge: z.number().min(0).max(100).optional(),
  /** Short lockout after firing R (prevents double-fire on held keys). */
  abilityRCooldownMs: z.number().nonnegative().optional(),
});
export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const EnemyActionStateSchema = z.enum(['idle', 'chasing', 'attacking', 'hit', 'dead']);

export const EnemyTelegraphSchema = z.object({
  kind: z.enum(['melee', 'beam', 'charge', 'burst', 'volley', 'spread', 'ring', 'homing', 'spiral']),
  x: z.number(),
  y: z.number(),
  facing: z.number(),
  range: z.number().positive(),
  arcRad: z.number().positive(),
  remainingMs: z.number().nonnegative(),
});
export type EnemyTelegraph = z.infer<typeof EnemyTelegraphSchema>;

/** A live bullet-hell projectile: authoritative position, moved and collided in `src/sim`. */
export const ProjectileStateSchema = z.object({
  id: IdString,
  ownerEnemyId: IdString,
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  radius: z.number().positive(),
});
export type ProjectileState = z.infer<typeof ProjectileStateSchema>;

export const EnemyStateSchema = z.object({
  id: IdString,
  enemyId: EnemyIdSchema,
  x: z.number(),
  y: z.number(),
  facing: z.number(),
  hp: z.number(),
  maxHp: z.number().positive(),
  state: EnemyActionStateSchema,
  telegraph: EnemyTelegraphSchema.nullable().optional(),
  slowMs: z.number().nonnegative().optional(),
  stunMs: z.number().nonnegative().optional(),
  markMs: z.number().nonnegative().optional(),
  bossPhase: z.number().int().min(1).max(3).optional(),
  recoveryMs: z.number().nonnegative().optional(),
});
export type EnemyState = z.infer<typeof EnemyStateSchema>;

/**
 * A piece of lore physically present in the room: a relic waiting to be read, or remains
 * an enemy dropped. `progress` is the F-hold while reading a relic.
 */
export const LoreNodeSchema = z.object({
  id: IdString,
  kind: z.enum(['relic', 'remains']),
  x: z.number(),
  y: z.number(),
  fragmentIndex: z.number().int().min(0),
  state: z.enum(['sealed', 'reading', 'collected']),
  progress: z.number().min(0).max(1),
});
export type LoreNode = z.infer<typeof LoreNodeSchema>;

export const AnchorStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  state: z.enum(['dormant', 'planting', 'planted']),
  progress: z.number().min(0).max(1),
  ritual: z.object({
    stage: z.enum(['locked', 'relays', 'core', 'discharging', 'complete']),
    relays: z.array(z.object({ x: z.number(), y: z.number(), activated: z.boolean() })).length(3),
    activeRelay: z.number().int().min(0).max(3),
    pulseRadius: z.number().nonnegative(),
    pulseWarningMs: z.number().nonnegative(),
    dischargeMs: z.number().nonnegative(),
  }).optional(),
});
export type AnchorState = z.infer<typeof AnchorStateSchema>;

/** `training` = the HQ practice range: real enemies that respawn, no run, all abilities unlocked. */
export const GamePhaseSchema = z.enum(['headquarters', 'training', 'expedition', 'debrief']);
export type GamePhase = z.infer<typeof GamePhaseSchema>;

export const GameSnapshotSchema = z.object({
  tick: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
  phase: GamePhaseSchema,
  worldId: IdString.nullable(),
  roomIndex: z.number().int().min(0).nullable(),
  roomId: IdString.nullable(),
  players: z.array(PlayerStateSchema),
  enemies: z.array(EnemyStateSchema),
  projectiles: z.array(ProjectileStateSchema).optional(),
  loreNodes: z.array(LoreNodeSchema).optional(),
  /** Fragment indices discovered so far this run (drives the Codex). */
  discoveredLore: z.array(z.number().int().min(0)).optional(),
  anchor: AnchorStateSchema.nullable(),
  roomCleared: z.boolean().optional(),
  terrain: z.object({
    brokenWalls: z.array(TileKey).max(2048),
    wallDamage: z.record(TileKey, z.number().nonnegative()),
    /**
     * Armed '*' canisters and their fuses (docs/design/TILES.md T1). Sparse and omitted
     * entirely while nothing is lit, so a room without canisters costs nothing to sync.
     */
    canisters: z.record(TileKey, z.object({
      fuseMs: z.number().nonnegative(),
      depth: z.number().int().nonnegative(),
    })).optional(),
  }).optional(),
  /**
   * Floors runs only (absent in HQ, training and legacy worlds): where the crew is in the
   * biome graph, the fog-of-war map, door locks and the pending biome choice. In a floors
   * run `roomId` above is `${biomeId}:${roomId}` and `roomIndex` is the floor-plan index.
   */
  floor: FloorRunStateSchema.optional(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

// ---------------------------------------------------------------------------
// Game events (authoritative, id-deduplicated; source of truth for the Chronicle)
// ---------------------------------------------------------------------------

const eventBase = {
  id: z.string().min(1).max(40),
  tick: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
};

export const GameEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('contribution_submitted'), contributionId: IdString, playerId: IdString }),
  z.object({
    ...eventBase,
    type: z.literal('world_prepared'),
    worldId: IdString,
    worldTitle: z.string().max(40),
    source: GenerationSourceSchema,
    playerIds: z.array(IdString),
  }),
  z.object({
    ...eventBase,
    type: z.literal('room_entered'),
    worldId: IdString,
    roomIndex: z.number().int().min(0),
    roomId: IdString,
    roomName: z.string().max(80),
    playerIds: z.array(IdString),
    /** Floors runs: the room's address and kind (`roomId` above stays the full RoomSpec id). */
    biomeId: IdString.optional(),
    floorRoomId: IdString.optional(),
    kind: RoomKindSchema.optional(),
  }),
  z.object({ ...eventBase, type: z.literal('player_dashed'), playerId: IdString, x: z.number(), y: z.number(), facing: z.number() }),
  z.object({
    ...eventBase,
    type: z.literal('player_attacked'),
    playerId: IdString,
    x: z.number(),
    y: z.number(),
    facing: z.number(),
    range: z.number().positive().optional(),
    arcRad: z.number().positive().optional(),
    hitEnemyIds: z.array(IdString),
  }),
    // byPlayerId is null when the ROOM did it (a hazard, a vent, a canister, a pit). Terrain is
  // neutral and has no attacker; a fabricated kill credit would reach the memory wall.
  z.object({ ...eventBase, type: z.literal('enemy_damaged'), enemyId: IdString, byPlayerId: IdString.nullable(), amount: z.number(), remainingHp: z.number() }),
  z.object({ ...eventBase, type: z.literal('enemy_defeated'), enemyId: IdString, byPlayerId: IdString.nullable() }),
  z.object({ ...eventBase, type: z.literal('player_damaged'), playerId: IdString, amount: z.number(), remainingHp: z.number(), sourceEnemyId: IdString.nullable() }),
  z.object({ ...eventBase, type: z.literal('player_downed'), playerId: IdString }),
  /**
   * The room went off: a '*' canister detonated (docs/design/TILES.md T1). Renderers draw the
   * ring and the shake from this; the damage it caused arrives as ordinary damage events.
   */
  z.object({
    ...eventBase, type: z.literal('terrain_detonated'),
    x: z.number(), y: z.number(), radius: z.number().positive(),
    hitPlayerIds: z.array(IdString), hitEnemyIds: z.array(IdString),
  }),
  z.object({ ...eventBase, type: z.literal('player_revived'), playerId: IdString, byPlayerId: IdString, hp: z.number().positive() }),
  z.object({ ...eventBase, type: z.literal('player_healed'), playerId: IdString, byPlayerId: IdString, amount: z.number().positive(), remainingHp: z.number().positive() }),
  z.object({
    ...eventBase, type: z.literal('ability_used'), playerId: IdString, abilityId: AbilityIdSchema,
    x: z.number(), y: z.number(), facing: z.number(), hitEnemyIds: z.array(IdString),
  }),
  z.object({
    ...eventBase, type: z.literal('ability_unlocked'), playerId: IdString, abilityId: AbilityIdSchema,
    cost: z.number().int().nonnegative(), remainingResources: z.number().int().nonnegative(),
  }),
  z.object({
    ...eventBase, type: z.literal('room_cleared'), worldId: IdString, roomIndex: z.number().int().min(0),
    roomId: IdString, playerIds: z.array(IdString), reward: z.number().int().nonnegative(),
  }),
  z.object({ ...eventBase, type: z.literal('enemy_telegraphed'), enemyId: IdString, telegraph: EnemyTelegraphSchema }),
  z.object({
    ...eventBase, type: z.literal('enemy_attacked'), enemyId: IdString,
    x: z.number(), y: z.number(), facing: z.number(), hitPlayerIds: z.array(IdString),
  }),
  z.object({
    ...eventBase, type: z.literal('lore_discovered'), playerId: IdString,
    fragmentIndex: z.number().int().min(0), kind: z.enum(['relic', 'remains']),
    title: z.string().max(40), source: z.string().max(60), text: z.string().max(520), x: z.number(), y: z.number(),
  }),
  z.object({ ...eventBase, type: z.literal('exit_reached'), playerId: IdString, roomIndex: z.number().int().min(0), toRoomIndex: z.number().int().min(0), toRoomId: IdString.optional() }),
  // Floors runs. `options` are biome ids of PreparedWorld.floors.briefs.
  z.object({ ...eventBase, type: z.literal('biome_choice_offered'), worldId: IdString, fromBiomeId: IdString, options: z.array(IdString).min(1).max(2) }),
  z.object({
    ...eventBase, type: z.literal('biome_entered'), worldId: IdString, biomeId: IdString, biomeName: z.string().max(80),
    tier: z.number().int().min(0).max(4), chosenByPlayerId: IdString.nullable(), playerIds: z.array(IdString),
  }),
  z.object({ ...eventBase, type: z.literal('anchor_planted'), worldId: IdString, roomIndex: z.number().int().min(0), playerIds: z.array(IdString) }),
  z.object({
    ...eventBase,
    type: z.literal('run_ended'),
    worldId: IdString,
    outcome: z.enum(['anchored', 'collapsed', 'aborted']),
    playerIds: z.array(IdString),
  }),
]);
export type GameEvent = z.infer<typeof GameEventSchema>;
export type GameEventType = GameEvent['type'];
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
/** Omit that distributes over a union (plain Omit collapses discriminated unions). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event before the authority stamps id/tick/timeMs. */
export type GameEventInput = DistributiveOmit<GameEvent, 'id' | 'tick' | 'timeMs'>;

// ---------------------------------------------------------------------------
// Memories (Chronicle output). Only ever derived from real events.
// ---------------------------------------------------------------------------

export const MemoryKindSchema = z.enum(['creation_receipt', 'arrival_keepsake', 'milestone', 'anchor', 'run_summary', 'lore']);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const MemoryRecordSchema = z.object({
  id: IdString,
  kind: MemoryKindSchema,
  worldId: IdString,
  worldTitle: z.string().max(40),
  roomIndex: z.number().int().min(0).nullable(),
  createdAt: Timestamp,
  participants: z.array(z.object({ id: IdString, displayName: z.string().max(24) })).min(1),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(400),
  /** Event ids this memory was derived from — proof it came from real play. */
  sourceEventIds: z.array(z.string().max(40)).min(1),
  provenanceSource: GenerationSourceSchema,
  /** Browser adapter may attach a small captured thumbnail. Never a remote URL. */
  thumbnailDataUrl: z.string().startsWith('data:image/').max(200_000).optional(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export const MemoryRecordListSchema = z.array(MemoryRecordSchema);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
}
