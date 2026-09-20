/**
 * Terrain: the pure tile maths both the simulation and the renderer read.
 *
 * Owner: Agent T1 (docs/design/TILES.md). Nothing here holds state or randomness — a tile's
 * behaviour is a function of the room, the sparse `TerrainState` and (for vents) sim time, so
 * host and client always agree.
 */
import type { RoomSpec } from './contracts';
import { worldToTile } from './conventions';
import { DANGEROUS_TILES, PROP_INFO, TILE_CHARS, type TileChar } from './registry';
import { DEMO_TUNING } from '../sim/tuning';

/** An armed canister, counting down to its blast. Sparse: only armed tiles have an entry. */
export interface CanisterState {
  fuseMs: number;
  /** How deep in a chain it is; the 6th link does not light a 7th. */
  depth: number;
}

export interface TerrainState {
  /** Tiles destroyed into rubble this run: broken 'B' bulkheads, spent '*' canisters, shattered '-' cover. */
  brokenWalls: string[];
  /** Accumulated damage on a 'B' bulkhead, keyed "col,row". */
  wallDamage: Record<string, number>;
  /** Armed '*' canisters, keyed "col,row". Absent is the same as empty (snapshots omit it). */
  canisters?: Record<string, CanisterState>;
  /** Damage taken by each '-' cover tile, keyed "col,row". Same shape as wallDamage. */
  coverDamage?: Record<string, number>;
}

export function terrainTileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Tiles that leave rubble behind when they are destroyed. */
const DESTRUCTIBLE = new Set<string>(['B', '*', '-']);

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
 * Hazard floor is neutral but weighted toward the crew: an enemy standing in fire takes this
 * much more than a player would (TILES.md T0). One named constant, one place to change it.
 */
export const ENEMY_HAZARD_MUL = DEMO_TUNING.enemyHazardMul;

/** Elites and bosses take half the enemy value, so nobody can simply park one in a puddle. */
export const TERRAIN_ELITE_DAMAGE_SCALE = 0.5;

/**
 * What an environmental kill is worth, against an earned one (TILES.md §1.1). Gungeon pays
 * fewer shells for trap kills and Spelunky scores none at all; half keeps the room attractive
 * to aim without making terrain strictly better than fighting. Applies to ult charge and to
 * the per-enemy share of the room-clear reward.
 */
export const ENV_KILL_CREDIT = DEMO_TUNING.envKillCredit;

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

/**
 * `~`: one damage tick per this many ms of standing, and the tick RAMPS — 3, 6, 9, 12, 15, 15…
 * Asphodel's magma is the model: crossing is cheap, standing is fatal, and stepping off or
 * dashing resets the stack to nothing. A flat tick would punish exactly the traversal we want
 * players to attempt.
 */
export const HAZARD_INTERVAL_MS = DEMO_TUNING.hazardIntervalMs;
export const HAZARD_BASE = DEMO_TUNING.hazardBase;
export const HAZARD_STACK_MAX = DEMO_TUNING.hazardStackMax;

/** `^`: the vent cycle. Stateless — see `ventState`. */
export const VENT_CYCLE_MS = 3000;
export const VENT_DAMAGE = 14;
export const VENT_GROUPS = 3;
/** Charging is visible and audible before anything fires (R3: no off-screen kills). */
export const VENT_TELL_MS = 500;
export const VENT_FIRE_MS = 300;

/** `*`: volatile canister. One point of damage from any source arms it. */
export const CANISTER_HP = 1;
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
  hazardBase: number;
  hazardStackMax: number;
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
    hazardIntervalMs: band(600, HAZARD_INTERVAL_MS, 350, intensity),
    hazardBase: band(2, HAZARD_BASE, 4, intensity),
    hazardStackMax: band(4, HAZARD_STACK_MAX, 6, intensity),
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

// ---------------------------------------------------------------------------
// The reachability contract (TILES.md §5)
// ---------------------------------------------------------------------------

/** Everything a crew must be able to reach, and reach each other from. */
interface KeyPoint { label: string; x: number; y: number }

/** Solid for S1/S3: the tiles a player who refuses to touch anything cannot pass. */
const SAFETY_SOLID = new Set(['#', ' ', 'B', '*', 'o', 'S']);
/** Additionally blocked for S2: the damaging tiles a hazard-free route must avoid. */
const SAFETY_HAZARD = new Set(['~', '^', '%', ',']);

function keyPointsOf(room: RoomSpec): KeyPoint[] {
  const points: KeyPoint[] = [];
  room.tiles.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      if (line[x] === 'P') points.push({ label: 'spawn', x, y });
      if (line[x] === 'A') points.push({ label: 'anchor', x, y });
    }
  });
  // A door's `entry` is the walkable tile just inside it; legacy rooms use the 'X' itself.
  for (const exit of room.exits) points.push({ label: `door ${exit.x},${exit.y}`, ...(exit.entry ?? { x: exit.x, y: exit.y }) });
  if (room.focus) points.push({ label: 'focus', ...room.focus });
  for (const relic of room.relics) points.push({ label: `relic ${relic.id}`, x: relic.x, y: relic.y });
  for (const encounter of room.encounters) points.push({ label: `encounter ${encounter.id}`, x: encounter.x, y: encounter.y });
  for (const relay of room.anchorRelays ?? []) points.push({ label: 'relay', x: relay.x, y: relay.y });
  return points;
}

