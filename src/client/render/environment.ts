/**
 * Environment art: backdrop (gradient sky, nebula colour, stars, three-depth silhouettes
 * with rim light), floor plating with cracks and runes, shaded walls and light pools.
 * Palettes come from ArtRecipe; extra colour is DERIVED (hue shifts of the accent) so every
 * theme keeps its identity while looking far richer than flat ink.
 */
import type { Palette, RoomProp, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import type { MotifId } from '../../shared/registry';
import { hexInt, intToHex, darken, mix, shiftHue, solidColors, VOID_COLOR } from './color';

export { solidColors, VOID_COLOR };
import { drawTilePattern, type FloorPattern, type MoteStyle } from './dressing';
import type { G } from './fx';

const TAU = Math.PI * 2;

function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280 || 31;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export const BACKDROP_PAD = 260;

/**
 * What surrounds the room: near-black void, Isaac-style, so the room is the only thing on
 * screen that asks to be read. One faint biome-tinted halo keeps it from looking like a
 * missing texture; it sits far below the value of any floor material. `skyline` and `seed`
 * are kept in the signature for callers, the void ignores them.
 */
export function drawBackdrop(g: G, roomW: number, roomH: number, palette: Palette, _skyline?: MotifId, _seed?: number): void {
  const pad = BACKDROP_PAD * 4;
  g.fillStyle(hexInt(VOID_COLOR), 1).fillRect(-pad, -pad, roomW + pad * 2, roomH + pad * 2);
  const tint = mix(VOID_COLOR, palette.accent, 0.5);
  for (let k = 6; k >= 1; k--) {
    g.fillStyle(tint, 0.012).fillEllipse(roomW / 2, roomH / 2, roomW * (0.9 + k * 0.16), roomH * (0.9 + k * 0.2));
  }
}

/**
 * Floor with subtle hue variation, cracks and rare glowing runes. The material itself
 * (`pattern`) comes from the world's dominant motif — plates, flagstone, grating, crystal,
 * organic soil, monolith slabs or lantern-hall boards — so worlds differ underfoot too.
 */
export function drawFloor(g: G, room: RoomSpec, palette: Palette, seed: number, pattern: FloorPattern = 'plates'): void {
  const rand = rng(seed + 7);
  const base = palette.floor;
  const alt = palette.floorAlt;
  const warm = intToHex(shiftHue(base, 18, 0.04, 0.02));
  const cool = intToHex(shiftHue(base, -18, 0.04, 0.02));
  const seam = darken(base, 0.35);
  const rune = hexInt(palette.accent);
  const hazard = hexInt(palette.hazard);
  for (let row = 0; row < room.height; row++) {
    const line = room.tiles[row] ?? '';
    for (let col = 0; col < room.width; col++) {
      const ch = line[col] ?? ' ';
      if (ch === ' ' || ch === '#') continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const v = rand();
      const color = (row + col) % 2 === 0 ? (v < 0.5 ? base : alt) : v < 0.35 ? warm : v < 0.7 ? cool : alt;
      g.fillStyle(hexInt(color), 1).fillRect(x, y, TILE_SIZE, TILE_SIZE);
      drawTilePattern(g, pattern, { x, y, col, row, color, seam, rand, palette });
      // Cast shadows: a solid tile to the north or west darkens this floor tile's edge, which
      // is what makes the solid read as standing ABOVE the floor.
      if (room.tiles[row - 1]?.[col] === '#') {
        for (let k = 0; k < 4; k++) g.fillStyle(0x000000, 0.3 - k * 0.07).fillRect(x, y + k * 3, TILE_SIZE, 3);
      }
      if (line[col - 1] === '#') {
        g.fillStyle(0x000000, 0.2).fillRect(x, y, 4, TILE_SIZE);
        g.fillStyle(0x000000, 0.1).fillRect(x + 4, y, 4, TILE_SIZE);
      }
      // cracks
      if (v > 0.86) {
        let px = x + rand() * TILE_SIZE;
        let py = y + rand() * TILE_SIZE;
        g.lineStyle(1, seam, 0.9);
        for (let k = 0; k < 3; k++) {
          const nx = Math.max(x, Math.min(x + TILE_SIZE, px + (rand() - 0.5) * 18));
          const ny = Math.max(y, Math.min(y + TILE_SIZE, py + (rand() - 0.5) * 18));
          g.lineBetween(px, py, nx, ny);
          px = nx;
          py = ny;
        }
      }
      // rare glowing rune plates
      if (v > 0.965 && ch === '.') {
        g.fillStyle(rune, 0.12).fillRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        g.lineStyle(1.5, rune, 0.8).strokeRect(x + 8, y + 8, TILE_SIZE - 16, TILE_SIZE - 16);
        g.lineStyle(1, rune, 0.9).lineBetween(x + 8, y + TILE_SIZE / 2, x + TILE_SIZE - 8, y + TILE_SIZE / 2);
      }
      if (ch === '~') {
        g.fillStyle(hazard, 0.28).fillRect(x, y, TILE_SIZE, TILE_SIZE);
        g.lineStyle(2, hazard, 0.75);
        g.lineBetween(x + 4, y + TILE_SIZE - 6, x + TILE_SIZE / 2, y + 6).lineBetween(x + TILE_SIZE / 2, y + 6, x + TILE_SIZE - 4, y + TILE_SIZE - 6);
      }
      if (ch === 'X' && room.kind === undefined) {
        // Legacy exit pad. Floors rooms draw real doorways instead (doors.ts).
        g.fillStyle(rune, 0.22).fillRect(x, y, TILE_SIZE, TILE_SIZE);
        g.lineStyle(2, rune, 0.9).strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        g.lineStyle(1, 0xffffff, 0.5).strokeRect(x + 8, y + 8, TILE_SIZE - 16, TILE_SIZE - 16);
      }
      if (ch === 'A') {
        g.lineStyle(2, rune, 0.9).strokeCircle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 12);
        g.lineStyle(1, rune, 0.5).strokeCircle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 15);
      }
    }
  }
}

