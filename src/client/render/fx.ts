/**
 * Procedural combat effects. Every function redraws ONE Graphics object for animation
 * progress `t` in [0, 1]; RoomScene owns the object and drives `t` with a single tween.
 * Layers: wide soft glow -> saturated body -> white-hot core, plus particles derived
 * deterministically from `seed` (visual randomness never touches gameplay).
 */
import Phaser from 'phaser';
import type { ClassId, EnemyId } from '../../shared/registry';
import { lighten } from './color';

export type G = Phaser.GameObjects.Graphics;

const TAU = Math.PI * 2;
const WHITE = 0xffffff;

/** Deterministic pseudo-random sequence for particle placement. */
function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280 || 17;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** 1 while t < hold, then fades to 0 by 1. */
const fade = (t: number, hold = 0.35): number => (t < hold ? 1 : 1 - (t - hold) / (1 - hold));

function arcStroke(g: G, x: number, y: number, r: number, a0: number, a1: number, width: number, color: number, alpha: number): void {
  if (alpha <= 0.005 || r <= 0.5) return;
  g.lineStyle(width, color, clamp01(alpha));
  g.beginPath();
  g.arc(x, y, r, a0, a1, false);
  g.strokePath();
}

function spark(g: G, x: number, y: number, angle: number, length: number, width: number, color: number, alpha: number): void {
  if (alpha <= 0.005) return;
  g.lineStyle(width, color, clamp01(alpha));
  g.lineBetween(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length);
}

// ---------------------------------------------------------------------------
// Player weapons
// ---------------------------------------------------------------------------

export interface SlashParams {
  facing: number;
  range: number;
  arc: number;
  color: number;
  classId: ClassId;
  seed: number;
}

/** Class weapon strike: sweeping crescent with glow, core and sparks. */
export function drawSlash(g: G, t: number, p: SlashParams): void {
  g.clear();
  const rand = rng(p.seed);
  const sweep = easeOut(clamp01(t / 0.45)); // blade travels across the arc first
  const alpha = fade(t, 0.3);
  const a0 = p.facing - p.arc / 2;
  const a1 = a0 + p.arc * sweep;
  const glow = lighten(intToHexSafe(p.color), 0.35);

  switch (p.classId) {
    case 'shade': {
      // Twin thin cuts, slightly offset, very fast and bright.
      for (const off of [-6, 6]) {
        arcStroke(g, off * Math.cos(p.facing + Math.PI / 2), off * Math.sin(p.facing + Math.PI / 2), p.range, a0, a1, 10, p.color, 0.18 * alpha);
        arcStroke(g, off * Math.cos(p.facing + Math.PI / 2), off * Math.sin(p.facing + Math.PI / 2), p.range, a0, a1, 3, glow, 0.9 * alpha);
        arcStroke(g, off * Math.cos(p.facing + Math.PI / 2), off * Math.sin(p.facing + Math.PI / 2), p.range - 2, a0, a1, 1.2, WHITE, alpha);
      }
      break;
    }
    case 'beacon': {
      // Pulse shot: a bolt travelling along the aim line with a trailing glow.
      const travel = easeOut(clamp01(t / 0.5)) * p.range;
      const bx = Math.cos(p.facing) * travel;
      const by = Math.sin(p.facing) * travel;
      g.lineStyle(8, p.color, 0.18 * alpha).lineBetween(0, 0, bx, by);
      g.lineStyle(3, glow, 0.7 * alpha).lineBetween(bx - Math.cos(p.facing) * 60, by - Math.sin(p.facing) * 60, bx, by);
      g.fillStyle(p.color, 0.35 * alpha).fillCircle(bx, by, 14);
      g.fillStyle(glow, 0.9 * alpha).fillCircle(bx, by, 7);
      g.fillStyle(WHITE, alpha).fillCircle(bx, by, 3);
      break;
    }
    case 'weaver': {
      // Plasma orb: a spinning ring of threads that widens into the cone.
      const reach = easeOut(clamp01(t / 0.5)) * p.range;
      const cx = Math.cos(p.facing) * reach * 0.6;
      const cy = Math.sin(p.facing) * reach * 0.6;
      g.fillStyle(p.color, 0.14 * alpha).fillCircle(cx, cy, 18 + reach * 0.15);
      for (let i = 0; i < 3; i++) {
        const spin = t * 9 + (i * TAU) / 3;
        arcStroke(g, cx, cy, 10 + reach * 0.12, spin, spin + 2.2, 2, glow, 0.85 * alpha);
      }
      g.fillStyle(WHITE, 0.9 * alpha).fillCircle(cx, cy, 3.5);
      arcStroke(g, 0, 0, p.range, a0, a1, 2, p.color, 0.35 * alpha);
      break;
    }
    default: {
      // Bastion arc-blade: heavy crescent, layered.
      arcStroke(g, 0, 0, p.range + 4, a0, a1, 18, p.color, 0.16 * alpha);
      arcStroke(g, 0, 0, p.range, a0, a1, 7, p.color, 0.75 * alpha);
      arcStroke(g, 0, 0, p.range, a0, a1, 3, glow, 0.95 * alpha);
      arcStroke(g, 0, 0, p.range - 3, a0, a1, 1.5, WHITE, alpha);
      arcStroke(g, 0, 0, p.range * 0.7, a0, a1, 2, p.color, 0.35 * alpha);
      break;
    }
  }

  // Sparks fly off the leading edge.
  const sparks = p.classId === 'shade' ? 10 : 7;
  for (let i = 0; i < sparks; i++) {
    const ang = a0 + p.arc * rand();
    const dist = p.range + easeOut(t) * (20 + rand() * 30);
    const size = 1 + rand() * 1.5;
    g.fillStyle(i % 3 === 0 ? WHITE : glow, alpha * (0.9 - rand() * 0.3));
    g.fillCircle(Math.cos(ang) * dist, Math.sin(ang) * dist, size * (1 - t * 0.6));
  }
}

