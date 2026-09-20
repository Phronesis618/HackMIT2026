/**
 * World lighting (agent M1, docs/design/WORLD_MUTATORS.md §5.2 item 2 and the `long_dark` law).
 *
 * `LIGHTING` re-parameterises the wall renderer: which side of a solid shows its front face,
 * how bright the top is, how deep the shadow band and how loud the rim. Identical geometry
 * reads as a different building. F3's solid language holds in every mode: the top face is
 * derived from `solidColors` (lighter than the floor) and only ever darkened within the
 * margin that keeps it above the floor's value.
 *
 * `drawDarkness` is `long_dark`: a hard-edged light circle per living operative, lanterns and
 * conduits as small fixed lights. It is drawn BELOW hazards' own overlay and telegraphs are
 * redrawn above it by the scene, so danger stays readable in the dark.
 */
import type Phaser from 'phaser';
import type { RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import type { LIGHTING_IDS } from '../../shared/laws';
import { VOID_COLOR, hexInt } from './color';

type G = Phaser.GameObjects.Graphics;
export type LightingId = (typeof LIGHTING_IDS)[number];

export interface LightingSpec {
  /** Top face: 0 = the shared solid cap; negative darkens toward the wall's own colour, positive lifts. */
  capShift: number;
  face: 'south' | 'north' | 'none';
  /** Dark band at the foot of the front face, px. */
  shadowPx: number;
  rimPx: number;
  rim: 'edge' | 'accent' | 'glow';
  rimAlpha: number;
  /** Strength of the shadows solids cast on the floor, 0..1 (1 = today). */
  castShadow: number;
  shafts: boolean;
  pulse: boolean;
}

export const LIGHTING: Record<LightingId, LightingSpec> = {
  overhead: { capShift: 0, face: 'south', shadowPx: 6, rimPx: 2, rim: 'edge', rimAlpha: 0.55, castShadow: 1, shafts: false, pulse: false },
  rim: { capShift: -0.3, face: 'south', shadowPx: 2, rimPx: 5, rim: 'accent', rimAlpha: 1, castShadow: 0.6, shafts: false, pulse: false },
  underlit: { capShift: -0.22, face: 'north', shadowPx: 6, rimPx: 3, rim: 'glow', rimAlpha: 0.9, castShadow: 0.35, shafts: false, pulse: false },
  shafts: { capShift: 0.05, face: 'south', shadowPx: 8, rimPx: 2, rim: 'edge', rimAlpha: 0.5, castShadow: 1.2, shafts: true, pulse: false },
  flat: { capShift: 0, face: 'none', shadowPx: 0, rimPx: 1, rim: 'edge', rimAlpha: 0.9, castShadow: 0, shafts: false, pulse: false },
  stormlight: { capShift: 0, face: 'south', shadowPx: 6, rimPx: 3, rim: 'edge', rimAlpha: 0.7, castShadow: 1, shafts: false, pulse: true },
};
export const DEFAULT_LIGHTING: LightingSpec = LIGHTING.overhead;

/** `shafts`: three slanted bands of light over the whole room, static. */
export function drawLightShafts(g: G, roomW: number, roomH: number, color: number): void {
  const slant = roomH * 0.2;
  [0.1, 0.38, 0.64].forEach((u, i) => {
    const x = roomW * u;
    const w = roomW * (0.09 + i * 0.015);
    for (let k = 0; k < 3; k++) {
      const inset = k * w * 0.16;
      g.fillStyle(color, 0.06);
      g.fillPoints([
        { x: x + inset + slant, y: 0 }, { x: x + w - inset + slant, y: 0 },
        { x: x + w - inset, y: roomH }, { x: x + inset, y: roomH },
      ], true);
    }
  });
}

/** `stormlight`: one slow breath of the whole room, ±0.08 on a 4.2 s cycle. Redrawn per frame. */
export function drawStormPulse(g: G, roomW: number, roomH: number, color: number, timeMs: number): void {
  g.clear();
  const wave = Math.sin((timeMs / 4200) * Math.PI * 2);
  // A rare sharper flicker on top of the swell, deterministic in time.
  const flicker = Math.sin(timeMs / 173) > 0.985 ? 0.05 : 0;
  if (wave >= 0) g.fillStyle(color, wave * 0.08 + flicker).fillRect(0, 0, roomW, roomH);
  else g.fillStyle(0x000000, -wave * 0.16).fillRect(0, 0, roomW, roomH);
}

// ---------------------------------------------------------------------------
// long_dark
// ---------------------------------------------------------------------------

export interface LightSource { x: number; y: number; radius: number }

/** Lantern props and `+` conduit tiles carry their own small light (the doc's +60 px). */
export const FIXED_LIGHT_RADIUS = 60;
export function fixedLights(room: RoomSpec): LightSource[] {
  const lights: LightSource[] = [];
  for (const prop of room.props) if (prop.propId === 'lantern') lights.push({ ...tileToWorld(prop.x, prop.y), radius: FIXED_LIGHT_RADIUS });
  room.tiles.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) if (line[col] === '+') lights.push({ ...tileToWorld(col, row), radius: FIXED_LIGHT_RADIUS });
  });
  return lights;
}

