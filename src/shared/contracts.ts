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
  CLASS_IDS,
  ENEMY_IDS,
  MOTIF_IDS,
  PROP_IDS,
  TILE_CHARS,
} from './registry';

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
});
export type RoomEncounter = z.infer<typeof RoomEncounterSchema>;

export const RoomExitSchema = z.object({
  x: TileCoord,
  y: TileCoord,
  toRoomIndex: z.number().int().min(0).max(2),
  direction: z.enum(['north', 'south', 'east', 'west']),
});
export type RoomExit = z.infer<typeof RoomExitSchema>;

const tileCharSet = new Set<string>(TILE_CHARS);

export const RoomSpecSchema = z
  .object({
    id: IdString,
    index: z.number().int().min(0).max(2),
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
  })
  .superRefine((room, ctx) => {
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
      return ch !== undefined && ch !== '#' && ch !== ' ';
    };
    for (const p of room.props) {
      if (!inBounds(p.x, p.y)) ctx.addIssue({ code: 'custom', message: `prop ${p.id} out of bounds` });
      else if (!walkable(p.x, p.y)) ctx.addIssue({ code: 'custom', message: `prop ${p.id} is placed on a wall/void tile` });
    }
    for (const e of room.encounters) {
      if (!inBounds(e.x, e.y)) ctx.addIssue({ code: 'custom', message: `encounter ${e.id} out of bounds` });
      else if (!walkable(e.x, e.y)) ctx.addIssue({ code: 'custom', message: `encounter ${e.id} is placed on a wall/void tile` });
    }
  });
export type RoomSpec = z.infer<typeof RoomSpecSchema>;

// ---------------------------------------------------------------------------
// World recipe (model-facing structured output) and prepared world (client-facing)
// ---------------------------------------------------------------------------

export const RoomBlueprintSchema = z.object({
  name: ShortText,
  description: z.string().trim().max(300),
  motifIds: z.array(MotifIdSchema).min(1).max(3),
  propIds: z.array(PropIdSchema).max(6),
  enemyIds: z.array(EnemyIdSchema).max(3),
  hazards: z.boolean(),
});
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
export const WorldRecipeSchema = z.object({
  title: z.string().trim().min(1).max(40),
  tagline: z.string().trim().min(1).max(80),
  themeSummary: z.string().trim().min(1).max(400),
  motifIds: z.array(MotifIdSchema).min(1).max(4),
  palette: PaletteSchema,
  rooms: z.array(RoomBlueprintSchema).min(1).max(3),
  contributionMappings: z.array(ContributionMappingSchema).max(24),
});
export type WorldRecipe = z.infer<typeof WorldRecipeSchema>;

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
 */
export const PreparedWorldSchema = z
  .object({
    worldId: IdString,
    createdAt: Timestamp,
    recipe: WorldRecipeSchema,
    art: ArtRecipeSchema,
    rooms: z.array(RoomSpecSchema).min(1).max(3),
    plannedRoomCount: z.number().int().min(1).max(3),
    provenance: GenerationProvenanceSchema,
    receipt: CreationReceiptSchema,
  })
  .superRefine((world, ctx) => {
    world.rooms.forEach((room, i) => {
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
  });
export type PreparedWorld = z.infer<typeof PreparedWorldSchema>;

/** On-disk fixture format (fixtures/worlds/*.json). Provenance/receipt are stamped at runtime. */
export const WorldFixtureSchema = z.object({
  fixtureId: IdString,
  /** Free-text note shown in provenance so nobody mistakes it for live output. */
  fixtureNote: z.string().max(200),
  recipe: WorldRecipeSchema,
  art: ArtRecipeSchema,
  rooms: z.array(RoomSpecSchema).min(1).max(3),
  plannedRoomCount: z.number().int().min(1).max(3),
});
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
  ability: z.enum(['q', 'e']).nullable(),
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
});
export type EnemyState = z.infer<typeof EnemyStateSchema>;

export const AnchorStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  state: z.enum(['dormant', 'planting', 'planted']),
  progress: z.number().min(0).max(1),
});
export type AnchorState = z.infer<typeof AnchorStateSchema>;

export const GamePhaseSchema = z.enum(['headquarters', 'expedition', 'debrief']);
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
  anchor: AnchorStateSchema.nullable(),
  roomCleared: z.boolean().optional(),
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
  z.object({ ...eventBase, type: z.literal('enemy_damaged'), enemyId: IdString, byPlayerId: IdString, amount: z.number(), remainingHp: z.number() }),
  z.object({ ...eventBase, type: z.literal('enemy_defeated'), enemyId: IdString, byPlayerId: IdString }),
  z.object({ ...eventBase, type: z.literal('player_damaged'), playerId: IdString, amount: z.number(), remainingHp: z.number(), sourceEnemyId: IdString.nullable() }),
  z.object({ ...eventBase, type: z.literal('player_downed'), playerId: IdString }),
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
  z.object({ ...eventBase, type: z.literal('exit_reached'), playerId: IdString, roomIndex: z.number().int().min(0), toRoomIndex: z.number().int().min(0) }),
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

export const MemoryKindSchema = z.enum(['creation_receipt', 'arrival_keepsake', 'milestone', 'anchor', 'run_summary']);
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
