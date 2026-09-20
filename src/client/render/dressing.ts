/**
 * World dressing: the part of the renderer that makes a generated world LOOK like its
 * recipe instead of merely being tinted by it. Every function here is driven by the
 * closed registry (`art.motifIds`, dominant first) plus the palette, so the model never
 * emits art — it picks motifs, and trusted code turns each motif into a distinct
 * construction style:
 *
 *   motif             floor       walls / clutter / overhead
 *   spires            lattice     pinnacles + fins, landing lights, light shafts
 *   arches            flagstone   arched openings, fallen stones, vault ribs
 *   cables            grating     pipe runs + junction boxes, cable trays, catenaries
 *   crystals          crystal     shards on caps + veins, crystal outcrops, stalactites
 *   roots             organic     tendrils + moss, root masses, canopy
 *   monoliths         slabs       glyph bands, rune slabs, floating glyphs
 *   lanterns          boards      hanging lanterns, glow puddles, lantern strings
 *   ruined_machinery  grating     gears + vents, debris and oil, hanging chains
 *
 * Only Graphics primitives that Agent C's scene tests mock are used (no fillTriangle).
 */
import type { Palette, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE } from '../../shared/conventions';
import type { MotifId } from '../../shared/registry';
import { darken, hexInt, intToHex, lighten, mix, shiftHue } from './color';
import type { G } from './fx';

const T = TILE_SIZE;
const TAU = Math.PI * 2;

export type FloorPattern = 'plates' | 'lattice' | 'flagstone' | 'grating' | 'crystal' | 'organic' | 'slabs' | 'boards';
export const FLOOR_PATTERN: Record<MotifId, FloorPattern> = {
  spires: 'lattice',
  arches: 'flagstone',
  cables: 'grating',
  crystals: 'crystal',
  roots: 'organic',
  monoliths: 'slabs',
  lanterns: 'boards',
  ruined_machinery: 'grating',
};

export type MoteStyle = 'sparks' | 'dust' | 'flicker' | 'glints' | 'spores' | 'ash' | 'fireflies' | 'embers';
export const MOTE_STYLE: Record<MotifId, MoteStyle> = {
  spires: 'sparks',
  arches: 'dust',
  cables: 'flicker',
  crystals: 'glints',
  roots: 'spores',
  monoliths: 'ash',
  lanterns: 'fireflies',
  ruined_machinery: 'embers',
};

function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280 || 31;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const isWall = (ch: string | undefined): boolean => ch === '#';
const isFloor = (ch: string | undefined): boolean => ch !== undefined && ch !== '#' && ch !== ' ';

/** Filled polygon through the path API (the scene test mock has no fillTriangle). */
function poly(g: G, points: Array<[number, number]>, color: number, alpha: number): void {
  g.fillStyle(color, alpha).beginPath();
  points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath().fillPath();
}

function polyline(g: G, points: Array<[number, number]>, width: number, color: number, alpha: number): void {
  g.lineStyle(width, color, alpha);
  for (let i = 1; i < points.length; i++) g.lineBetween(points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1]);
}

/** Soft radial glow built from stacked circles. */
function glow(g: G, x: number, y: number, radius: number, color: number, strength: number): void {
  for (let k = 4; k >= 1; k--) g.fillStyle(color, strength * 0.05 * k).fillCircle(x, y, radius * (k / 4));
}

/** Tiles where clutter may sit: floor, not a marker tile, not occupied by a prop/encounter/relic. */
function clutterSpots(room: RoomSpec): Array<{ col: number; row: number; wallAbove: boolean; wallLeft: boolean; wallRight: boolean }> {
  const occupied = new Set<string>();
  for (const p of room.props) occupied.add(`${p.x},${p.y}`);
  for (const e of room.encounters) occupied.add(`${e.x},${e.y}`);
  for (const r of room.relics) occupied.add(`${r.x},${r.y}`);
  const spots: Array<{ col: number; row: number; wallAbove: boolean; wallLeft: boolean; wallRight: boolean }> = [];
  room.tiles.forEach((line, row) => {
    for (let col = 0; col < room.width; col++) {
      if (line[col] !== '.') continue;
      if (occupied.has(`${col},${row}`)) continue;
      // keep the spawn area and anything next to markers clear
      const near = [room.tiles[row - 1]?.[col], room.tiles[row + 1]?.[col], line[col - 1], line[col + 1]];
      if (near.some((c) => c === 'P' || c === 'X' || c === 'A')) continue;
      spots.push({
        col, row,
        wallAbove: isWall(room.tiles[row - 1]?.[col]),
        wallLeft: isWall(line[col - 1]),
        wallRight: isWall(line[col + 1]),
      });
    }
  });
  return spots;
}