export interface TrailParams {
  facing: number; // direction of travel
  color: number;
  classId: ClassId;
}

/** Dash: afterimages and speed lines trailing behind the direction of travel. */
export function drawDashTrail(g: G, t: number, p: TrailParams): void {
  g.clear();
  const alpha = fade(t, 0.15);
  const bx = -Math.cos(p.facing);
  const by = -Math.sin(p.facing);
  const px = -by; // perpendicular
  const py = bx;
  for (let i = 0; i < 4; i++) {
    const d = 12 + i * 15 + easeOut(t) * 18;
    const a = alpha * (0.55 - i * 0.12);
    const cx = bx * d;
    const cy = by * d;
    g.fillStyle(p.color, a * 0.55).fillEllipse(cx, cy, 30 - i * 3, 20 - i * 2);
    g.fillStyle(lighten(intToHexSafe(p.color), 0.5), a).fillEllipse(cx, cy, 14 - i * 2, 9 - i);
  }
  for (let i = -2; i <= 2; i++) {
    const off = i * 7;
    const len = 40 + Math.abs(i) * 6 + easeOut(t) * 30;
    g.lineStyle(1.5, i === 0 ? WHITE : p.color, alpha * (0.9 - Math.abs(i) * 0.2));
    g.lineBetween(px * off + bx * 8, py * off + by * 8, px * off + bx * len, py * off + by * len);
  }
  g.fillStyle(WHITE, alpha * 0.6).fillCircle(0, 0, 6 * (1 - t));
}

// ---------------------------------------------------------------------------
// Hits, deaths, telegraph resolution
// ---------------------------------------------------------------------------

export function drawImpact(g: G, t: number, color: number, seed: number, strength = 1): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.2);
  const r = (8 + easeOut(t) * 22) * strength;
  g.fillStyle(WHITE, alpha * 0.85 * (1 - t)).fillCircle(0, 0, 9 * strength * (1 - t * 0.5));
  g.lineStyle(3 * strength, color, alpha * 0.9).strokeCircle(0, 0, r);
  g.lineStyle(1, WHITE, alpha * 0.6).strokeCircle(0, 0, r * 0.7);
  for (let i = 0; i < 8; i++) {
    const ang = rand() * TAU;
    const len = (10 + rand() * 18) * strength;
    const d = easeOut(t) * (14 + rand() * 20) * strength;
    spark(g, Math.cos(ang) * d, Math.sin(ang) * d, ang, len * (1 - t), i % 2 ? 2 : 1.2, i % 3 === 0 ? WHITE : color, alpha);
  }
}