export function isLit(point: { x: number; y: number }, lights: readonly LightSource[]): boolean {
  return lights.some((light) => Math.hypot(point.x - light.x, point.y - light.y) <= light.radius);
}

/** What the dark leaves of the room: the doc's 0.25 alpha, i.e. 0.75 of it covered. */
export const DARKNESS_ALPHA = 0.75;
/** Tiles that must read through the dark: live hazards. Telegraphs are drawn above the dark instead. */
const HAZARD_TILES = new Set(['~', '^', '%', '*']);

/**
 * Covers the room in dark tile by tile, leaving a HARD-edged circle around every light (the
 * Repentance lesson: a bigger, harder circle plays better than a soft falloff). Sub-tile cells
 * keep the edge round. Hazard tiles are never covered.
 */
export function drawDarkness(g: G, room: RoomSpec, lights: readonly LightSource[]): void {
  g.clear();
  const dark = hexInt(VOID_COLOR);
  const cell = TILE_SIZE / 4;
  const pad = 2;
  for (let row = -pad; row < room.height + pad; row++) {
    const line = room.tiles[row] ?? '';
    for (let col = -pad; col < room.width + pad; col++) {
      if (HAZARD_TILES.has(line[col] ?? ' ')) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const centre = { x: x + TILE_SIZE / 2, y: y + TILE_SIZE / 2 };
      let nearest = Infinity;
      for (const light of lights) nearest = Math.min(nearest, Math.hypot(centre.x - light.x, centre.y - light.y) - light.radius);
      if (nearest > TILE_SIZE) { g.fillStyle(dark, DARKNESS_ALPHA).fillRect(x, y, TILE_SIZE, TILE_SIZE); continue; }
      if (nearest < -TILE_SIZE) continue;
      // Edge tile: resolve the circle at quarter-tile cells, runs merged per row.
      for (let cy = 0; cy < 4; cy++) {
        let runStart = -1;
        for (let cx = 0; cx <= 4; cx++) {
          const lit = cx < 4 && isLit({ x: x + (cx + 0.5) * cell, y: y + (cy + 0.5) * cell }, lights);
          if (cx < 4 && !lit) { if (runStart < 0) runStart = cx; continue; }
          if (runStart >= 0) { g.fillStyle(dark, DARKNESS_ALPHA).fillRect(x + runStart * cell, y + cy * cell, (cx - runStart) * cell, cell); runStart = -1; }
        }
      }
    }
  }
  // The rim of each light: one thin ring so the boundary is a decision, not a blur.
  for (const light of lights) if (light.radius > FIXED_LIGHT_RADIUS) g.lineStyle(1.5, 0xffffff, 0.1).strokeCircle(light.x, light.y, light.radius);
}
