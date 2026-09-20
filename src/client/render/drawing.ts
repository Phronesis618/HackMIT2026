import type Phaser from 'phaser';
import type { Palette } from '../../shared/contracts';
import { TILE_SIZE } from '../../shared/conventions';
import { PROP_INFO, type MotifId, type PropId } from '../../shared/registry';
import { hexToInt } from '../../shared/tokens';

export type G = Phaser.GameObjects.Graphics;

export function drawSanctuary(g: G, roomW: number, roomH: number, palette: Palette, portal?: { x: number; y: number }): void {
  const edge = hexToInt(palette.wallEdge);
  const warm = hexToInt(palette.accentSoft);
  const cyan = hexToInt(palette.accent);
  const cx = roomW / 2;
  g.fillStyle(0x000000, 0.3).fillEllipse(cx, roomH / 2 + 12, 264, 130);
  g.lineStyle(1, edge, 0.4).strokeEllipse(cx, roomH / 2, 264, 126);
  g.lineStyle(1, cyan, 0.16).strokeEllipse(cx, roomH / 2, 238, 108);
  g.lineBetween(cx - 142, roomH / 2, cx + 142, roomH / 2);
  for (const x of [48, roomW - 48]) {
    g.fillStyle(warm, 0.025).fillEllipse(x, roomH / 2, 140, roomH - 70);
    g.lineStyle(2, edge, 0.65).lineBetween(x, 76, x, roomH - 60);
    for (let y = 84; y < roomH - 60; y += 38) {
      g.fillStyle(warm, 0.75).fillRect(x - 2, y, 4, 14);
      g.fillStyle(warm, 0.04).fillCircle(x, y + 7, 26);
    }
  }
  // Empty frames are architecture; actual keepsakes live in the DOM memory wall.
  const wallX = roomW - 242;
  g.fillStyle(0x050910, 0.95).fillRoundedRect(wallX, 6, 164, 22, 3);
  g.lineStyle(1, warm, 0.35).strokeRoundedRect(wallX, 6, 164, 22, 3);
  for (let i = 0; i < 5; i++) {
    g.lineStyle(1, edge, 0.8).strokeRect(wallX + 10 + i * 30, 11, 22, 12);
  }
  if (!portal) return;
  g.lineStyle(3, edge, 0.9).strokeEllipse(portal.x, portal.y, 94, 48);
  g.lineStyle(1, cyan, 0.35).strokeEllipse(portal.x, portal.y, 112, 60);
  for (const side of [-1, 1]) {
    const x = portal.x + side * 45;
    g.fillStyle(hexToInt(palette.wall), 1).fillRoundedRect(x - 7, portal.y - 38, 14, 46, 4);
    g.fillStyle(cyan, 0.85).fillRect(x - 2, portal.y - 32, 3, 28);
    g.lineStyle(1, warm, 0.5).lineBetween(cx + side * 24, roomH / 2 + 76, cx + side * 24, portal.y - 45);
  }
}