export function drawDefeat(g: G, t: number, color: number, radius: number, seed: number): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.25);
  const ring = radius * (0.6 + easeOut(t) * 2.2);
  g.fillStyle(color, 0.35 * alpha * (1 - t)).fillCircle(0, 0, radius * (1 - t * 0.6));
  g.fillStyle(WHITE, 0.9 * alpha * (1 - t)).fillCircle(0, 0, radius * 0.4 * (1 - t));
  g.lineStyle(3, color, alpha).strokeCircle(0, 0, ring);
  g.lineStyle(1.5, WHITE, alpha * 0.5).strokeCircle(0, 0, ring * 0.82);
  // shards
  for (let i = 0; i < 12; i++) {
    const ang = rand() * TAU;
    const d = radius * 0.5 + easeOut(t) * (radius * 2.6 + rand() * 40);
    const s = 2 + rand() * 4;
    const x = Math.cos(ang) * d;
    const y = Math.sin(ang) * d;
    g.fillStyle(i % 4 === 0 ? WHITE : color, alpha * (1 - t * 0.7));
    g.fillTriangle(x, y - s, x + s, y + s, x - s, y + s);
  }
}

export interface EnemyStrikeParams {
  kind: 'melee' | 'beam' | 'charge' | 'burst';
  facing: number;
  range: number;
  arc: number;
  color: number;
  seed: number;
}

/** The moment an enemy attack resolves (the telegraph fires). */
export function drawEnemyStrike(g: G, t: number, p: EnemyStrikeParams): void {
  g.clear();
  const alpha = fade(t, 0.25);
  const glow = lighten(intToHexSafe(p.color), 0.4);
  switch (p.kind) {
    case 'beam': {
      const len = p.range;
      const ex = Math.cos(p.facing) * len;
      const ey = Math.sin(p.facing) * len;
      g.lineStyle(26 * (1 - t * 0.5), p.color, 0.18 * alpha).lineBetween(0, 0, ex, ey);
      g.lineStyle(9 * (1 - t * 0.5), p.color, 0.7 * alpha).lineBetween(0, 0, ex, ey);
      g.lineStyle(3, WHITE, alpha).lineBetween(0, 0, ex, ey);
      g.fillStyle(WHITE, alpha).fillCircle(0, 0, 7 * (1 - t));
      g.fillStyle(glow, alpha * 0.8).fillCircle(ex, ey, 10 * (1 - t));
      break;
    }
    case 'charge': {
      const rand = rng(p.seed);
      for (let i = 0; i < 6; i++) {
        const off = (rand() - 0.5) * 30;
        const px = -Math.sin(p.facing) * off;
        const py = Math.cos(p.facing) * off;
        const len = 30 + rand() * p.range * 0.6;
        g.lineStyle(2, i % 2 ? glow : p.color, alpha * 0.8);
        g.lineBetween(px, py, px - Math.cos(p.facing) * len, py - Math.sin(p.facing) * len);
      }
      g.fillStyle(p.color, 0.3 * alpha).fillCircle(0, 0, 18 * (1 - t * 0.5));
      break;
    }
    case 'burst': {
      const r = 20 + easeOut(t) * p.range;
      g.fillStyle(p.color, 0.22 * alpha * (1 - t)).fillCircle(0, 0, r);
      g.lineStyle(6, p.color, alpha).strokeCircle(0, 0, r);
      g.lineStyle(2, WHITE, alpha * 0.8).strokeCircle(0, 0, r * 0.9);
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * TAU + t * 2;
        spark(g, Math.cos(ang) * r, Math.sin(ang) * r, ang, 14 * (1 - t), 2, glow, alpha);
      }
      break;
    }
    default: {
      const a0 = p.facing - p.arc / 2;
      const a1 = p.facing + p.arc / 2;
      arcStroke(g, 0, 0, p.range * 0.85, a0, a1, 16, p.color, 0.22 * alpha);
      arcStroke(g, 0, 0, p.range * 0.85, a0, a1, 5, glow, 0.9 * alpha);
      arcStroke(g, 0, 0, p.range * 0.85 - 4, a0, a1, 2, WHITE, alpha);
      spark(g, 0, 0, p.facing, p.range * (0.6 + easeOut(t) * 0.5), 3, glow, alpha * 0.8);
    }
  }
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export function drawShockwave(g: G, t: number, radius: number, color: number, seed: number, cracks = true): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.3);
  const glow = lighten(intToHexSafe(color), 0.45);
  const r1 = radius * easeOut(t);
  const r2 = radius * easeOut(clamp01(t * 1.4));
  g.fillStyle(color, 0.16 * alpha * (1 - t)).fillCircle(0, 0, r1);
  g.lineStyle(10 * (1 - t * 0.6), color, alpha * 0.85).strokeCircle(0, 0, r1);
  g.lineStyle(3, WHITE, alpha).strokeCircle(0, 0, r1 * 0.94);
  g.lineStyle(2, glow, alpha * 0.6).strokeCircle(0, 0, r2 * 0.6);
  g.fillStyle(WHITE, (1 - t) * 0.9).fillCircle(0, 0, 18 * (1 - t));
  if (cracks) {
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * TAU + rand() * 0.4;
      let x = 0;
      let y = 0;
      g.lineStyle(2, glow, alpha * 0.7);
      for (let k = 0; k < 4; k++) {
        const nx = x + Math.cos(ang + (rand() - 0.5) * 0.8) * (r1 / 4);
        const ny = y + Math.sin(ang + (rand() - 0.5) * 0.8) * (r1 / 4);
        g.lineBetween(x, y, nx, ny);
        x = nx;
        y = ny;
      }
    }
  }
}

