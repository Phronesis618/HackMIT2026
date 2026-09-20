import type { RoomSpec } from './contracts';
import { worldToTile } from './conventions';
import { TILE_CHARS, type TileChar } from './registry';

export interface TerrainState {
  brokenWalls: string[];
  wallDamage: Record<string, number>;
}

export function terrainTileKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function terrainTileAt(
  room: RoomSpec,
  col: number,
  row: number,
  brokenWalls: readonly string[] = [],
): TileChar {
  const tile = room.tiles[row]?.[col];
  if (tile === 'B' && brokenWalls.includes(terrainTileKey(col, row))) return ':';
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