function blockingPropTiles(room: RoomSpec): Set<string> {
  const blocked = new Set<string>();
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    if (!info.blocksMovement) continue;
    for (let dy = 0; dy < info.footprint.h; dy++) {
      for (let dx = 0; dx < info.footprint.w; dx++) blocked.add(terrainTileKey(prop.x + dx, prop.y + dy));
    }
  }
  return blocked;
}

/** 4-way flood over tiles `open` accepts, never entering a blocked prop footprint. */
function floodRoom(
  tiles: readonly string[], from: KeyPoint, open: (ch: string) => boolean, blocked: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>([terrainTileKey(from.x, from.y)]);
  const stack: Array<{ x: number; y: number }> = [from];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = at.x + dx;
      const y = at.y + dy;
      const ch = tiles[y]?.[x];
      const id = terrainTileKey(x, y);
      if (ch === undefined || seen.has(id) || blocked.has(id) || !open(ch)) continue;
      seen.add(id);
      stack.push({ x, y });
    }
  }
  return seen;
}

/** Connected groups (4-way) of one tile character. Used for the per-room count rules. */
function tileGroups(tiles: readonly string[], ch: string): Array<Array<{ x: number; y: number }>> {
  const seen = new Set<string>();
  const groups: Array<Array<{ x: number; y: number }>> = [];
  tiles.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      if (line[x] !== ch || seen.has(terrainTileKey(x, y))) continue;
      const group: Array<{ x: number; y: number }> = [];
      const stack = [{ x, y }];
      seen.add(terrainTileKey(x, y));
      while (stack.length > 0) {
        const at = stack.pop()!;
        group.push(at);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = at.x + dx;
          const ny = at.y + dy;
          const id = terrainTileKey(nx, ny);
          if (tiles[ny]?.[nx] !== ch || seen.has(id)) continue;
          seen.add(id);
          stack.push({ x: nx, y: ny });
        }
      }
      groups.push(group);
    }
  });
  return groups;
}

/** Per-room count limits from TILES.md S8, for the tiles that exist today. */
const TILE_GROUP_LIMITS: Array<{ ch: string; name: string; maxGroups: number; min: number; max: number }> = [
  { ch: 'o', name: 'pit blobs', maxGroups: 2, min: 2, max: 6 },
  { ch: '^', name: 'vent fields', maxGroups: 2, min: 4, max: 9 },
  { ch: '-', name: 'cover runs', maxGroups: 3, min: 2, max: 4 },
];

/**
 * The generator's contract, as a list of what a room got wrong. Empty = safe to ship.
 *
 * Terrain is an additive layer over a floor plan that was already guaranteed connected, so the
 * only thing that can go wrong is a tile that subtracts connectivity or sits where a player has
 * to stand. S1 re-checks the guarantee with every blocking tile solid, S2 asks for a route that
 * never touches a damaging tile, S4 keeps hazards away from the places a player must be, and S8
 * bounds how much of any one thing a room may contain.
 */
export function validateRoomSafety(room: RoomSpec): string[] {
  const problems: string[] = [];
  const points = keyPointsOf(room);
  const blocked = blockingPropTiles(room);
  const start = points[0];
  if (!start) return ['room has no spawn or door to check'];

  const safe = floodRoom(room.tiles, start, (ch) => !SAFETY_SOLID.has(ch), blocked);
  for (const point of points) {
    if (!safe.has(terrainTileKey(point.x, point.y))) {
      problems.push(`S1: ${point.label} at ${point.x},${point.y} is unreachable when every blocking tile is solid`);
    }
  }
  const dry = floodRoom(room.tiles, start, (ch) => !SAFETY_SOLID.has(ch) && !SAFETY_HAZARD.has(ch), blocked);
  for (const point of points) {
    if (!dry.has(terrainTileKey(point.x, point.y))) {
      problems.push(`S2: ${point.label} at ${point.x},${point.y} has no hazard-free route`);
    }
  }
  // S4: nothing that damages or deletes may sit where a player has to stand or arrive.
  const mustBeClean = points.filter((p) => !p.label.startsWith('encounter') && !p.label.startsWith('relic'));
  room.tiles.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      if (!DANGEROUS_TILES.has(line[x]!)) continue;
      for (const point of mustBeClean) {
        if (Math.max(Math.abs(point.x - x), Math.abs(point.y - y)) <= 2) {
          problems.push(`S4: '${line[x]}' at ${x},${y} is within 2 tiles of ${point.label}`);
        }
      }
    }
  });
  // S8: per-room counts.
  const canisters = room.tiles.flatMap((line, y) => [...line].flatMap((ch, x) => ch === '*' ? [{ x, y }] : []));
  if (canisters.length > 3) problems.push(`S8: ${canisters.length} canisters, max 3`);
  for (const a of canisters) {
    for (const b of canisters) {
      if (a !== b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) {
        problems.push(`S8: canisters at ${a.x},${a.y} and ${b.x},${b.y} are orthogonally adjacent`);
      }
    }
  }
  for (const limit of TILE_GROUP_LIMITS) {
    const groups = tileGroups(room.tiles, limit.ch);
    if (groups.length > limit.maxGroups) problems.push(`S8: ${groups.length} ${limit.name}, max ${limit.maxGroups}`);
    for (const group of groups) {
      if (group.length < limit.min || group.length > limit.max) {
        problems.push(`S8: ${limit.name} of ${group.length} tiles at ${group[0]!.x},${group[0]!.y}, allowed ${limit.min}..${limit.max}`);
      }
    }
  }
  return [...new Set(problems)];
}