export function drawBladeStorm(g: G, t: number, radius: number, color: number): void {
  g.clear();
  const alpha = fade(t, 0.55);
  const glow = lighten(intToHexSafe(color), 0.45);
  const spin = t * TAU * 2.5;
  const r = radius * (0.5 + 0.5 * Math.sin(Math.min(1, t * 1.6) * Math.PI));
  g.fillStyle(color, 0.12 * alpha).fillCircle(0, 0, r);
  for (let i = 0; i < 3; i++) {
    const a = spin + (i * TAU) / 3;
    arcStroke(g, 0, 0, r, a, a + 1.5, 12, color, 0.25 * alpha);
    arcStroke(g, 0, 0, r, a, a + 1.5, 4, glow, 0.9 * alpha);
    arcStroke(g, 0, 0, r - 3, a + 0.1, a + 1.4, 1.5, WHITE, alpha);
    arcStroke(g, 0, 0, r * 0.55, a + 0.8, a + 1.9, 2, color, 0.6 * alpha);
  }
  for (let i = 0; i < 14; i++) {
    const a = spin * 1.3 + (i / 14) * TAU;
    const d = r * (0.8 + 0.3 * Math.sin(t * 20 + i));
    g.fillStyle(i % 2 ? WHITE : glow, alpha * 0.8).fillCircle(Math.cos(a) * d, Math.sin(a) * d, 1.8);
  }
}

export function drawBeam(g: G, t: number, facing: number, length: number, color: number, width = 44): void {
  g.clear();
  const rise = clamp01(t / 0.12);
  const alpha = t < 0.12 ? rise : fade(t, 0.45);
  const glow = lighten(intToHexSafe(color), 0.5);
  const ex = Math.cos(facing) * length;
  const ey = Math.sin(facing) * length;
  g.lineStyle(width * (1 - t * 0.4), color, 0.2 * alpha).lineBetween(0, 0, ex, ey);
  g.lineStyle(width * 0.45 * (1 - t * 0.4), color, 0.75 * alpha).lineBetween(0, 0, ex, ey);
  g.lineStyle(width * 0.18, glow, alpha).lineBetween(0, 0, ex, ey);
  g.lineStyle(3, WHITE, alpha).lineBetween(0, 0, ex, ey);
  g.fillStyle(WHITE, alpha).fillCircle(0, 0, 14 * (1 - t * 0.5));
  g.fillStyle(glow, alpha * 0.9).fillCircle(0, 0, 24 * (1 - t * 0.5));
  for (let i = 0; i < 10; i++) {
    const along = (i / 10 + (t * 0.5) % 0.1) * length;
    const side = Math.sin(i * 2.3 + t * 30) * width * 0.35;
    g.fillStyle(i % 2 ? WHITE : glow, alpha * 0.8);
    g.fillCircle(Math.cos(facing) * along - Math.sin(facing) * side, Math.sin(facing) * along + Math.cos(facing) * side, 2);
  }
}