export function drawMotif(g: G, motif: MotifId, x: number, y: number, palette: Palette): void {
  const edge = hexToInt(palette.wallEdge);
  const accent = hexToInt(palette.accent);
  g.lineStyle(1, edge, 0.35);
  switch (motif) {
    case 'spires':
      g.strokeTriangle(x - 12, y + 9, x, y - 13, x + 12, y + 9);
      g.lineBetween(x, y - 13, x, y + 9);
      break;
    case 'arches':
      g.beginPath().arc(x, y + 6, 12, Math.PI, 0).strokePath();
      g.lineBetween(x - 12, y + 6, x - 12, y + 12).lineBetween(x + 12, y + 6, x + 12, y + 12);
      break;
    case 'cables':
      for (let i = 0; i < 3; i++) {
        g.lineBetween(x - 14, y - 8 + i * 4, x + 4, y - 8 + i * 4);
        g.lineBetween(x + 4, y - 8 + i * 4, x + 12, y + i * 4);
      }
      break;
    case 'crystals':
      g.strokeTriangle(x - 10, y, x, y - 12, x + 4, y + 10);
      g.strokeTriangle(x + 2, y, x + 11, y - 8, x + 9, y + 9);
      break;
    case 'roots':
      g.lineBetween(x - 14, y + 10, x + 12, y - 10);
      g.lineBetween(x - 6, y + 4, x - 12, y - 8);
      g.lineBetween(x + 4, y - 4, x + 13, y + 5);
      break;
    case 'monoliths':
      g.strokeRect(x - 6, y - 13, 12, 26);
      g.lineStyle(1, accent, 0.25).lineBetween(x, y - 8, x, y + 8);
      break;
    case 'lanterns':
      g.fillStyle(hexToInt(palette.accentSoft), 0.035).fillCircle(x, y, 15);
      g.strokeCircle(x, y, 7);
      g.lineBetween(x, y - 14, x, y - 7);
      break;
    case 'ruined_machinery':
      g.strokeCircle(x, y, 11);
      g.strokeRect(x - 4, y - 4, 8, 8);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        g.lineBetween(x + Math.cos(a) * 7, y + Math.sin(a) * 7, x + Math.cos(a) * 15, y + Math.sin(a) * 15);
      }
      break;
  }
}

