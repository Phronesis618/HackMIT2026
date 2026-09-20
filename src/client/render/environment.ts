/**
 * Environment art: backdrop (gradient sky, nebula colour, stars, three-depth silhouettes
 * with rim light), floor plating with cracks and runes, shaded walls and light pools.
 * Palettes come from ArtRecipe; extra colour is DERIVED (hue shifts of the accent) so every
 * theme keeps its identity while looking far richer than flat ink.
 */
import type { Palette, RoomProp, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import type { MotifId } from '../../shared/registry';
import { darken, hexInt, intToHex, lighten, mix, shiftHue } from './color';
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

/** Sky gradient + nebula + stars + layered silhouettes framing the room. */
export function drawBackdrop(g: G, roomW: number, roomH: number, palette: Palette, skyline: MotifId, seed: number): void {
  const rand = rng(seed);
  const pad = BACKDROP_PAD;
  const left = -pad;
  const top = -pad;
  const width = roomW + pad * 2;
  const height = roomH + pad * 2;

  // Gradient sky: warm/cool hue-shifted accent at the top fading into the ink background.
  const skyTop = intToHex(shiftHue(palette.accent, -30, 0.08, -0.46));
  const skyMid = intToHex(mix(palette.background, palette.accentSoft, 0.2));
  const bands = 36;
  for (let i = 0; i < bands; i++) {
    const f = i / (bands - 1);
    const color = f < 0.5 ? mix(skyTop, skyMid, f * 2) : mix(skyMid, palette.background, (f - 0.5) * 2);
    g.fillStyle(color, 1).fillRect(left, top + (height * i) / bands, width, height / bands + 1);
  }
  // Nebula blooms: complementary hue blobs for colour depth.
  for (let i = 0; i < 7; i++) {
    const hue = i % 2 === 0 ? 140 : -60;
    const color = shiftHue(palette.accent, hue, 0.1, 0);
    const x = left + rand() * width;
    const y = top + rand() * height * 0.6;
    const rx = 120 + rand() * 220;
    for (let k = 3; k >= 1; k--) g.fillStyle(color, 0.035 * k).fillEllipse(x, y, rx * (k / 3), rx * 0.55 * (k / 3));
  }
  // Horizon glow behind the room.
  for (let k = 5; k >= 1; k--) {
    g.fillStyle(hexInt(palette.accent), 0.035 * k).fillEllipse(roomW / 2, roomH / 2, roomW * (0.6 + k * 0.22), roomH * (0.6 + k * 0.22));
  }
  // Stars and coloured motes.
  for (let i = 0; i < 140; i++) {
    const x = left + rand() * width;
    const y = top + rand() * height;
    const r = rand() < 0.85 ? 0.8 + rand() * 0.9 : 1.6 + rand();
    const colored = rand() < 0.25;
    g.fillStyle(colored ? hexInt(palette.accentSoft) : 0xffffff, colored ? 0.6 : 0.25 + rand() * 0.55).fillCircle(x, y, r);
  }
  // Three depths of silhouettes with accent rim light on the near layer.
  drawSilhouettes(g, skyline, roomW, roomH, palette, rand, 'far');
  drawSilhouettes(g, skyline, roomW, roomH, palette, rand, 'mid');
  drawSilhouettes(g, skyline, roomW, roomH, palette, rand, 'near');
}

function drawSilhouettes(
  g: G,
  motif: MotifId,
  roomW: number,
  roomH: number,
  palette: Palette,
  rand: () => number,
  depth: 'far' | 'mid' | 'near',
): void {
  const pad = BACKDROP_PAD;
  const left = -pad;
  const right = roomW + pad;
  const scale = depth === 'far' ? 0.55 : depth === 'mid' ? 0.8 : 1.05;
  const alpha = depth === 'far' ? 0.4 : depth === 'mid' ? 0.6 : 0.9;
  const ink = depth === 'far' ? mix(palette.wall, palette.accentSoft, 0.35) : depth === 'mid' ? mix(palette.wall, palette.background, 0.35) : darken(palette.wall, 0.45);
  const rim = hexInt(palette.accent);
  const rimAlpha = depth === 'near' ? 0.7 : depth === 'mid' ? 0.35 : 0.15;
  const topY = -12 - (depth === 'far' ? 120 : depth === 'mid' ? 60 : 0);
  const bottomY = roomH + 12 + (depth === 'far' ? 120 : depth === 'mid' ? 60 : 0);

  const columns = (draw: (x: number, y: number, up: boolean) => void, spacing: number): void => {
    for (let x = left; x < right; x += spacing * (0.7 + rand() * 0.6)) {
      draw(x, topY, true);
      draw(x + spacing * 0.4, bottomY, false);
    }
  };

  switch (motif) {
    case 'spires':
      columns((x, y, up) => {
        const h = (90 + rand() * 170) * scale;
        const w = (26 + rand() * 30) * scale;
        const dir = up ? -1 : 1;
        g.fillStyle(ink, alpha).fillTriangle(x, y, x + w / 2, y + dir * h, x + w, y);
        g.fillStyle(ink, alpha).fillRect(x + w * 0.3, y, w * 0.4, dir * 14);
        g.lineStyle(1.5, rim, rimAlpha).lineBetween(x, y, x + w / 2, y + dir * h);
        g.fillStyle(rim, rimAlpha).fillCircle(x + w / 2, y + dir * h, 1.5 * scale);
        // windows
        for (let k = 1; k < 4; k++) g.fillStyle(hexInt(palette.accentSoft), rimAlpha * 0.6).fillRect(x + w / 2 - 1.5, y + dir * (h * k) / 5, 3, 4);
      }, 70);
      break;
    case 'arches':
      columns((x, y, up) => {
        const r = (50 + rand() * 40) * scale;
        const dir = up ? Math.PI : 0;
        g.lineStyle(7 * scale, ink, alpha);
        g.beginPath();
        g.arc(x + r, y, r, dir, dir + Math.PI, false);
        g.strokePath();
        g.lineStyle(1.5, rim, rimAlpha);
        g.beginPath();
        g.arc(x + r, y, r + 4 * scale, dir, dir + Math.PI, false);
        g.strokePath();
        g.fillStyle(ink, alpha).fillRect(x - 6, y, 12, up ? -40 * scale : 40 * scale).fillRect(x + r * 2 - 6, y, 12, up ? -40 * scale : 40 * scale);
      }, 150);
      break;
    case 'cables':
      for (let i = 0; i < 7; i++) {
        const y0 = topY - rand() * pad * 0.7;
        const sag = 40 + rand() * 60;
        g.lineStyle(2 * scale, ink, alpha);
        let px = left;
        let py = y0;
        for (let t = 0.05; t <= 1.001; t += 0.05) {
          const x = left + t * (right - left);
          const y = y0 + Math.sin(t * Math.PI) * sag;
          g.lineBetween(px, py, x, y);
          px = x;
          py = y;
        }
        for (let k = 0; k < 6; k++) {
          const t = rand();
          g.fillStyle(rim, rimAlpha).fillCircle(left + t * (right - left), y0 + Math.sin(t * Math.PI) * sag, 1.8 * scale);
        }
      }
      columns((x, y, up) => {
        const h = (60 + rand() * 90) * scale;
        const dir = up ? -1 : 1;
        g.fillStyle(ink, alpha).fillRect(x, y, 10 * scale, dir * h);
        g.fillStyle(ink, alpha).fillRect(x - 12 * scale, y + dir * h, 34 * scale, dir * 6);
        g.lineStyle(1, rim, rimAlpha).lineBetween(x, y, x, y + dir * h);
      }, 180);
      break;
    case 'crystals':
      for (let i = 0; i < 34; i++) {
        const x = left + rand() * (right - left);
        const up = rand() < 0.5;
        const y = up ? topY : bottomY;
        const s = (12 + rand() * 30) * scale;
        const dir = up ? -1 : 1;
        const tint = i % 3 === 0 ? shiftHue(palette.accent, 120, 0, -0.1) : ink;
        g.fillStyle(tint, alpha * 0.9).fillTriangle(x - s, y, x, y + dir * s * 2.2, x + s, y);
        g.fillStyle(lighten(intToHex(tint), 0.25), alpha * 0.9).fillTriangle(x - s * 0.3, y, x, y + dir * s * 2.2, x + s * 0.5, y);
        g.lineStyle(1, rim, rimAlpha).lineBetween(x, y + dir * s * 2.1, x, y);
      }
      break;
    case 'roots':
      columns((x, y, up) => {
        const dir = up ? -1 : 1;
        let px = x;
        let py = y;
        g.lineStyle(6 * scale, ink, alpha);
        for (let k = 1; k <= 6; k++) {
          const nx = px + (rand() - 0.5) * 40 * scale;
          const ny = y + dir * k * 26 * scale;
          g.lineBetween(px, py, nx, ny);
          if (k % 2 === 0) {
            g.lineStyle(2 * scale, ink, alpha).lineBetween(nx, ny, nx + (rand() - 0.5) * 60 * scale, ny + dir * 20 * scale);
            g.lineStyle(6 * scale, ink, alpha);
          }
          px = nx;
          py = ny;
        }
        g.fillStyle(rim, rimAlpha).fillCircle(px, py, 2 * scale);
      }, 110);
      break;
    case 'monoliths':
      columns((x, y, up) => {
        const h = (100 + rand() * 140) * scale;
        const w = (28 + rand() * 30) * scale;
        const dir = up ? -1 : 1;
        g.fillStyle(ink, alpha).fillRect(x, y, w, dir * h);
        g.fillStyle(lighten(intToHex(ink), 0.12), alpha).fillRect(x, y, w * 0.3, dir * h);
        g.lineStyle(1.5, rim, rimAlpha).lineBetween(x + w / 2, y + dir * h * 0.2, x + w / 2, y + dir * h * 0.8);
        g.fillStyle(rim, rimAlpha * 0.6).fillRect(x + 4, y + dir * h * 0.35, w - 8, 3);
      }, 110);
      break;
    case 'lanterns':
      for (let i = 0; i < 46; i++) {
        const x = left + rand() * (right - left);
        const up = rand() < 0.5;
        const y = up ? topY - rand() * pad * 0.6 : bottomY + rand() * pad * 0.6;
        const warm = hexInt(palette.accentSoft);
        g.lineStyle(1, ink, alpha * 0.8).lineBetween(x, y - 30 * scale, x, y);
        g.fillStyle(warm, 0.08 * scale).fillCircle(x, y, 22 * scale);
        g.fillStyle(ink, alpha).fillRect(x - 4 * scale, y - 6 * scale, 8 * scale, 12 * scale);
        g.fillStyle(warm, 0.85).fillRect(x - 2 * scale, y - 3 * scale, 4 * scale, 6 * scale);
      }
      break;
    case 'ruined_machinery':
      for (let i = 0; i < 18; i++) {
        const x = left + rand() * (right - left);
        const up = rand() < 0.5;
        const y = up ? topY - rand() * pad * 0.5 : bottomY + rand() * pad * 0.5;
        const r = (18 + rand() * 34) * scale;
        g.lineStyle(4 * scale, ink, alpha).strokeCircle(x, y, r);
        g.lineStyle(2 * scale, ink, alpha).strokeCircle(x, y, r * 0.55);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          g.lineStyle(3 * scale, ink, alpha).lineBetween(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 7 * scale), y + Math.sin(a) * (r + 7 * scale));
        }
        g.lineStyle(1, rim, rimAlpha).strokeCircle(x, y, r * 0.55);
        // pipes
        g.lineStyle(5 * scale, ink, alpha).lineBetween(x + r, y, x + r + 60 * scale, y);
        g.fillStyle(rim, rimAlpha * 0.6).fillCircle(x + r + 60 * scale, y, 2.5 * scale);
      }
      break;
  }
}