export function drawSingularity(g: G, t: number, radius: number, color: number, seed: number): void {
  g.clear();
  const rand = rng(seed);
  const glow = lighten(intToHexSafe(color), 0.5);
  const collapse = clamp01(t / 0.7);
  const r = radius * (1 - easeIn(collapse));
  const alpha = t < 0.7 ? 1 : fade(t, 0.7);
  if (t < 0.7) {
    g.fillStyle(0x000000, 0.35 * (1 - collapse * 0.5)).fillCircle(0, 0, r * 0.6);
    g.lineStyle(2, color, 0.8).strokeCircle(0, 0, r);
    for (let i = 0; i < 4; i++) {
      const a = t * TAU * 3 + (i * TAU) / 4;
      arcStroke(g, 0, 0, r * (0.9 - i * 0.12), a, a + 2.4, 3, i % 2 ? glow : color, 0.85);
    }
    for (let i = 0; i < 16; i++) {
      const a = rand() * TAU + t * 5;
      const d = r * (0.5 + rand() * 0.9) * (1 - collapse * 0.3);
      g.fillStyle(i % 3 ? color : WHITE, 0.85).fillCircle(Math.cos(a) * d, Math.sin(a) * d, 1.5 + rand());
    }
    g.fillStyle(WHITE, 0.9).fillCircle(0, 0, 4 + collapse * 6);
  } else {
    const boom = (t - 0.7) / 0.3;
    const br = radius * 0.3 + easeOut(boom) * radius * 1.1;
    g.fillStyle(color, 0.25 * alpha).fillCircle(0, 0, br * 0.8);
    g.lineStyle(8 * (1 - boom), glow, alpha).strokeCircle(0, 0, br);
    g.lineStyle(2, WHITE, alpha).strokeCircle(0, 0, br * 0.9);
    g.fillStyle(WHITE, alpha).fillCircle(0, 0, 26 * (1 - boom));
  }
}

export function drawFlare(g: G, t: number, color: number, seed: number): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.3);
  const glow = lighten(intToHexSafe(color), 0.5);
  const r = 16 + easeOut(t) * 58;
  g.fillStyle(color, 0.22 * alpha * (1 - t)).fillCircle(0, 0, r);
  g.lineStyle(3, glow, alpha).strokeCircle(0, 0, r);
  g.fillStyle(WHITE, alpha).fillCircle(0, 0, 10 * (1 - t));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rand() * 0.3;
    const len = 30 + easeOut(t) * 50;
    g.lineStyle(i % 2 ? 3 : 1.5, i % 2 ? color : WHITE, alpha * 0.9);
    g.lineBetween(Math.cos(a) * 8, Math.sin(a) * 8, Math.cos(a) * len, Math.sin(a) * len);
  }
}

export function drawRally(g: G, t: number, color: number, radius: number, seed: number): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.35);
  const glow = lighten(intToHexSafe(color), 0.5);
  for (let k = 0; k < 3; k++) {
    const r = radius * easeOut(clamp01(t * 1.2 - k * 0.15));
    if (r <= 0) continue;
    g.lineStyle(3 - k, k === 0 ? glow : color, alpha * (0.9 - k * 0.25)).strokeCircle(0, 0, r);
  }
  for (let i = 0; i < 18; i++) {
    const a = rand() * TAU;
    const d = rand() * radius * 0.9;
    const rise = easeOut(t) * (30 + rand() * 30);
    g.fillStyle(i % 3 ? color : WHITE, alpha * 0.9).fillCircle(Math.cos(a) * d, Math.sin(a) * d - rise, 2 + rand() * 1.5);
  }
  g.fillStyle(glow, alpha * 0.25 * (1 - t)).fillCircle(0, 0, radius * 0.5);
}

export function drawTether(g: G, t: number, from: { x: number; y: number }, to: { x: number; y: number }, color: number, seed: number): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.4);
  const glow = lighten(intToHexSafe(color), 0.5);
  const segments = 9;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (const [w, c, a] of [[9, color, 0.2], [3, glow, 0.85], [1.2, WHITE, 1]] as const) {
    let px = from.x;
    let py = from.y;
    g.lineStyle(w, c, alpha * a);
    for (let i = 1; i <= segments; i++) {
      const f = i / segments;
      const wobble = i === segments ? 0 : (rand() - 0.5) * 22 * (1 - t * 0.5);
      const x = from.x + dx * f + nx * wobble;
      const y = from.y + dy * f + ny * wobble;
      g.lineBetween(px, py, x, y);
      px = x;
      py = y;
    }
  }
  g.lineStyle(3, glow, alpha).strokeCircle(to.x, to.y, 12 + (1 - t) * 6);
  g.fillStyle(WHITE, alpha * 0.8).fillCircle(to.x, to.y, 4);
}

