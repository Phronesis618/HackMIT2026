/**
 * Terrain the crew can attack: 'B' bulkheads and '*' volatile canisters.
 *
 * Owner: Agent T1. Pure — these functions take a room and a `TerrainState` and hand back a new
 * one. The simulation owns entities; everything here is about tiles, so the blast's effect on
 * players and enemies is resolved by the caller from `CanisterBlast`.
 */
import type { RoomSpec } from '../shared/contracts';
import { TICK_MS, TILE_SIZE, tileToWorld } from '../shared/conventions';
import { BREAKABLE_WALL_HP } from '../shared/registry';
import {
  CANISTER_CHAIN_FUSE_MS, CANISTER_MAX_CHAIN_DEPTH, CANISTER_RADIUS, CANISTER_RIM_FALLOFF,
  CANISTER_WALL_DAMAGE, terrainTileAt, terrainTileKey, type TerrainState,
} from '../shared/terrain';
import { isSolidAt, type SolidGrid } from './collision';
import { inArc } from './combat';

export interface TerrainHit {
  x: number;
  y: number;
  hp: number;
  destroyed: boolean;
}

export interface TerrainAttack {
  x: number;
  y: number;
  facing: number;
  range: number;
  arc: number;
  damage: number;
}

export interface TerrainDamageResult {
  state: TerrainState;
  hits: TerrainHit[];
  /** Canisters this attack armed, if any: the renderer wants the fuse, the sim wants nothing. */
  armed: TileRef[];
}

export interface TileRef {
  col: number;
  row: number;
}

export function createTerrainState(): TerrainState {
  return { brokenWalls: [], wallDamage: {}, canisters: {}, coverDamage: {} };
}

/**
 * '-' low cover takes the damage of whatever stopped against it and shatters into rubble at
 * `maxHp` (TILES.md T4). One shared pool per tile, exactly like a bulkhead's.
 */
export function damageCover(
  room: RoomSpec,
  state: TerrainState,
  col: number,
  row: number,
  damage: number,
  maxHp: number,
): TerrainDamageResult {
  if (!Number.isFinite(damage) || damage <= 0 || terrainTileAt(room, col, row, state.brokenWalls) !== '-') {
    return { state, hits: [], armed: [] };
  }
  const key = terrainTileKey(col, row);
  const total = Math.min(maxHp, (state.coverDamage?.[key] ?? 0) + damage);
  const hp = maxHp - total;
  return {
    state: {
      ...state,
      brokenWalls: hp <= 0 ? [...state.brokenWalls, key] : [...state.brokenWalls],
      coverDamage: { ...state.coverDamage, [key]: total },
    },
    hits: [{ x: col, y: row, hp, destroyed: hp <= 0 }],
    armed: [],
  };
}

/** Whatever cover a circle overlaps takes the hit. Used by bolts and by blasts. */
export function damageCoverInCircle(
  room: RoomSpec,
  state: TerrainState,
  x: number,
  y: number,
  radius: number,
  damage: number,
  maxHp: number,
): TerrainDamageResult {
  let next = state;
  const hits: TerrainHit[] = [];
  for (const { col, row } of tilesInCircle(room, x, y, radius)) {
    const result = damageCover(room, next, col, row, damage, maxHp);
    next = result.state;
    hits.push(...result.hits);
  }
  return { state: next, hits, armed: [] };
}

export function damageBreakableWall(
  room: RoomSpec,
  state: TerrainState,
  col: number,
  row: number,
  damage: number,
): TerrainDamageResult {
  if (!Number.isFinite(damage) || damage <= 0 || terrainTileAt(room, col, row, state.brokenWalls) !== 'B') {
    return { state, hits: [], armed: [] };
  }
  const key = terrainTileKey(col, row);
  const totalDamage = Math.min(BREAKABLE_WALL_HP, (state.wallDamage[key] ?? 0) + damage);
  const hp = BREAKABLE_WALL_HP - totalDamage;
  return {
    state: {
      ...state,
      brokenWalls: hp === 0 ? [...state.brokenWalls, key] : [...state.brokenWalls],
      wallDamage: { ...state.wallDamage, [key]: totalDamage },
    },
    hits: [{ x: col, y: row, hp, destroyed: hp === 0 }],
    armed: [],
  };
}