/** Floor plating with subtle hue variation, seams, cracks and rare glowing runes. */
export function drawFloor(g: G, room: RoomSpec, palette: Palette, seed: number): void {
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
      // plate bevel
      g.fillStyle(lighten(color, 0.08), 1).fillRect(x, y, TILE_SIZE, 1.5);
      g.fillStyle(seam, 0.7).fillRect(x, y + TILE_SIZE - 1.5, TILE_SIZE, 1.5).fillRect(x + TILE_SIZE - 1.5, y, 1.5, TILE_SIZE);
      // shadow where floor meets a wall above (gives the wall height)
      if (room.tiles[row - 1]?.[col] === '#') {
        for (let k = 0; k < 4; k++) g.fillStyle(0x000000, 0.22 - k * 0.05).fillRect(x, y + k * 3, TILE_SIZE, 3);
      }
      if (line[col - 1] === '#') g.fillStyle(0x000000, 0.12).fillRect(x, y, 5, TILE_SIZE);
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
      if (ch === 'X') {
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

/** Walls with a lit top cap, shaded face, accent rim and occasional panel lights. */
export function drawWalls(g: G, room: RoomSpec, palette: Palette, seed: number): void {
  const rand = rng(seed + 13);
  const face = hexInt(palette.wall);
  const cap = mix(palette.wall, palette.text, 0.18);
  const capEdge = mix(palette.wall, palette.text, 0.35);
  const rim = hexInt(palette.wallEdge);
  const panel = hexInt(palette.accentSoft);
  for (let row = 0; row < room.height; row++) {
    const line = room.tiles[row] ?? '';
    for (let col = 0; col < room.width; col++) {
      if (line[col] !== '#') continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const below = room.tiles[row + 1]?.[col];
      const above = room.tiles[row - 1]?.[col];
      const floorBelow = below !== undefined && below !== '#' && below !== ' ';
      const floorAbove = above !== undefined && above !== '#' && above !== ' ';
      const floorLeft = line[col - 1] !== undefined && line[col - 1] !== '#' && line[col - 1] !== ' ';
      const floorRight = line[col + 1] !== undefined && line[col + 1] !== '#' && line[col + 1] !== ' ';
      // top cap
      g.fillStyle(cap, 1).fillRect(x, y, TILE_SIZE, TILE_SIZE);
      g.fillStyle(capEdge, 0.5).fillRect(x + 2, y + 2, TILE_SIZE - 4, 1.5);
      if (floorBelow) {
        // visible front face (the tile "stands" above the floor south of it)
        g.fillStyle(face, 1).fillRect(x, y + TILE_SIZE * 0.45, TILE_SIZE, TILE_SIZE * 0.55);
        g.fillStyle(darken(palette.wall, 0.35), 1).fillRect(x, y + TILE_SIZE - 6, TILE_SIZE, 6);
        g.fillStyle(rim, 0.95).fillRect(x, y + TILE_SIZE - 3, TILE_SIZE, 3);
        g.fillStyle(rim, 0.25).fillRect(x, y + TILE_SIZE - 7, TILE_SIZE, 4);
        if (rand() < 0.28) g.fillStyle(panel, 0.85).fillRect(x + 10, y + TILE_SIZE * 0.6, 12, 3);
      }
      if (floorAbove) g.fillStyle(rim, 0.4).fillRect(x, y, TILE_SIZE, 2);
      if (floorLeft) g.fillStyle(rim, 0.35).fillRect(x, y, 2, TILE_SIZE);
      if (floorRight) g.fillStyle(rim, 0.35).fillRect(x + TILE_SIZE - 2, y, 2, TILE_SIZE);
      // cap detail
      if (rand() < 0.2) g.fillStyle(capEdge, 0.45).fillRect(x + 6 + rand() * 12, y + 6 + rand() * 12, 6, 6);
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
  for (const exit of room.exits) {
    const c = tileToWorld(exit.x, exit.y);
    pool(c.x, c.y, accent, 64, 1);
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

/** Ambient drifting motes (redrawn every frame; purely visual). */
export function drawMotes(g: G, motes: Mote[], t: number, roomW: number, roomH: number, palette: Palette): void {
  g.clear();
  const warm = hexInt(palette.accentSoft);
  const cool = hexInt(palette.accent);
  for (const m of motes) {
    const y = ((m.y - t * m.speed) % roomH + roomH) % roomH;
    const x = ((m.x + Math.sin(t * 0.6 + m.phase) * 12) % roomW + roomW) % roomW;
    const a = 0.25 + 0.25 * Math.sin(t * 2 + m.phase);
    g.fillStyle(m.warm ? warm : cool, a).fillCircle(x, y, m.r);
  }
}

export function propHasLight(prop: RoomProp): boolean {
  return prop.propId === 'lantern' || prop.propId === 'crystal_cluster' || prop.propId === 'terminal' || prop.propId === 'anchor_pedestal';
}