export function drawShroud(g: G, t: number, color: number, seed: number): void {
  g.clear();
  const rand = rng(seed);
  const alpha = fade(t, 0.2);
  for (let i = 0; i < 9; i++) {
    const a = rand() * TAU;
    const d = 6 + easeOut(t) * (20 + rand() * 26);
    const r = 10 + rand() * 12 + t * 8;
    g.fillStyle(i % 2 ? color : 0x2a2340, alpha * 0.45);
    g.fillCircle(Math.cos(a) * d, Math.sin(a) * d, r);
  }
  g.fillStyle(lighten(intToHexSafe(color), 0.5), alpha * 0.6 * (1 - t)).fillCircle(0, 0, 10);
}

export function drawRewind(g: G, t: number, color: number): void {
  g.clear();
  const alpha = fade(t, 0.3);
  const glow = lighten(intToHexSafe(color), 0.5);
  for (let i = 0; i < 3; i++) {
    const a = -t * TAU * 2 + (i * TAU) / 3;
    arcStroke(g, 0, 0, 22 + i * 9, a, a + 1.9, 2.5, i % 2 ? glow : color, alpha * 0.9);
  }
  g.lineStyle(1.5, WHITE, alpha * 0.7).strokeCircle(0, 0, 14);
  g.lineStyle(2, WHITE, alpha).lineBetween(0, 0, 0, -10).lineBetween(0, 0, 7, 0);
}

export function drawBlink(g: G, t: number, facing: number, distance: number, color: number): void {
  g.clear();
  const alpha = fade(t, 0.25);
  const glow = lighten(intToHexSafe(color), 0.5);
  const bx = -Math.cos(facing);
  const by = -Math.sin(facing);
  g.lineStyle(12, color, 0.22 * alpha).lineBetween(0, 0, bx * distance, by * distance);
  g.lineStyle(3, glow, 0.9 * alpha).lineBetween(0, 0, bx * distance, by * distance);
  g.lineStyle(1.2, WHITE, alpha).lineBetween(0, 0, bx * distance, by * distance);
  for (let i = 1; i <= 3; i++) {
    const d = (distance * i) / 4;
    g.fillStyle(color, alpha * (0.5 - i * 0.1)).fillEllipse(bx * d, by * d, 22, 16);
  }
  g.fillStyle(WHITE, alpha).fillCircle(0, 0, 8 * (1 - t));
}

export function drawRevive(g: G, t: number, color: number): void {
  g.clear();
  const alpha = fade(t, 0.4);
  const r = 10 + easeOut(t) * 40;
  g.lineStyle(3, color, alpha).strokeCircle(0, 0, r);
  g.lineStyle(1.5, WHITE, alpha * 0.7).strokeCircle(0, 0, r * 0.7);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    g.fillStyle(WHITE, alpha).fillCircle(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85 - easeOut(t) * 10, 2.5);
  }
}

export function drawTelegraphWarning(g: G, t: number, color: number, radius: number): void {
  g.clear();
  const alpha = fade(t, 0.1);
  g.lineStyle(2, color, alpha * 0.9).strokeCircle(0, 0, radius + 6 + easeOut(t) * 10);
  g.lineStyle(1, WHITE, alpha * 0.5).strokeCircle(0, 0, radius + 2 + easeOut(t) * 6);
}

export function enemyAccent(enemyId: EnemyId): number {
  switch (enemyId) {
    case 'sentinel':
      return 0xff8f3f;
    case 'lurker':
      return 0xc43cff;
    case 'spewer':
      return 0x9dff5e;
    case 'swarmling':
      return 0xffd35e;
    case 'warden':
      return 0x6ba8ff;
    case 'channeler':
      return 0xd98cff;
    case 'guardian':
    default:
      return 0xff5c7a;
  }
}

function intToHexSafe(n: number): string {
  return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}
