/**
 * Grid collision for circles against solid tiles. Pure functions, no engine types.
 * Conventions: see src/shared/conventions.ts (per-axis slide resolution).
 *
 * A grid carries three layers, because "solid" means different things to a pair of boots, a
 * bullet and a body in mid-air (docs/design/TILES.md T2/T4):
 *  - `solid`  blocks walking. Pits and canisters are solid; cover is not.
 *  - `shots`  blocks projectiles and line of sight. Bolts fly over a pit; cover stops them.
 *  - `dash`   blocks a dash or a knockback. Same as `solid` minus pits: you can cross a gap,
 *             and something thrown across one can land in it.
 * All three are rebuilt together, so they can never disagree about a broken wall.
 */
import type { RoomSpec } from '../shared/contracts';
import { TILE_SIZE } from '../shared/conventions';
import { PROP_INFO, SOLID_TILES } from '../shared/registry';
import { terrainTileAt } from '../shared/terrain';

export type GridLayer = 'solid' | 'shots' | 'dash';

export interface SolidGrid {
  width: number;
  height: number;
  /** solid[row * width + col] */
  solid: Uint8Array;
  shots: Uint8Array;
  dash: Uint8Array;
}

/** `sealedDoors`: floors rooms lock their door ('X') tiles while a fight is on. */
export function buildSolidGrid(room: RoomSpec, brokenWalls: readonly string[] = [], sealedDoors = false): SolidGrid {
  const solid = new Uint8Array(room.width * room.height);
  const shots = new Uint8Array(room.width * room.height);
  const dash = new Uint8Array(room.width * room.height);
  const block = (index: number, layers: GridLayer[] = ['solid', 'shots', 'dash']) => {
    for (const layer of layers) (layer === 'solid' ? solid : layer === 'shots' ? shots : dash)[index] = 1;
  };
  if (sealedDoors) for (const exit of room.exits) block(exit.y * room.width + exit.x);
  for (let row = 0; row < room.height; row++) {
    for (let col = 0; col < room.width; col++) {
      // Widened to string: '-' cover joins TILE_CHARS with T4 and this switch predates it.
      const ch: string = terrainTileAt(room, col, row, brokenWalls);
      const index = row * room.width + col;
      if (ch === 'o') block(index, ['solid']); // a pit stops boots and nothing else
      else if (ch === '-') block(index, ['shots']); // cover stops bullets and nothing else
      else if (SOLID_TILES.has(ch)) block(index);
    }
  }
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    if (!info.blocksMovement) continue;
    for (let dy = 0; dy < info.footprint.h; dy++) {
      for (let dx = 0; dx < info.footprint.w; dx++) {
        const col = prop.x + dx;
        const row = prop.y + dy;
        if (col >= 0 && col < room.width && row >= 0 && row < room.height) block(row * room.width + col);
      }
    }
  }
  return { width: room.width, height: room.height, solid, shots, dash };
}

export function isSolidAt(grid: SolidGrid, col: number, row: number, layer: GridLayer = 'solid'): boolean {
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return true;
  return grid[layer][row * grid.width + col] === 1;
}

/** Does a circle at (x, y) with radius r overlap any solid tile? */
export function circleHitsSolid(grid: SolidGrid, x: number, y: number, r: number, layer: GridLayer = 'solid'): boolean {
  const minCol = Math.floor((x - r) / TILE_SIZE);
  const maxCol = Math.floor((x + r) / TILE_SIZE);
  const minRow = Math.floor((y - r) / TILE_SIZE);
  const maxRow = Math.floor((y + r) / TILE_SIZE);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isSolidAt(grid, col, row, layer)) continue;
      // closest point on tile AABB to the circle centre
      const tx = Math.max(col * TILE_SIZE, Math.min(x, (col + 1) * TILE_SIZE));
      const ty = Math.max(row * TILE_SIZE, Math.min(y, (row + 1) * TILE_SIZE));
      const dx = x - tx;
      const dy = y - ty;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/**
 * Move a circle by (dx, dy), sliding along solids. Sub-steps so fast dashes cannot
 * tunnel through one-tile walls. Returns the resolved position.
 */
export function moveCircle(
  grid: SolidGrid,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
  layer: GridLayer = 'solid',
): { x: number; y: number; blockedX: boolean; blockedY: boolean } {
  const maxStep = r * 0.8;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  const sx = dx / steps;
  const sy = dy / steps;
  let blockedX = false;
  let blockedY = false;
  // When an axis move is blocked only by a corner, slide slightly along the other axis so
  // entities round corners instead of sticking to them (fixes "stuck on the wall edge").
  const nudge = Math.max(1, Math.min(r * 0.5, Math.abs(sx) + Math.abs(sy)));
  for (let i = 0; i < steps; i++) {
    if (Math.abs(sx) > 1e-6) {
      const nx = x + sx;
      if (!circleHitsSolid(grid, nx, y, r, layer)) x = nx;
      else if (!circleHitsSolid(grid, nx, y - nudge, r, layer)) {
        x = nx;
        y -= nudge;
      } else if (!circleHitsSolid(grid, nx, y + nudge, r, layer)) {
        x = nx;
        y += nudge;
      } else blockedX = true;
    }
    if (Math.abs(sy) > 1e-6) {
      const ny = y + sy;
      if (!circleHitsSolid(grid, x, ny, r, layer)) y = ny;
      else if (!circleHitsSolid(grid, x - nudge, ny, r, layer)) {
        y = ny;
        x -= nudge;
      } else if (!circleHitsSolid(grid, x + nudge, ny, r, layer)) {
        y = ny;
        x += nudge;
      } else blockedY = true;
    }
  }
  return { x, y, blockedX, blockedY };
}