/**
 * One swing resolved against the tiles in its arc: bulkheads take damage, canisters are armed.
 * `CANISTER_HP` is 1, so any attack that reaches a canister lights its fuse — the decision is
 * whether to aim at it, never how hard to hit it.
 */
export function strikeTerrain(
  room: RoomSpec,
  grid: SolidGrid,
  state: TerrainState,
  attack: TerrainAttack,
  fuseMs: number,
): TerrainDamageResult {
  if (![attack.x, attack.y, attack.facing, attack.range, attack.arc, attack.damage].every(Number.isFinite) ||
      attack.range < 0 || attack.arc < 0 || attack.damage <= 0) return { state, hits: [], armed: [] };
  let next = state;
  const hits: TerrainHit[] = [];
  const armed: TileRef[] = [];
  for (let row = 0; row < room.height; row++) {
    for (let col = 0; col < room.width; col++) {
      const tile = terrainTileAt(room, col, row, state.brokenWalls);
      if (tile !== 'B' && tile !== '*') continue;
      const center = tileToWorld(col, row);
      if (!inArc(attack, center, attack.facing, attack.range, attack.arc, TILE_SIZE / 2)) continue;
      if (!wallVisible(grid, attack, col, row)) continue;
      if (tile === 'B') {
        const result = damageBreakableWall(room, next, col, row, attack.damage);
        next = result.state;
        hits.push(...result.hits);
      } else {
        const result = armCanister(room, next, col, row, fuseMs, 0);
        next = result.state;
        armed.push(...result.armed);
      }
    }
  }
  return { state: next, hits, armed };
}

/** Kept for callers that only care about bulkheads (tests, tools). */
export function strikeBreakableWalls(
  room: RoomSpec,
  grid: SolidGrid,
  state: TerrainState,
  attack: TerrainAttack,
): TerrainDamageResult {
  return strikeTerrain(room, grid, state, attack, 0);
}

function wallVisible(grid: SolidGrid, from: TerrainAttack, col: number, row: number): boolean {
  const target = tileToWorld(col, row);
  const steps = Math.max(1, Math.ceil(Math.hypot(target.x - from.x, target.y - from.y) / 4));
  for (let i = 0; i <= steps; i++) {
    const x = Math.floor((from.x + (target.x - from.x) * i / steps) / TILE_SIZE);
    const y = Math.floor((from.y + (target.y - from.y) * i / steps) / TILE_SIZE);
    if (x === col && y === row) return true;
    if (isSolidAt(grid, x, y)) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// '*' volatile canisters (docs/design/TILES.md T1)
// ---------------------------------------------------------------------------

/** Light one canister's fuse. Already-armed canisters keep the shorter of the two fuses. */
export function armCanister(
  room: RoomSpec,
  state: TerrainState,
  col: number,
  row: number,
  fuseMs: number,
  depth: number,
): TerrainDamageResult {
  if (terrainTileAt(room, col, row, state.brokenWalls) !== '*') return { state, hits: [], armed: [] };
  const key = terrainTileKey(col, row);
  const existing = state.canisters?.[key];
  const fuse = Math.max(TICK_MS, fuseMs);
  if (existing && existing.fuseMs <= fuse) return { state, hits: [], armed: [] };
  return {
    state: { ...state, canisters: { ...state.canisters, [key]: { fuseMs: fuse, depth } } },
    hits: [],
    armed: [{ col, row }],
  };
}

/** Arm every canister a circle touches. Used by blasts, bolts and area abilities alike. */
export function armCanistersInCircle(
  room: RoomSpec,
  state: TerrainState,
  x: number,
  y: number,
  radius: number,
  fuseMs: number,
  depth = 0,
): TerrainDamageResult {
  let next = state;
  const armed: TileRef[] = [];
  for (const { col, row } of tilesInCircle(room, x, y, radius)) {
    if (terrainTileAt(room, col, row, next.brokenWalls) !== '*') continue;
    const result = armCanister(room, next, col, row, fuseMs, depth);
    next = result.state;
    armed.push(...result.armed);
  }
  return { state: next, hits: [], armed };
}

function tilesInCircle(room: RoomSpec, x: number, y: number, radius: number): TileRef[] {
  const out: TileRef[] = [];
  const minCol = Math.max(0, Math.floor((x - radius) / TILE_SIZE));
  const maxCol = Math.min(room.width - 1, Math.floor((x + radius) / TILE_SIZE));
  const minRow = Math.max(0, Math.floor((y - radius) / TILE_SIZE));
  const maxRow = Math.min(room.height - 1, Math.floor((y + radius) / TILE_SIZE));
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const tx = Math.max(col * TILE_SIZE, Math.min(x, (col + 1) * TILE_SIZE));
      const ty = Math.max(row * TILE_SIZE, Math.min(y, (row + 1) * TILE_SIZE));
      if ((x - tx) ** 2 + (y - ty) ** 2 <= radius * radius) out.push({ col, row });
    }
  }
  return out;
}