/**
 * Walls, in the shared solid language (see `solidColors`): a light top face with a bevel,
 * a dark front face wherever floor lies to the south, a near-black outline along every
 * edge that touches something that is not wall, and a thin lip under the room's outer
 * south edge so the whole room reads as one clean slab standing in the void.
 */
export function drawWalls(g: G, room: RoomSpec, palette: Palette, seed: number): void {
  const rand = rng(seed + 13);
  const c = solidColors(palette);
  const panel = hexInt(palette.accentSoft);
  const T = TILE_SIZE;
  const at = (col: number, row: number): string => room.tiles[row]?.[col] ?? ' ';
  const isWall = (ch: string): boolean => ch === '#';
  const isVoid = (ch: string): boolean => ch === ' ';
  for (let row = 0; row < room.height; row++) {
    for (let col = 0; col < room.width; col++) {
      if (!isWall(at(col, row))) continue;
      const x = col * T;
      const y = row * T;
      const n = at(col, row - 1);
      const s = at(col, row + 1);
      const w = at(col - 1, row);
      const e = at(col + 1, row);
      const floorBelow = !isWall(s) && !isVoid(s);
      // top face; tiles buried inside a thick wall sit a step darker so the lit rim carries the shape
      let buried = true;
      for (let dy = -1; dy <= 1 && buried; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWall(at(col + dx, row + dy))) { buried = false; break; }
      g.fillStyle(buried ? c.capDeep : c.cap, 1).fillRect(x, y, T, T);
      if (!isWall(n)) g.fillStyle(c.capHi, 0.8).fillRect(x, y, T, 2.5);
      if (!isWall(w)) g.fillStyle(c.capHi, 0.45).fillRect(x, y, 2, T);
      if (rand() < 0.2) g.fillStyle(c.capHi, 0.22).fillRect(x + 6 + rand() * 12, y + 5 + rand() * 6, 6, 5);
      if (floorBelow) {
        // front face: the tile stands above the floor south of it
        const fy = y + T * 0.42;
        g.fillStyle(c.face, 1).fillRect(x, fy, T, T - T * 0.42);
        g.fillStyle(c.capHi, 0.9).fillRect(x, fy - 1, T, 1.5);
        g.fillStyle(c.faceLow, 1).fillRect(x, y + T - 6, T, 6);
        g.fillStyle(c.rim, 0.55).fillRect(x, y + T - 2, T, 2);
        if (rand() < 0.22) g.fillStyle(panel, 0.8).fillRect(x + 10, y + T * 0.62, 12, 3);
      } else if (isVoid(s)) {
        // outer south edge of the room: a short lip into the void
        g.fillStyle(c.face, 1).fillRect(x, y + T, T, 7);
        g.fillStyle(c.outline, 1).fillRect(x, y + T + 7, T, 2);
      }
      // outline wherever the wall stops
      g.fillStyle(c.outline, 1);
      if (!isWall(n)) g.fillRect(x, y - 1, T, 1.5);
      if (!isWall(s) && !isVoid(s)) g.fillRect(x, y + T - 0.5, T, 1.5);
      if (!isWall(w)) g.fillRect(x - 1, y, 1.5, T);
      if (!isWall(e)) g.fillRect(x + T - 0.5, y, 1.5, T);
    }
  }
}