// ---------------------------------------------------------------------------
// Wall dressing: drawn over the wall tiles (after drawWalls)
// ---------------------------------------------------------------------------

export function drawWallDressing(g: G, room: RoomSpec, palette: Palette, motifs: MotifId[], seed: number): void {
  const rand = rng(seed + 31);
  const dominant = motifs[0] ?? 'spires';
  const secondary = motifs[1] ?? dominant;
  const ink = darken(palette.wall, 0.55);
  const wallLight = lighten(palette.wall, 0.16);
  const accent = hexInt(palette.accent);
  const soft = hexInt(palette.accentSoft);
  const rim = hexInt(palette.wallEdge);
  const hazard = hexInt(palette.hazard);
  const mossGreen = shiftHue(palette.accent, 110, 0.1, -0.05);

  room.tiles.forEach((line, row) => {
    for (let col = 0; col < room.width; col++) {
      if (!isWall(line[col])) continue;
      const x = col * T;
      const y = row * T;
      const face = isFloor(room.tiles[row + 1]?.[col]);
      const capEdge = isFloor(room.tiles[row - 1]?.[col]) || isFloor(line[col - 1]) || isFloor(line[col + 1]);
      const n = (col * 7 + row * 13) % 12;
      const motif = n % 3 === 0 ? secondary : dominant;
      switch (motif) {
        case 'spires':
          if (row === 0 || (!face && capEdge && n % 3 === 1)) {
            const h = 10 + rand() * 14;
            g.fillStyle(ink, 0.9).fillRect(x + T / 2 - 2, y - h, 4, h + 6);
            g.fillStyle(accent, 0.9).fillCircle(x + T / 2, y - h, 1.6);
            glow(g, x + T / 2, y - h, 7, accent, 0.5);
          }
          if (face) {
            g.fillStyle(wallLight, 0.5).fillRect(x + 7, y + T * 0.5, 2, T * 0.45).fillRect(x + T - 9, y + T * 0.5, 2, T * 0.45);
          }
          break;
        case 'arches':
          if (face && n % 3 === 1) {
            const cx = x + T / 2;
            const r = 8;
            const base = y + T - 4;
            g.fillStyle(ink, 0.95).beginPath().arc(cx, base - r, r, Math.PI, 0, false).lineTo(cx + r, base).lineTo(cx - r, base).closePath().fillPath();
            g.lineStyle(1.2, rim, 0.55).beginPath().arc(cx, base - r, r + 1.5, Math.PI, 0, false).strokePath();
            g.fillStyle(soft, 0.5).fillRect(cx - 1.5, base - 6, 3, 6);
          } else if (!face && n % 4 === 0) {
            g.fillStyle(wallLight, 0.35).fillRect(x + 4, y + 4, T - 8, 3);
          }
          break;
        case 'cables':
          if (face) {
            g.fillStyle(wallLight, 0.7).fillRect(x, y + T * 0.6, T, 3);
            g.fillStyle(ink, 0.6).fillRect(x, y + T * 0.6 + 3, T, 1);
            if (n % 4 === 2) {
              g.fillStyle(ink, 0.95).fillRect(x + T / 2 - 4, y + T * 0.55, 8, 7);
              g.fillStyle(soft, 0.95).fillCircle(x + T / 2, y + T * 0.55 + 3.5, 1.3);
            }
          } else if (n % 5 === 0) {
            g.lineStyle(1, ink, 0.7).strokeCircle(x + T / 2, y + T / 2, 4);
          }
          break;
        case 'crystals':
          if (!face && capEdge && n % 3 === 0) {
            const cx = x + 8 + rand() * (T - 16);
            const cy = y + T / 2;
            const h = 9 + rand() * 9;
            const tint = n % 2 === 0 ? accent : shiftHue(palette.accent, 120, 0, -0.05);
            poly(g, [[cx - 4, cy + 3], [cx, cy - h], [cx + 4, cy + 3]], tint, 0.85);
            poly(g, [[cx - 1, cy + 3], [cx, cy - h], [cx + 4, cy + 3]], lighten(intToHex(tint), 0.3), 0.85);
            glow(g, cx, cy - h / 2, 9, tint, 0.5);
          }
          if (face && n % 2 === 0) {
            g.lineStyle(1, accent, 0.35).lineBetween(x + 6, y + T - 5, x + 12, y + T * 0.55).lineBetween(x + 12, y + T * 0.55, x + 17, y + T - 5);
          }
          break;
        case 'roots':
          if (face && n % 2 === 0) {
            const sx = x + 6 + rand() * (T - 12);
            polyline(g, [[sx, y + T * 0.45], [sx + (rand() - 0.5) * 8, y + T * 0.7], [sx + (rand() - 0.5) * 12, y + T + 6]], 2.5, ink, 0.9);
            polyline(g, [[sx, y + T * 0.6], [sx + 6, y + T * 0.75]], 1.5, ink, 0.9);
          }
          if (!face && n % 3 === 0) {
            g.fillStyle(mossGreen, 0.45).fillEllipse(x + 6 + rand() * (T - 12), y + 6 + rand() * (T - 12), 10 + rand() * 8, 6 + rand() * 4);
          }
          break;
        case 'monoliths':
          if (face && n % 2 === 0) {
            for (let k = 0; k < 4; k++) g.fillStyle(accent, 0.55).fillRect(x + 5 + k * 6, y + T * 0.62, 3, 4);
          } else if (!face) {
            g.fillStyle(wallLight, 0.3).fillRect(x + 2, y + 2, 1.5, T - 4);
          }
          break;
        case 'lanterns':
          if (face && n % 4 === 1) {
            const cx = x + T / 2;
            const top = y + T * 0.45;
            g.lineStyle(1, ink, 0.9).lineBetween(cx, top, cx, top + 7);
            g.fillStyle(ink, 0.95).fillRect(cx - 4, top + 7, 8, 10);
            g.fillStyle(soft, 0.95).fillRect(cx - 2, top + 9, 4, 6);
            glow(g, cx, top + 14, 26, soft, 0.9);
          } else if (!face && n % 5 === 0) {
            g.fillStyle(soft, 0.5).fillCircle(x + T / 2, y + T / 2, 1.5);
          }
          break;
        case 'ruined_machinery':
          if (!face && capEdge && n % 3 === 0) {
            const cx = x + T / 2;
            const cy = y + T / 2;
            g.lineStyle(2.5, ink, 0.95).strokeCircle(cx, cy, 6.5);
            g.lineStyle(1, wallLight, 0.6).strokeCircle(cx, cy, 3);
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * TAU;
              g.lineStyle(2, ink, 0.95).lineBetween(cx + Math.cos(a) * 6.5, cy + Math.sin(a) * 6.5, cx + Math.cos(a) * 9.5, cy + Math.sin(a) * 9.5);
            }
          }
          if (face) {
            g.fillStyle(wallLight, 0.65).fillRect(x, y + T * 0.55, T, 3);
            if (n % 4 === 2) {
              g.fillStyle(hazard, 0.35).fillRect(x + 8, y + T * 0.68, T - 16, 8);
              for (let k = 0; k < 3; k++) g.fillStyle(ink, 0.95).fillRect(x + 9, y + T * 0.68 + 1 + k * 2.6, T - 18, 1.2);
            }
          }
          break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Floor clutter: outcrops, debris and trays near the walls (below props/entities)
// ---------------------------------------------------------------------------

export function drawFloorDressing(g: G, room: RoomSpec, palette: Palette, motifs: MotifId[], seed: number): void {
  const rand = rng(seed + 57);
  const dominant = motifs[0] ?? 'spires';
  const secondary = motifs[1] ?? dominant;
  const ink = darken(palette.wall, 0.5);
  const stone = lighten(palette.wall, 0.1);
  const accent = hexInt(palette.accent);
  const soft = hexInt(palette.accentSoft);
  const mossGreen = shiftHue(palette.floor, 70, 0.12, 0.04);
  const spots = clutterSpots(room);

  for (const spot of spots) {
    const x = spot.col * T;
    const y = spot.row * T;
    const cx = x + T / 2;
    const cy = y + T / 2;
    const r = rand();
    const motif = r < 0.7 ? dominant : secondary;
    // continuous edge features along walls
    if (spot.wallAbove && (motif === 'cables' || motif === 'ruined_machinery')) {
      g.fillStyle(ink, 0.75).fillRect(x, y + 4, T, 4);
      g.lineStyle(1, motif === 'cables' ? accent : soft, 0.45).lineBetween(x, y + 6, x + T, y + 6);
    }
    if (spot.wallAbove && motif === 'roots' && r < 0.55) {
      polyline(g, [[x + 4 + rand() * 8, y - 2], [cx + (rand() - 0.5) * 10, y + 10], [cx + (rand() - 0.5) * 16, y + 20 + rand() * 8]], 3.5, ink, 0.85);
      g.fillStyle(mossGreen, 0.5).fillEllipse(cx + (rand() - 0.5) * 10, y + 8, 12, 6);
    }
    const density = spot.wallAbove || spot.wallLeft || spot.wallRight ? 0.34 : 0.07;
    if (r > density) continue;

    switch (motif) {
      case 'spires':
        g.fillStyle(accent, 0.55).fillCircle(cx, cy, 1.6);
        glow(g, cx, cy, 8, accent, 0.4);
        if (spot.wallAbove) poly(g, [[cx - 3, y + 8], [cx, y - 6], [cx + 3, y + 8]], ink, 0.9);
        break;
      case 'arches': {
        const w = 8 + rand() * 6;
        g.fillStyle(0x000000, 0.25).fillEllipse(cx + 2, cy + 4, w + 6, 6);
        g.fillStyle(stone, 0.95).fillRoundedRect(cx - w / 2, cy - 3, w, 7, 2);
        g.fillStyle(lighten(palette.wall, 0.25), 0.7).fillRect(cx - w / 2 + 1, cy - 3, w - 2, 1.5);
        break;
      }
      case 'cables':
        g.fillStyle(ink, 0.85).fillRect(cx - 4, cy - 3, 8, 6);
        g.fillStyle(accent, 0.9).fillCircle(cx + 2, cy, 1.2);
        break;
      case 'crystals': {
        const h = 10 + rand() * 12;
        const tint = r < 0.12 ? shiftHue(palette.accent, 120, 0, -0.05) : accent;
        glow(g, cx, cy, 16, tint, 0.6);
        poly(g, [[cx - 5, cy + 4], [cx - 1, cy - h], [cx + 4, cy + 4]], tint, 0.9);
        poly(g, [[cx - 1, cy + 4], [cx - 1, cy - h], [cx + 4, cy + 4]], lighten(intToHex(tint), 0.35), 0.9);
        poly(g, [[cx + 2, cy + 5], [cx + 6, cy - h * 0.5], [cx + 9, cy + 5]], tint, 0.85);
        break;
      }
      case 'roots':
        g.fillStyle(mossGreen, 0.55).fillEllipse(cx + (rand() - 0.5) * 8, cy + (rand() - 0.5) * 8, 14 + rand() * 8, 8 + rand() * 4);
        polyline(g, [[cx - 12, cy + 6], [cx - 3, cy], [cx + 5, cy + 3], [cx + 13, cy - 5]], 2, ink, 0.8);
        break;
      case 'monoliths':
        g.lineStyle(1.2, accent, 0.4).strokeRect(cx - 9, cy - 6, 18, 12);
        g.lineStyle(1, accent, 0.55).lineBetween(cx - 5, cy, cx + 5, cy);
        break;
      case 'lanterns':
        // floor candles: a point of light, not a pool — pools of warm glow hid hazards and floor edges
        glow(g, cx, cy, 9, soft, 0.35);
        g.fillStyle(soft, 0.85).fillCircle(cx, cy, 1.4);
        break;
      case 'ruined_machinery':
        if (r < 0.12) {
          g.fillStyle(0x000000, 0.35).fillEllipse(cx, cy + 2, 18 + rand() * 10, 8 + rand() * 4);
          g.fillStyle(shiftHue(palette.accentSoft, 40, 0, -0.2), 0.25).fillEllipse(cx, cy + 2, 12, 5);
        } else {
          g.lineStyle(2, ink, 0.9).beginPath().arc(cx, cy, 6, rand() * TAU, rand() * TAU + 3.5, false).strokePath();
          g.lineStyle(1.5, ink, 0.9).lineBetween(cx, cy, cx + 6, cy - 2);
          g.fillStyle(stone, 0.8).fillRect(cx + 5, cy + 3, 7, 3);
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Overhead structure: low alpha, drawn above entities so the room reads as a space
// ---------------------------------------------------------------------------

export function drawOverhead(g: G, room: RoomSpec, palette: Palette, motifs: MotifId[], seed: number): void {
  const rand = rng(seed + 83);
  const roomW = room.width * T;
  const roomH = room.height * T;
  const ink = darken(palette.wall, 0.6);
  const accent = hexInt(palette.accent);
  const soft = hexInt(palette.accentSoft);
  // Rooms are not always rectangles: hang things from the room's real top edge in that
  // column, and never light anything over the void.
  const topOf = (px: number): number | null => {
    const col = Math.floor(px / T);
    for (let row = 0; row < room.height; row++) if ((room.tiles[row]?.[col] ?? ' ') !== ' ') return row * T;
    return null;
  };
  const inRoom = (px: number, py: number): boolean => (room.tiles[Math.floor(py / T)]?.[Math.floor(px / T)] ?? ' ') !== ' ';
  const seen = new Set<MotifId>();
  for (const motif of motifs.slice(0, 2)) {
    if (seen.has(motif)) continue;
    seen.add(motif);
    switch (motif) {
      case 'cables':
        for (let i = 0; i < 4; i++) {
          const y0 = roomH * (0.12 + rand() * 0.55);
          const sag = 18 + rand() * 30;
          const pts: Array<[number, number]> = [];
          for (let t = 0; t <= 1.001; t += 0.05) pts.push([t * roomW, y0 + Math.sin(t * Math.PI) * sag]);
          polyline(g, pts, 2.2, ink, 0.32);
          for (let k = 0; k < 3; k++) {
            const t = 0.15 + rand() * 0.7;
            const px = t * roomW;
            const py = y0 + Math.sin(t * Math.PI) * sag;
            if (!inRoom(px, py + 11)) continue;
            g.lineStyle(1, ink, 0.32).lineBetween(px, py, px, py + 10);
            g.fillStyle(soft, 0.75).fillCircle(px, py + 11, 1.8);
            glow(g, px, py + 11, 12, soft, 0.35);
          }
        }
        break;
      case 'arches':
        for (let i = 0; i < 3; i++) {
          const cx = roomW * (0.2 + i * 0.3);
          const r = roomH * 0.75;
          g.lineStyle(3, ink, 0.14).beginPath().arc(cx, roomH * 0.95, r, Math.PI * 1.08, Math.PI * 1.92, false).strokePath();
          // Light only the part of the rib that is over the room: a full arc would sail out into the void.
          g.lineStyle(1, accent, 0.12);
          for (let a = Math.PI * 1.08; a < Math.PI * 1.92; a += 0.06) {
            const ax = cx + Math.cos(a) * (r - 6);
            const ay = roomH * 0.95 + Math.sin(a) * (r - 6);
            const bx = cx + Math.cos(a + 0.06) * (r - 6);
            const by = roomH * 0.95 + Math.sin(a + 0.06) * (r - 6);
            if (inRoom(ax, ay) && inRoom(bx, by)) g.lineBetween(ax, ay, bx, by);
          }
        }
        break;
      case 'lanterns':
        for (let i = 0; i < 3; i++) {
          const y0 = roomH * (0.1 + i * 0.28) + rand() * 20;
          const sag = 10 + rand() * 14;
          const pts: Array<[number, number]> = [];
          for (let t = 0; t <= 1.001; t += 0.05) pts.push([t * roomW, y0 + Math.sin(t * Math.PI) * sag]);
          polyline(g, pts, 1, ink, 0.45);
          for (let t = 0.08 + rand() * 0.08; t < 1; t += 0.14 + rand() * 0.08) {
            const px = t * roomW;
            const py = y0 + Math.sin(t * Math.PI) * sag + 6;
            if (!inRoom(px, py)) continue;
            g.fillStyle(ink, 0.7).fillRect(px - 3, py - 4, 6, 8);
            g.fillStyle(soft, 0.9).fillRect(px - 1.5, py - 2.5, 3, 5);
            glow(g, px, py, 11, soft, 0.4);
          }
        }
        break;
      case 'roots':
        for (let i = 0; i < 6; i++) {
          const x0 = rand() * roomW;
          const top = topOf(x0);
          const pts: Array<[number, number]> = [[x0, (top ?? 0) - 6]];
          let px = x0;
          for (let k = 1; k <= 4; k++) {
            px += (rand() - 0.5) * 60;
            pts.push([px, (top ?? 0) + k * (roomH * 0.06)]);
          }
          if (top === null) continue;
          polyline(g, pts, 5, ink, 0.35);
          polyline(g, pts.slice(1, 3).map(([x, y]) => [x + 14, y + 6] as [number, number]), 2, ink, 0.3);
        }
        break;
      case 'crystals':
        for (let i = 0; i < 9; i++) {
          const x = rand() * roomW;
          const h = 14 + rand() * 26;
          const w = 5 + rand() * 6;
          const tint = i % 3 === 0 ? shiftHue(palette.accent, 120, 0, -0.05) : accent;
          const top = topOf(x);
          if (top === null) continue;
          poly(g, [[x - w, top + 2], [x, top + h], [x + w, top + 2]], tint, 0.3);
          poly(g, [[x - w * 0.3, top + 2], [x, top + h], [x + w * 0.5, top + 2]], lighten(intToHex(tint), 0.3), 0.3);
        }
        break;
      case 'ruined_machinery':
        for (let i = 0; i < 3; i++) {
          const x = roomW * (0.15 + rand() * 0.7);
          const top = topOf(x);
          const len = (top ?? 0) + roomH * (0.1 + rand() * 0.2);
          if (top === null) continue;
          for (let y = top + 2; y < len; y += 6) g.fillStyle(ink, 0.35).fillRect(x - 1, y, 2, 4);
          g.lineStyle(2.5, ink, 0.35).strokeCircle(x, len + 7, 7);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU;
            g.lineStyle(2, ink, 0.35).lineBetween(x + Math.cos(a) * 7, len + 7 + Math.sin(a) * 7, x + Math.cos(a) * 10, len + 7 + Math.sin(a) * 10);
          }
        }
        break;
      case 'spires':
        for (let i = 0; i < 3; i++) {
          const x = roomW * (0.15 + rand() * 0.7);
          const w = 26 + rand() * 30;
          const top = topOf(x);
          if (top === null) continue;
          for (let k = 0; k < 5; k++) g.fillStyle(accent, 0.02).fillRect(x - w / 2 - k * 6, top, w + k * 12, roomH * 0.55 - top);
        }
        break;
      case 'monoliths':
        for (let i = 0; i < 5; i++) {
          const x = roomW * (0.1 + rand() * 0.8);
          const y = roomH * (0.08 + rand() * 0.3);
          g.lineStyle(1, accent, 0.18).strokeRect(x - 4, y - 7, 8, 14);
          g.lineStyle(1, accent, 0.25).lineBetween(x, y - 4, x, y + 4);
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Floor tile detail per pattern (called by environment.drawFloor for every floor tile)
// ---------------------------------------------------------------------------

export interface TileContext {
  x: number;
  y: number;
  col: number;
  row: number;
  /** Base plate colour already filled for this tile (hex string). */
  color: string;
  seam: number;
  rand: () => number;
  palette: Palette;
}

export function drawTilePattern(g: G, pattern: FloorPattern, ctx: TileContext): void {
  const { x, y, col, row, color, seam, rand, palette } = ctx;
  const accent = hexInt(palette.accent);
  switch (pattern) {
    case 'plates':
      g.fillStyle(lighten(color, 0.08), 1).fillRect(x, y, T, 1.5);
      g.fillStyle(seam, 0.7).fillRect(x, y + T - 1.5, T, 1.5).fillRect(x + T - 1.5, y, 1.5, T);
      break;
    case 'lattice':
      g.fillStyle(seam, 0.55).fillRect(x, y + T - 1, T, 1).fillRect(x + T - 1, y, 1, T);
      g.fillStyle(lighten(color, 0.1), 0.35).fillRect(x + T / 2, y, 1, T).fillRect(x, y + T / 2, T, 1);
      if ((col + row) % 3 === 0) g.fillStyle(accent, 0.35).fillCircle(x + T / 2, y + T / 2, 1.2);
      break;
    case 'flagstone': {
      g.fillStyle(seam, 0.9).fillRect(x, y, T, T);
      const inset = 1.5 + rand() * 2;
      const w = T - inset * 2 - rand() * 4;
      const h = T - inset * 2 - rand() * 4;
      const tone = rand() < 0.5 ? lighten(color, 0.05) : darken(color, 0.06);
      g.fillStyle(tone, 1).fillRoundedRect(x + inset, y + inset, w, h, 4);
      g.fillStyle(lighten(color, 0.14), 0.55).fillRect(x + inset + 2, y + inset + 1, w - 4, 1.5);
      break;
    }
    case 'grating': {
      g.fillStyle(lighten(color, 0.12), 0.6).fillRect(x, y, T, 1.5).fillRect(x, y, 1.5, T);
      g.fillStyle(seam, 0.85).fillRect(x, y + T - 1.5, T, 1.5).fillRect(x + T - 1.5, y, 1.5, T);
      for (let k = 0; k < 3; k++) g.fillStyle(seam, 0.55).fillRect(x + 5, y + 6 + k * 8, T - 10, 3);
      g.fillStyle(lighten(color, 0.25), 0.7).fillCircle(x + 3.5, y + 3.5, 1).fillCircle(x + T - 3.5, y + 3.5, 1).fillCircle(x + 3.5, y + T - 3.5, 1).fillCircle(x + T - 3.5, y + T - 3.5, 1);
      break;
    }
    case 'crystal': {
      const light = lighten(color, 0.16);
      g.lineStyle(1, light, 0.35);
      if ((col + row) % 2 === 0) g.lineBetween(x, y, x + T, y + T);
      else g.lineBetween(x + T, y, x, y + T);
      g.lineStyle(1, seam, 0.5).lineBetween(x + T * 0.6, y, x + T * 0.3, y + T);
      if (rand() < 0.14) {
        poly(g, [[x + 4, y + T - 4], [x + T * 0.55, y + 5], [x + T - 5, y + T * 0.6]], accent, 0.14);
        g.fillStyle(0xffffff, 0.6).fillCircle(x + T * 0.55, y + 7, 0.9);
      }
      break;
    }
    case 'organic': {
      const moss = shiftHue(palette.floor, 70, 0.14, 0.05);
      const soil = darken(color, 0.12);
      g.fillStyle(soil, 0.5).fillEllipse(x + rand() * T, y + rand() * T, 10 + rand() * 12, 6 + rand() * 6);
      if (rand() < 0.5) g.fillStyle(moss, 0.55).fillEllipse(x + rand() * T, y + rand() * T, 12 + rand() * 10, 7 + rand() * 5);
      if (rand() < 0.3) polyline(g, [[x + rand() * T, y + rand() * T], [x + rand() * T, y + rand() * T], [x + rand() * T, y + rand() * T]], 1, seam, 0.6);
      break;
    }
    case 'slabs': {
      // 2x2-tile slabs: one tone per slab, seams only on slab boundaries, a rune line on some.
      const slabTone = ((col >> 1) * 3 + (row >> 1) * 5) % 4 === 0 ? lighten(color, 0.05) : hexInt(color);
      g.fillStyle(slabTone, 0.9).fillRect(x, y, T, T);
      if (col % 2 === 0) g.fillStyle(seam, 0.9).fillRect(x, y, 2, T);
      if (row % 2 === 0) g.fillStyle(seam, 0.9).fillRect(x, y, T, 2);
      if (col % 2 === 1 && row % 2 === 1 && ((col >> 1) + (row >> 1)) % 5 === 0) {
        g.lineStyle(1, accent, 0.45).lineBetween(x - T + 8, y, x + T - 8, y);
      }
      break;
    }
    case 'boards': {
      const plank = T / 3;
      for (let k = 0; k < 3; k++) {
        const tone = (k + col + row) % 3 === 0 ? lighten(color, 0.06) : (k + col) % 2 === 0 ? hexInt(color) : darken(color, 0.05);
        g.fillStyle(tone, 1).fillRect(x, y + k * plank, T, plank);
        g.fillStyle(seam, 0.75).fillRect(x, y + k * plank + plank - 1, T, 1);
        const joint = x + ((col * 11 + k * 7 + row * 3) % 3) * (T / 3) + 4;
        g.fillStyle(seam, 0.6).fillRect(joint, y + k * plank, 1, plank);
      }
      // warm wash so lantern worlds read warm even where no lamp is near
      g.fillStyle(hexInt(palette.accentSoft), 0.03).fillRect(x, y, T, T);
      break;
    }
  }
}

/** Derived colours for the world-title stencil so it sits in the floor instead of on it. */
export function stencilColors(palette: Palette): { ink: string; glow: string } {
  return { ink: intToHex(mix(palette.floor, palette.accent, 0.55)), glow: palette.accent };
}
