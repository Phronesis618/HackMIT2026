/**
 * Terrain: the pure tile maths both the simulation and the renderer read.
 *
 * Owner: Agent T1 (docs/design/TILES.md). Nothing here holds state or randomness — a tile's
 * behaviour is a function of the room, the sparse `TerrainState` and (for vents) sim time, so
 * host and client always agree.
 */
import type { RoomSpec } from './contracts';
import { worldToTile } from './conventions';
import { TILE_CHARS, type TileChar } from './registry';

export interface TerrainState {
  /** Tiles destroyed into rubble this run: broken 'B' bulkheads, spent '*' canisters, shattered '-' cover. */
  brokenWalls: string[];
  /** Accumulated damage on a 'B' bulkhead, keyed "col,row". */
  wallDamage: Record<string, number>;
}

export function terrainTileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Tiles that leave rubble behind when they are destroyed. */
const DESTRUCTIBLE = new Set<string>(['B']);

export function terrainTileAt(
  room: RoomSpec,
  col: number,
  row: number,
  brokenWalls: readonly string[] = [],
): TileChar {
  const tile = room.tiles[row]?.[col];
  if (tile !== undefined && DESTRUCTIBLE.has(tile) && brokenWalls.includes(terrainTileKey(col, row))) return ':';
  return TILE_CHARS.find((candidate) => candidate === tile) ?? ' ';
}

export function terrainSpeedMultiplier(
  room: RoomSpec,
  x: number,
  y: number,
  brokenWalls: readonly string[] = [],
): number {
  const { col, row } = worldToTile(x, y);
  const tile = terrainTileAt(room, col, row, brokenWalls);
  return tile === ':' ? 0.65 : tile === '+' ? 1.25 : 1;
}

// ---------------------------------------------------------------------------
// Damage neutrality (TILES.md R1 and its "needs a human call")
// ---------------------------------------------------------------------------

/**
 * THE demo-safety dial. Terrain is neutral — it damages enemies on the same terms as the
 * crew (R1) — but a judge watching a five-minute demo should not see an operative burn to
 * death on a floor they misread. Tiles therefore deal full damage to enemies and this
 * fraction to players. One constant, one place to change it.
 *
 * It scales the shared tile-damage numbers (`~` hazard floor, `^` vents). It deliberately
 * does NOT scale canisters, whose asymmetry is already explicit (48 enemy / 26 player), nor
 * the fixed 12 of a pit fall, which can never be lethal anyway.
 */
export const TERRAIN_PLAYER_DAMAGE_SCALE = 0.5;

/** Elites and bosses take half from floor hazards, so nobody can simply park one in a fire. */
export const TERRAIN_ELITE_DAMAGE_SCALE = 0.5;

/** Enemies that resist floor hazards. Gatekeepers are one-phase guardians in the sim. */
export function isEliteEnemy(enemyId: string): boolean {
  return enemyId === 'guardian';
}

/** Terrain damage is attributed with these ids, not with an enemy id. */
export const TERRAIN_DAMAGE_SOURCE = {
  hazard: 'terrain:hazard',
  vent: 'terrain:vent',
  canister: 'terrain:canister',
  pit: 'terrain:pit',
} as const;
export type TerrainDamageSource = (typeof TERRAIN_DAMAGE_SOURCE)[keyof typeof TERRAIN_DAMAGE_SOURCE];

const TERRAIN_SOURCE_IDS = new Set<string>(Object.values(TERRAIN_DAMAGE_SOURCE));
/** Floors tier scaling multiplies enemy damage; the room itself is not an enemy. */
export function isTerrainDamageSource(sourceId: string): boolean {
  return TERRAIN_SOURCE_IDS.has(sourceId);
}

// ---------------------------------------------------------------------------
// Baseline numbers (TILES.md §2, quoted at intensity = 0.5)
// ---------------------------------------------------------------------------

/** `~`: one damage tick per this many ms of standing. */
export const HAZARD_INTERVAL_MS = 600;
export const HAZARD_DAMAGE = 8;

/** `^`: the vent cycle. Stateless — see `ventState`. */
export const VENT_CYCLE_MS = 3000;
export const VENT_DAMAGE = 14;
export const VENT_GROUPS = 3;
/** Charging is visible and audible before anything fires (R3: no off-screen kills). */
export const VENT_TELL_MS = 500;
export const VENT_FIRE_MS = 300;

/** `*`: volatile canister. */
export const CANISTER_FUSE_MS = 420;
export const CANISTER_RADIUS = 76;
export const CANISTER_ENEMY_DAMAGE = 48;
export const CANISTER_PLAYER_DAMAGE = 26;
export const CANISTER_WALL_DAMAGE = 40;
export const CANISTER_KNOCKBACK = 120;
/** Damage at the rim, as a fraction of the centre value; linear in between. */
export const CANISTER_RIM_FALLOFF = 0.35;
/** A canister caught in a blast lights this short fuse instead of its full one. */
export const CANISTER_CHAIN_FUSE_MS = 140;
/** A pathological cluster cannot detonate forever. */
export const CANISTER_MAX_CHAIN_DEPTH = 6;