export function drawProp(g: G, propId: PropId, cx: number, cy: number, palette: Palette, glow: number): void {
  const accent = hexToInt(palette.accent);
  const soft = hexToInt(palette.accentSoft);
  const wall = hexToInt(palette.wall);
  const edge = hexToInt(palette.wallEdge);
  const half = TILE_SIZE / 2;
  const info = PROP_INFO[propId];
  if (info.blocksMovement) {
    // Footprint: the exact tiles that block, as a dark base plate with a crisp edge, then a
    // contact shadow. Anything without this plate can be walked through.
    const fw = info.footprint.w * TILE_SIZE;
    const fh = info.footprint.h * TILE_SIZE;
    g.fillStyle(0x000000, 0.34).fillRoundedRect(cx - half + 2, cy - half + 2, fw - 4, fh - 4, 5);
    g.lineStyle(1.5, 0x000000, 0.7).strokeRoundedRect(cx - half + 2, cy - half + 2, fw - 4, fh - 4, 5);
    g.lineStyle(1, edge, 0.45).strokeRoundedRect(cx - half + 3.5, cy - half + 3.5, fw - 7, fh - 7, 4);
    g.fillStyle(0x000000, 0.4).fillEllipse(cx - half + fw / 2 + 2, cy - half + fh - 6, fw - 8, 12);
    if (propId === 'monolith_shard') cy += half; // stands on both of its tiles
  } else {
    g.fillStyle(0x000000, 0.2).fillEllipse(cx + 3, cy + 12, 26, 9);
  }
  switch (propId) {
    case 'pillar':
      g.fillStyle(wall, 1).fillRect(cx - 10, cy - 22, 20, 36);
      g.fillStyle(edge, 1).fillRect(cx - 12, cy - 26, 24, 6);
      g.lineStyle(1, edge, 0.6).strokeRect(cx - 10, cy - 22, 20, 36);
      break;
    case 'crate':
      g.fillStyle(wall, 1).fillRect(cx - 12, cy - 12, 24, 24);
      g.lineStyle(1.5, edge, 0.8).strokeRect(cx - 12, cy - 12, 24, 24);
      g.lineBetween(cx - 12, cy - 12, cx + 12, cy + 12).lineBetween(cx + 12, cy - 12, cx - 12, cy + 12);
      break;
    case 'terminal':
      g.fillStyle(wall, 1).fillRect(cx - 13, cy - 8, 26, 22);
      g.fillStyle(accent, 0.25 + glow * 0.4).fillRect(cx - 15, cy - 20, 30, 14);
      g.fillStyle(accent, 0.9).fillRect(cx - 11, cy - 17, 22, 8);
      g.lineStyle(1, edge, 0.8).strokeRect(cx - 13, cy - 8, 26, 22);
      break;
    case 'lantern':
      g.fillStyle(soft, 0.08 + glow * 0.12).fillCircle(cx, cy, 30);
      g.fillStyle(soft, 0.18 + glow * 0.2).fillCircle(cx, cy, 16);
      g.fillStyle(wall, 1).fillRoundedRect(cx - 6, cy - 8, 12, 16, 3);
      g.fillStyle(soft, 1).fillRoundedRect(cx - 3, cy - 5, 6, 10, 2);
      g.lineStyle(1, edge, 0.8).lineBetween(cx, cy - 5, cx, cy - 16);
      break;
    case 'crystal_cluster':
      g.fillStyle(accent, 0.12 + glow * 0.2).fillCircle(cx, cy, 22);
      g.fillStyle(accent, 0.85).fillTriangle(cx - 10, cy + 10, cx - 3, cy - 14, cx + 4, cy + 10);
      g.fillStyle(soft, 0.9).fillTriangle(cx + 2, cy + 10, cx + 8, cy - 6, cx + 14, cy + 10);
      g.fillStyle(accent, 0.7).fillTriangle(cx - 14, cy + 10, cx - 11, cy - 2, cx - 6, cy + 10);
      break;
    case 'root_mass':
      g.fillStyle(wall, 1);
      g.fillCircle(cx, cy + 2, 13).fillCircle(cx + 22, cy - 2, 15).fillCircle(cx + 40, cy + 4, 11);
      g.lineStyle(2, edge, 0.5);
      g.lineBetween(cx - 8, cy + 12, cx + 48, cy - 6);
      break;
    case 'cable_bundle':
      g.lineStyle(2, edge, 0.9);
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(cx - half - 8, cy - 14 + i * 4);
        for (let t = 0; t <= 1.001; t += 0.1) {
          const x = cx - half - 8 + t * (TILE_SIZE + 16);
          const y = cy - 14 + i * 4 + Math.sin(t * Math.PI) * (12 + i * 3);
          g.lineTo(x, y);
        }
        g.strokePath();
      }
      g.fillStyle(accent, 0.9).fillCircle(cx + 6, cy + 1, 2);
      break;
    case 'monolith_shard':
      g.fillStyle(wall, 1).fillTriangle(cx - 10, cy + 30, cx - 2, cy - 34, cx + 12, cy + 30);
      g.lineStyle(1.5, accent, 0.35 + glow * 0.4).lineBetween(cx - 2, cy - 30, cx + 3, cy + 26);
      break;
    case 'anchor_pedestal':
      g.fillStyle(wall, 1).fillEllipse(cx, cy + 5, 38, 24);
      g.lineStyle(2, accent, 0.9).strokeCircle(cx, cy, 14);
      g.lineStyle(1, accent, 0.5).strokeCircle(cx, cy, 22);
      g.fillStyle(accent, 0.12 + glow * 0.2).fillCircle(cx, cy, 22);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        g.lineBetween(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17, cx + Math.cos(a) * 27, cy + Math.sin(a) * 27);
      }
      break;
  }
}

