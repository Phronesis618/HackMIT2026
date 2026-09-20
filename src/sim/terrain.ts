import type { RoomSpec } from '../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../shared/conventions';
import { BREAKABLE_WALL_HP } from '../shared/registry';
import { terrainTileAt, terrainTileKey, type TerrainState } from '../shared/terrain';
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
}

export function createTerrainState(): TerrainState {
  return { brokenWalls: [], wallDamage: {} };
}

export function damageBreakableWall(
  room: RoomSpec,
  state: TerrainState,
  col: number,
  row: number,
  damage: number,
): TerrainDamageResult {
  if (!Number.isFinite(damage) || damage <= 0 || terrainTileAt(room, col, row, state.brokenWalls) !== 'B') {
    return { state, hits: [] };
  }
  const key = terrainTileKey(col, row);
  const totalDamage = Math.min(BREAKABLE_WALL_HP, (state.wallDamage[key] ?? 0) + damage);
  const hp = BREAKABLE_WALL_HP - totalDamage;
  return {
    state: {
      brokenWalls: hp === 0 ? [...state.brokenWalls, key] : [...state.brokenWalls],
      wallDamage: { ...state.wallDamage, [key]: totalDamage },
    },
    hits: [{ x: col, y: row, hp, destroyed: hp === 0 }],
  };
}

export function strikeBreakableWalls(
  room: RoomSpec,
  grid: SolidGrid,
  state: TerrainState,
  attack: TerrainAttack,
): TerrainDamageResult {
  if (![attack.x, attack.y, attack.facing, attack.range, attack.arc, attack.damage].every(Number.isFinite) ||
      attack.range < 0 || attack.arc < 0 || attack.damage <= 0) return { state, hits: [] };
  let next = state;
  const hits: TerrainHit[] = [];
  for (let row = 0; row < room.height; row++) {
    for (let col = 0; col < room.width; col++) {
      if (terrainTileAt(room, col, row, state.brokenWalls) !== 'B') continue;
      const center = tileToWorld(col, row);
      if (!inArc(attack, center, attack.facing, attack.range, attack.arc, TILE_SIZE / 2)) continue;
      if (!wallVisible(grid, attack, col, row)) continue;
      const result = damageBreakableWall(room, next, col, row, attack.damage);
      next = result.state;
      hits.push(...result.hits);
    }
  }
  return { state: next, hits };
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