/** `o`: a dash that ends over a pit costs this much and relocates you. Never lethal. */
export const PIT_FALL_DAMAGE = 12;
/** Grace after being fished out of a pit. */
export const PIT_RECOVERY_INVULNERABLE_MS = 800;

/** `-`: low cover. Shared damage pool per tile, like a bulkhead's. */
export const COVER_HP = 24;

// ---------------------------------------------------------------------------
// intensity (TILES.md §4.2) — the model picks one number, trusted code decides what it means
// ---------------------------------------------------------------------------

export interface TerrainTuning {
  hazardIntervalMs: number;
  hazardDamage: number;
  ventCycleMs: number;
  ventDamage: number;
  canisterFuseMs: number;
  coverHp: number;
}

export const DEFAULT_TERRAIN_INTENSITY = 0.5;

/**
 * Interpolate inside a hard-clamped band. `intensity` 0 is the gentlest legal value and 1 the
 * harshest; 0.5 is exactly the baseline constant above, so the two tables in TILES.md (§2's
 * "numbers at intensity 0.5" and §4.2's endpoints) agree by construction rather than by luck.
 */
function band(gentle: number, mid: number, harsh: number, intensity: number): number {
  const i = Math.min(1, Math.max(0, Number.isFinite(intensity) ? intensity : DEFAULT_TERRAIN_INTENSITY));
  return Math.round(i <= 0.5 ? gentle + (mid - gentle) * (i / 0.5) : mid + (harsh - mid) * ((i - 0.5) / 0.5));
}

/**
 * Nothing outside this table scales. `CANISTER_PLAYER_DAMAGE`, `PIT_FALL_DAMAGE` and the
 * knockback numbers are fixed, because a world that can make its own canisters lethal is a
 * world that can generate an unwinnable room.
 */
export function terrainTuning(intensity: number = DEFAULT_TERRAIN_INTENSITY): TerrainTuning {
  return {
    hazardIntervalMs: band(800, HAZARD_INTERVAL_MS, 450, intensity),
    hazardDamage: band(6, HAZARD_DAMAGE, 11, intensity),
    ventCycleMs: band(4000, VENT_CYCLE_MS, 2400, intensity),
    ventDamage: band(10, VENT_DAMAGE, 18, intensity),
    canisterFuseMs: band(600, CANISTER_FUSE_MS, 300, intensity),
    coverHp: band(34, COVER_HP, 18, intensity),
  };
}

/** The tuning a room was compiled with. Rooms without the field use the baseline. */
export function roomTerrainTuning(room: Pick<RoomSpec, 'terrainIntensity'>): TerrainTuning {
  return terrainTuning(room.terrainIntensity ?? DEFAULT_TERRAIN_INTENSITY);
}

// ---------------------------------------------------------------------------
// '^' timed vent — a pure function of sim time and tile coordinates
// ---------------------------------------------------------------------------

export type VentState = 'idle' | 'charging' | 'firing';

/**
 * Three phase groups, so a vent field is never all-on: there is always a safe third of it and
 * crossing one is a rhythm problem rather than a dice roll.
 */
export function ventPhaseOffset(col: number, row: number, cycleMs: number = VENT_CYCLE_MS): number {
  const group = (((col * 5 + row * 3) % VENT_GROUPS) + VENT_GROUPS) % VENT_GROUPS;
  return (group * cycleMs) / VENT_GROUPS;
}

export function ventState(timeMs: number, col: number, row: number, cycleMs: number = VENT_CYCLE_MS): VentState {
  const t = ((timeMs + ventPhaseOffset(col, row, cycleMs)) % cycleMs + cycleMs) % cycleMs;
  if (t < cycleMs - VENT_TELL_MS - VENT_FIRE_MS) return 'idle';
  return t < cycleMs - VENT_FIRE_MS ? 'charging' : 'firing';
}

/** 0 at the start of the tell, 1 the instant it fires. Renderer-facing. */
export function ventChargeProgress(timeMs: number, col: number, row: number, cycleMs: number = VENT_CYCLE_MS): number {
  const t = ((timeMs + ventPhaseOffset(col, row, cycleMs)) % cycleMs + cycleMs) % cycleMs;
  const start = cycleMs - VENT_TELL_MS - VENT_FIRE_MS;
  return Math.min(1, Math.max(0, (t - start) / VENT_TELL_MS));
}

/**
 * Which firing window a tile is in. An entity remembers the last window that hit it, so a vent
 * lands once per burst however many ticks the burst lasts — and it is derived from sim time,
 * so it costs nothing in the snapshot and cannot desync.
 */
export function ventWindowId(timeMs: number, col: number, row: number, cycleMs: number = VENT_CYCLE_MS): number {
  const shifted = timeMs + ventPhaseOffset(col, row, cycleMs);
  return Math.floor(shifted / cycleMs) * VENT_GROUPS + (((col * 5 + row * 3) % VENT_GROUPS) + VENT_GROUPS) % VENT_GROUPS;
}