/** Warm/cool light pools under lanterns, exits and the anchor so the floor is never flat. */
export function drawLightPools(g: G, room: RoomSpec, palette: Palette): void {
  const warm = hexInt(palette.accentSoft);
  const accent = hexInt(palette.accent);
  const pool = (x: number, y: number, color: number, radius: number, strength: number): void => {
    for (let k = 5; k >= 1; k--) g.fillStyle(color, strength * 0.022 * k).fillCircle(x, y, radius * (k / 5));
  };
  for (const prop of room.props) {
    const c = tileToWorld(prop.x, prop.y);
    if (prop.propId === 'lantern') pool(c.x, c.y, warm, 64, 1);
    if (prop.propId === 'crystal_cluster') pool(c.x, c.y, accent, 60, 0.9);
    if (prop.propId === 'terminal') pool(c.x, c.y + 10, accent, 44, 0.7);
    if (prop.propId === 'anchor_pedestal') pool(c.x, c.y, accent, 70, 1);
  }
  // Legacy exit pads glow; floors doorways carry their own light (doors.ts) and a pool here
  // would spill past the wall into the void.
  if (room.kind === undefined) {
    for (const exit of room.exits) {
      const c = tileToWorld(exit.x, exit.y);
      pool(c.x, c.y, accent, 64, 1);
    }
  }
}

export interface Mote {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
  warm: boolean;
}

export function makeMotes(roomW: number, roomH: number, seed: number, count = 42): Mote[] {
  const rand = rng(seed + 99);
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    motes.push({ x: rand() * roomW, y: rand() * roomH, r: 0.8 + rand() * 1.6, speed: 6 + rand() * 14, phase: rand() * TAU, warm: rand() < 0.4 });
  }
  return motes;
}

/**
 * Ambient particles (redrawn every frame; purely visual). The `style` follows the world's
 * dominant motif: sparks rise in spire worlds, dust settles under arches, spores drift
 * between roots, embers climb out of ruined machinery, fireflies wander lantern halls…
 */