export interface CanisterBlast extends TileRef {
  /** Blast centre in world units. */
  x: number;
  y: number;
  depth: number;
}

/**
 * Burn one tick off every fuse and return the canisters that go off. Deterministic order: the
 * sparse record is walked in sorted key order, never in insertion order, so two simulations fed
 * the same inputs detonate the same canisters in the same sequence.
 */
export function stepCanisterFuses(state: TerrainState, dtMs = TICK_MS): { state: TerrainState; blasts: CanisterBlast[] } {
  const keys = Object.keys(state.canisters ?? {});
  if (keys.length === 0) return { state, blasts: [] };
  const canisters: Record<string, { fuseMs: number; depth: number }> = {};
  const blasts: CanisterBlast[] = [];
  for (const key of keys.sort()) {
    const canister = state.canisters![key]!;
    const fuseMs = canister.fuseMs - dtMs;
    const [col, row] = key.split(',').map(Number) as [number, number];
    if (fuseMs > 1e-7) canisters[key] = { fuseMs, depth: canister.depth };
    else blasts.push({ col, row, ...tileToWorld(col, row), depth: canister.depth });
  }
  return { state: { ...state, canisters }, blasts };
}

/** 1.0 at the centre, `CANISTER_RIM_FALLOFF` at the rim, 0 beyond it. */
export function blastFalloff(distancePx: number, radius = CANISTER_RADIUS): number {
  if (distancePx >= radius) return distancePx > radius ? 0 : CANISTER_RIM_FALLOFF;
  return 1 - (1 - CANISTER_RIM_FALLOFF) * (Math.max(0, distancePx) / radius);
}

/**
 * The terrain half of a detonation: the canister itself becomes rubble, bulkheads inside the
 * radius take `CANISTER_WALL_DAMAGE` (enough to finish a 36 HP 'B' in one go — walls do not
 * dodge, so no falloff), and any unarmed canister inside it lights a short chain fuse.
 *
 * The caller must rebuild its solid grid afterwards and only then resolve entity damage, so
 * that the blast's `clearPath` checks see the hole the canister just made rather than itself.
 */
export function applyCanisterBlastToTerrain(
  room: RoomSpec,
  state: TerrainState,
  blast: CanisterBlast,
): { state: TerrainState; wallHits: TerrainHit[]; chained: TileRef[] } {
  const key = terrainTileKey(blast.col, blast.row);
  const canisters = { ...state.canisters };
  delete canisters[key];
  let next: TerrainState = {
    ...state,
    canisters,
    brokenWalls: state.brokenWalls.includes(key) ? [...state.brokenWalls] : [...state.brokenWalls, key],
  };
  const wallHits: TerrainHit[] = [];
  const chained: TileRef[] = [];
  for (const { col, row } of tilesInCircle(room, blast.x, blast.y, CANISTER_RADIUS)) {
    const tile = terrainTileAt(room, col, row, next.brokenWalls);
    if (tile === 'B') {
      const result = damageBreakableWall(room, next, col, row, CANISTER_WALL_DAMAGE);
      next = result.state;
      wallHits.push(...result.hits);
    } else if (tile === '-') {
      const result = damageCover(room, next, col, row, CANISTER_WALL_DAMAGE, CANISTER_WALL_DAMAGE);
      next = result.state;
      wallHits.push(...result.hits);
    } else if (tile === '*' && blast.depth < CANISTER_MAX_CHAIN_DEPTH) {
      const result = armCanister(room, next, col, row, CANISTER_CHAIN_FUSE_MS, blast.depth + 1);
      next = result.state;
      chained.push(...result.armed);
    }
  }
  return { state: next, wallHits, chained };
}