/** Background silhouettes framing the room, driven by the skyline motif. */
export function drawSkyline(g: G, motif: MotifId, roomW: number, roomH: number, palette: Palette): void {
  const ink = hexToInt(palette.wall);
  const edge = hexToInt(palette.wallEdge);
  const pad = 220;
  const left = -pad;
  const right = roomW + pad;
  const top = -pad;
  const bottom = roomH + pad;
  g.fillStyle(hexToInt(palette.background), 1).fillRect(left, top, right - left, bottom - top);

  // deterministic pseudo-random for placement
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  switch (motif) {
    case 'spires':
      for (let x = left; x < right; x += 60 + rnd() * 50) {
        const h = 80 + rnd() * 160;
        g.fillStyle(ink, 0.55).fillTriangle(x, top + pad, x + 22, top + pad - h, x + 44, top + pad);
        g.fillStyle(ink, 0.55).fillTriangle(x + 10, bottom - pad, x + 30, bottom - pad + h * 0.8, x + 50, bottom - pad);
      }
      break;
    case 'arches':
      g.lineStyle(6, ink, 0.7);
      for (let x = left + 30; x < right; x += 140) {
        g.beginPath();
        g.arc(x + 60, top + pad + 10, 70, Math.PI, 0, false);
        g.strokePath();
        g.beginPath();
        g.arc(x + 60, bottom - pad - 10, 70, 0, Math.PI, false);
        g.strokePath();
      }
      break;
    case 'cables':
      g.lineStyle(2, edge, 0.35);
      for (let i = 0; i < 9; i++) {
        const y0 = top + rnd() * pad * 0.8;
        g.beginPath();
        g.moveTo(left, y0);
        for (let t = 0; t <= 1.001; t += 0.05) {
          g.lineTo(left + t * (right - left), y0 + Math.sin(t * Math.PI) * (40 + rnd() * 30));
        }
        g.strokePath();
      }
      break;
    case 'crystals':
      for (let i = 0; i < 26; i++) {
        const x = left + rnd() * (right - left);
        const y = rnd() < 0.5 ? top + rnd() * pad : bottom - rnd() * pad;
        const s = 10 + rnd() * 26;
        g.fillStyle(ink, 0.7).fillTriangle(x - s, y + s, x, y - s * 1.6, x + s, y + s);
        g.lineStyle(1, edge, 0.4).lineBetween(x, y - s * 1.4, x, y + s);
      }
      break;
    case 'roots':
      g.lineStyle(5, ink, 0.7);
      for (let i = 0; i < 10; i++) {
        const x0 = left + rnd() * (right - left);
        g.beginPath();
        g.moveTo(x0, bottom);
        for (let t = 0; t <= 1.001; t += 0.1) {
          g.lineTo(x0 + Math.sin(t * 6 + i) * 30, bottom - t * (pad + 40));
        }
        g.strokePath();
      }
      break;
    case 'monoliths':
      for (let x = left; x < right; x += 90 + rnd() * 60) {
        const h = 120 + rnd() * 120;
        g.fillStyle(ink, 0.65).fillRect(x, top + pad - h, 40, h);
        g.fillStyle(ink, 0.65).fillRect(x + 20, bottom - pad, 36, h * 0.7);
      }
      break;
    case 'lanterns':
      for (let i = 0; i < 40; i++) {
        const x = left + rnd() * (right - left);
        const y = rnd() < 0.5 ? top + rnd() * pad : bottom - rnd() * pad;
        g.fillStyle(hexToInt(palette.accentSoft), 0.08).fillCircle(x, y, 18);
        g.fillStyle(hexToInt(palette.accentSoft), 0.6).fillCircle(x, y, 2.5);
      }
      break;
    case 'ruined_machinery':
      g.lineStyle(3, ink, 0.7);
      for (let i = 0; i < 14; i++) {
        const x = left + rnd() * (right - left);
        const y = rnd() < 0.5 ? top + rnd() * pad : bottom - rnd() * pad;
        const r = 18 + rnd() * 30;
        g.strokeCircle(x, y, r);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.lineBetween(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
      }
      break;
  }
}

/** Soft rectangular vignette. */
export function drawVignette(g: G, roomW: number, roomH: number, strength: number, palette: Palette): void {
  const bg = hexToInt(palette.background);
  const band = 48;
  for (let i = 0; i < 4; i++) {
    const a = strength * (0.18 - i * 0.04);
    if (a <= 0) continue;
    const inset = i * band * 0.5;
    g.fillStyle(bg, a);
    g.fillRect(-band + inset, -band + inset, roomW + band * 2 - inset * 2, band);
    g.fillRect(-band + inset, roomH - inset, roomW + band * 2 - inset * 2, band);
    g.fillRect(-band + inset, -band + inset, band, roomH + band * 2 - inset * 2);
    g.fillRect(roomW - inset, -band + inset, band, roomH + band * 2 - inset * 2);
  }
}