export function drawMotes(g: G, motes: Mote[], t: number, roomW: number, roomH: number, palette: Palette, style: MoteStyle = 'sparks'): void {
  g.clear();
  const warm = hexInt(palette.accentSoft);
  const cool = hexInt(palette.accent);
  const pale = mix(palette.text, palette.background, 0.35);
  const green = shiftHue(palette.accent, 110, 0.05, 0.05);
  const ember = shiftHue(palette.hazard, 20, 0.1, 0.05);
  const wrapY = (v: number) => ((v % roomH) + roomH) % roomH;
  const wrapX = (v: number) => ((v % roomW) + roomW) % roomW;
  for (const m of motes) {
    switch (style) {
      case 'sparks': {
        const y = wrapY(m.y - t * m.speed * 1.4);
        const x = wrapX(m.x + Math.sin(t * 0.6 + m.phase) * 8);
        const a = 0.3 + 0.3 * Math.sin(t * 3 + m.phase);
        g.fillStyle(m.warm ? warm : cool, a).fillCircle(x, y, m.r * 0.8);
        break;
      }
      case 'dust': {
        const y = wrapY(m.y + t * m.speed * 0.35);
        const x = wrapX(m.x + Math.sin(t * 0.3 + m.phase) * 16);
        g.fillStyle(pale, 0.16 + 0.1 * Math.sin(t + m.phase)).fillCircle(x, y, m.r * 0.7);
        break;
      }
      case 'flicker': {
        const on = Math.sin(t * 7 + m.phase * 5) > 0.75;
        if (!on) break;
        const y = wrapY(m.y * 0.6);
        g.fillStyle(warm, 0.85).fillCircle(m.x, y, m.r * 0.9);
        g.lineStyle(1, warm, 0.5).lineBetween(m.x - 3, y, m.x + 3, y + (m.warm ? 2 : -2));
        break;
      }
      case 'glints': {
        const pulse = Math.max(0, Math.sin(t * 1.7 + m.phase));
        const a = pulse * pulse * pulse * pulse * 0.9;
        if (a < 0.03) break;
        const s = 1.5 + pulse * 3;
        g.lineStyle(1, m.warm ? cool : 0xffffff, a).lineBetween(m.x - s, m.y, m.x + s, m.y).lineBetween(m.x, m.y - s, m.x, m.y + s);
        break;
      }
      case 'spores': {
        const y = wrapY(m.y + Math.sin(t * 0.5 + m.phase) * 10 - t * m.speed * 0.15);
        const x = wrapX(m.x + t * m.speed * 0.5);
        g.fillStyle(green, 0.14 + 0.1 * Math.sin(t * 1.5 + m.phase)).fillCircle(x, y, m.r * 2.2);
        g.fillStyle(green, 0.5).fillCircle(x, y, m.r * 0.7);
        break;
      }
      case 'ash': {
        const y = wrapY(m.y + t * m.speed * 0.5);
        const x = wrapX(m.x + Math.sin(t * 0.8 + m.phase) * 6);
        g.fillStyle(pale, 0.22).fillRect(x, y, m.r * 1.6, m.r * 1.2);
        break;
      }
      case 'fireflies': {
        const x = wrapX(m.x + Math.sin(t * 0.7 + m.phase) * 30);
        const y = wrapY(m.y + Math.cos(t * 0.5 + m.phase * 1.3) * 18);
        const a = 0.35 + 0.45 * Math.max(0, Math.sin(t * 1.3 + m.phase));
        g.fillStyle(warm, a * 0.18).fillCircle(x, y, m.r * 4);
        g.fillStyle(warm, a).fillCircle(x, y, m.r * 0.9);
        break;
      }
      case 'embers': {
        const life = ((t * m.speed * 1.2 + m.phase * 40) % roomH) / roomH; // 0 at the floor, 1 at the top
        const y = roomH - life * roomH;
        const x = wrapX(m.x + Math.sin(t * 2 + m.phase) * 6);
        const a = (1 - life) * 0.9;
        g.fillStyle(life < 0.4 ? warm : ember, a).fillCircle(x, y, m.r * (1.1 - life * 0.6));
        break;
      }
    }
  }
}

export function propHasLight(prop: RoomProp): boolean {
  return prop.propId === 'lantern' || prop.propId === 'crystal_cluster' || prop.propId === 'terminal' || prop.propId === 'anchor_pedestal';
}
