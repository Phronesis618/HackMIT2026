import type Phaser from 'phaser';
import type { Palette, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { terrainTileAt, terrainTileKey, type TerrainState } from '../../shared/terrain';
import { TERRAIN_CAPTION } from '../../shared/registry';
import { hexInt, mix } from './color';

export interface TerrainTile { x: number; y: number }

/**
 * Tiles this layer draws or captions. '~' is painted by the floor pass in environment.ts; it is
 * listed here so a player standing beside scalding floor still gets told what it is.
 */
const CAPTIONED_TILES = 'B=>:+~*';

export function collectTerrainTiles(room: RoomSpec): TerrainTile[] {
  const tiles: TerrainTile[] = [];
  room.tiles.forEach((row, y) => {
    [...row].forEach((tile, x) => { if (CAPTIONED_TILES.includes(tile)) tiles.push({ x, y }); });
  });
  return tiles;
}

export function terrainCaption(
  room: RoomSpec, tiles: TerrainTile[], state: TerrainState | undefined, player: { x: number; y: number },
): string | null {
  let nearest: TerrainTile | undefined;
  let distance = TILE_SIZE * 1.45;
  for (const tile of tiles) {
    const point = tileToWorld(tile.x, tile.y);
    const d = Math.hypot(point.x - player.x, point.y - player.y);
    if (d < distance) { distance = d; nearest = tile; }
  }
  if (!nearest) return null;
  switch (terrainTileAt(room, nearest.x, nearest.y, state?.brokenWalls)) {
    case 'B': return TERRAIN_CAPTION.breakable_walls;
    case ':': return TERRAIN_CAPTION.rubble;
    case '+': return TERRAIN_CAPTION.conduits;
    case '~': return TERRAIN_CAPTION.hazard_floor;
    case '*': return TERRAIN_CAPTION.canisters;
    case '>':
    case '=': return TERRAIN_CAPTION.bridges;
    default: return null;
  }
}

export function drawTerrain(
  g: Phaser.GameObjects.Graphics, room: RoomSpec, tiles: TerrainTile[], state: TerrainState | undefined,
  palette: Palette, timeMs: number,
): void {
  g.clear();
  const accent = hexInt(palette.accent);
  const stone = mix(palette.wall, palette.text, 0.24);
  const edge = hexInt(palette.wallEdge);
  for (const tile of tiles) {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    const type = terrainTileAt(room, tile.x, tile.y, state?.brokenWalls);
    if (type === 'B') {
      const damaged = (state?.wallDamage[terrainTileKey(tile.x, tile.y)] ?? 0) > 0;
      g.fillStyle(0x000000, 0.3).fillRect(x + 3, y + 6, TILE_SIZE, TILE_SIZE);
      g.fillStyle(stone, 1).fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      g.lineStyle(2, 0xf2bb71, 0.85).strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
      g.lineStyle(damaged ? 3 : 1.5, 0x0a0e18, 1)
        .lineBetween(x + 17, y + 2, x + 10, y + 13)
        .lineBetween(x + 10, y + 13, x + 21, y + 19)
        .lineBetween(x + 21, y + 19, x + 14, y + 30);
      if (damaged) g.lineBetween(x + 10, y + 13, x + 2, y + 19).lineBetween(x + 21, y + 19, x + 30, y + 13);
    } else if (type === '*') {
      // A squat cylinder with a hazard chevron. Once armed its rim flashes, accelerating from
      // about 4 Hz to 12 Hz as the fuse runs out, so the tell is the tile itself (R3).
      const fuseMs = state?.canisters?.[terrainTileKey(tile.x, tile.y)]?.fuseMs;
      const danger = hexInt(palette.hazard);
      g.fillStyle(0x000000, 0.35).fillRect(x + 4, y + 8, TILE_SIZE - 6, TILE_SIZE - 8);
      g.fillStyle(stone, 1).fillRect(x + 6, y + 6, TILE_SIZE - 12, TILE_SIZE - 9);
      g.fillStyle(mix(palette.wall, palette.accent, 0.35), 1).fillRect(x + 6, y + 4, TILE_SIZE - 12, 5);
      g.lineStyle(1.5, danger, 0.9)
        .lineBetween(x + 8, y + 18, x + 16, y + 12)
        .lineBetween(x + 16, y + 12, x + 24, y + 18);
      if (fuseMs !== undefined) {
        const urgency = 4 + 8 * Math.min(1, Math.max(0, 1 - fuseMs / 420));
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((timeMs / 1000) * urgency * Math.PI * 2));
        g.lineStyle(3, danger, pulse).strokeRect(x + 4, y + 3, TILE_SIZE - 8, TILE_SIZE - 6);
        g.fillStyle(danger, pulse * 0.35).fillRect(x, y, TILE_SIZE, TILE_SIZE);
      } else {
        g.lineStyle(1, edge, 0.8).strokeRect(x + 6, y + 4, TILE_SIZE - 12, TILE_SIZE - 7);
      }
    } else if (type === ':') {
      for (let i = 0; i < 8; i++) {
        const ox = (i * 13 + tile.x * 7) % 25 + 2;
        const oy = (i * 7 + tile.y * 11) % 25 + 2;
        g.fillStyle(stone, 0.65).fillRect(x + ox, y + oy, 3 + i % 3, 3);
        g.lineStyle(1, edge, 0.75).lineBetween(x + ox, y + oy, x + ox + 3, y + oy);
      }
    } else if (type === '+') {
      g.fillStyle(accent, 0.13).fillRect(x, y, TILE_SIZE, TILE_SIZE);
      g.lineStyle(1, accent, 0.75).strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
      const alpha = 0.45 + Math.sin(timeMs / 160 + tile.x + tile.y) * 0.25;
      g.lineStyle(2, accent, alpha);
      for (const offset of [10, 19]) {
        g.lineBetween(x + 10, y + offset + 3, x + 16, y + offset - 3)
          .lineBetween(x + 16, y + offset - 3, x + 22, y + offset + 3);
      }
    } else if (type === '=' || type === '>') {
      const vertical = ['=', '>'].includes(room.tiles[tile.y - 1]?.[tile.x] ?? '') ||
        ['=', '>'].includes(room.tiles[tile.y + 1]?.[tile.x] ?? '');
      g.fillStyle(0x000000, 0.6).fillRect(x + 3, y + 4, TILE_SIZE - 6, TILE_SIZE - 4);
      g.fillStyle(stone, 1).fillRect(x + 3, y, TILE_SIZE - 6, TILE_SIZE - 3);
      g.lineStyle(1.5, accent, 0.8);
      if (vertical) {
        g.lineBetween(x + 4, y, x + 4, y + TILE_SIZE).lineBetween(x + TILE_SIZE - 4, y, x + TILE_SIZE - 4, y + TILE_SIZE);
      } else {
        g.lineBetween(x, y + 3, x + TILE_SIZE, y + 3).lineBetween(x, y + TILE_SIZE - 4, x + TILE_SIZE, y + TILE_SIZE - 4);
      }
      g.lineStyle(1, edge, 0.8);
      for (let i = 7; i < TILE_SIZE - 3; i += type === '>' ? 5 : 9) {
        if (vertical) g.lineBetween(x + 6, y + i, x + TILE_SIZE - 6, y + i);
        else g.lineBetween(x + i, y + 5, x + i, y + TILE_SIZE - 6);
      }
    }
  }
}
