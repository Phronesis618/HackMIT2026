/**
 * Placeholder drawing primitives (Agent C replaces/extends these with real art).
 * Everything here is procedural vector art in the shared ink-and-neon palette, so the
 * intended layering and silhouettes are visible before any bitmap assets exist.
 */
import Phaser from 'phaser';
import type { Palette } from '../../shared/contracts';
import { TILE_SIZE } from '../../shared/conventions';
import type { MotifId, PropId } from '../../shared/registry';
import { hexToInt } from '../../shared/tokens';

export type G = Phaser.GameObjects.Graphics;

export function drawProp(g: G, propId: PropId, cx: number, cy: number, palette: Palette, glow: number): void {
  const accent = hexToInt(palette.accent);
  const soft = hexToInt(palette.accentSoft);
  const wall = hexToInt(palette.wall);
  const edge = hexToInt(palette.wallEdge);
  const half = TILE_SIZE / 2;
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
      g.fillStyle(soft, 1).fillCircle(cx, cy, 5);
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
      g.lineStyle(2, accent, 0.9).strokeCircle(cx, cy, 14);
      g.lineStyle(1, accent, 0.5).strokeCircle(cx, cy, 22);
      g.fillStyle(accent, 0.12 + glow * 0.2).fillCircle(cx, cy, 22);
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
