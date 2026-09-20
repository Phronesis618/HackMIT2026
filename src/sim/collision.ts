/**
 * Grid collision for circles against solid tiles. Pure functions, no engine types.
 * Conventions: see src/shared/conventions.ts (per-axis slide resolution).
 */
import type { RoomSpec } from '../shared/contracts';
import { TILE_SIZE } from '../shared/conventions';
import { PROP_INFO, SOLID_TILES } from '../shared/registry';

export interface SolidGrid {
  width: number;
  height: number;
  /** solid[row * width + col] */
  solid: Uint8Array;
}

export function buildSolidGrid(room: RoomSpec): SolidGrid {
  const solid = new Uint8Array(room.width * room.height);
  for (let row = 0; row < room.height; row++) {
    const line = room.tiles[row] ?? '';
    for (let col = 0; col < room.width; col++) {
      const ch = line[col] ?? ' ';
      if (SOLID_TILES.has(ch)) solid[row * room.width + col] = 1;
    }
  }
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    if (!info.blocksMovement) continue;
    for (let dy = 0; dy < info.footprint.h; dy++) {
      for (let dx = 0; dx < info.footprint.w; dx++) {
        const col = prop.x + dx;
        const row = prop.y + dy;
        if (col >= 0 && col < room.width && row >= 0 && row < room.height) {
          solid[row * room.width + col] = 1;
        }
      }
    }
  }
  return { width: room.width, height: room.height, solid };
}

export function isSolidAt(grid: SolidGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return true;
  return grid.solid[row * grid.width + col] === 1;
}

/** Does a circle at (x, y) with radius r overlap any solid tile? */
export function circleHitsSolid(grid: SolidGrid, x: number, y: number, r: number): boolean {
  const minCol = Math.floor((x - r) / TILE_SIZE);
  const maxCol = Math.floor((x + r) / TILE_SIZE);
  const minRow = Math.floor((y - r) / TILE_SIZE);
  const maxRow = Math.floor((y + r) / TILE_SIZE);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isSolidAt(grid, col, row)) continue;
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
      if (!circleHitsSolid(grid, nx, y, r)) x = nx;
      else if (!circleHitsSolid(grid, nx, y - nudge, r)) {
        x = nx;
        y -= nudge;
      } else if (!circleHitsSolid(grid, nx, y + nudge, r)) {
        x = nx;
        y += nudge;
      } else blockedX = true;
    }
    if (Math.abs(sy) > 1e-6) {
      const ny = y + sy;
      if (!circleHitsSolid(grid, x, ny, r)) y = ny;
      else if (!circleHitsSolid(grid, x - nudge, ny, r)) {
        y = ny;
        x -= nudge;
      } else if (!circleHitsSolid(grid, x + nudge, ny, r)) {
        y = ny;
        x += nudge;
      } else blockedY = true;
    }
  }
  return { x, y, blockedX, blockedY };
}
