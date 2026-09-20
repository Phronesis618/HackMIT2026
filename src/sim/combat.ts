import { ATTACK_ARC_RAD, ATTACK_COOLDOWN_MS, ATTACK_RANGE, PLAYER_SPEED, TICK_MS, tileToWorld, worldToTile } from '../shared/conventions';
import type { ClassId, EnemyId } from '../shared/registry';
import { circleHitsSolid, type SolidGrid } from './collision';

export interface Point { x: number; y: number }

export const CLASS_COMBAT: Record<ClassId, {
  speed: number; damage: number; range: number; arc: number; cooldown: number;
  qCooldown: number; eCooldown: number;
}> = {
  bastion: { speed: PLAYER_SPEED, damage: 20, range: ATTACK_RANGE, arc: ATTACK_ARC_RAD, cooldown: ATTACK_COOLDOWN_MS, qCooldown: 6000, eCooldown: 8000 },
  shade: { speed: 220, damage: 18, range: 42, arc: Math.PI * 0.45, cooldown: 260, qCooldown: 4000, eCooldown: 9000 },
  beacon: { speed: PLAYER_SPEED, damage: 14, range: 240, arc: 0.18, cooldown: 420, qCooldown: 5000, eCooldown: 10000 },
  weaver: { speed: 180, damage: 16, range: 135, arc: Math.PI * 0.4, cooldown: 450, qCooldown: 4500, eCooldown: 10000 },
};

/**
 * `damage` is a single-hit amount for hitscan kinds (melee/beam/charge/burst) and a
 * PER-BOLT amount for projectile kinds (volley/spread/ring/homing/spiral).
 */
export const ENEMY_COMBAT: Record<EnemyId, {
  speed: number; damage: number; range: number; windup: number; cooldown: number; arc: number;
}> = {
  husk: { speed: 78, damage: 14, range: 52, windup: 600, cooldown: 1150, arc: Math.PI * 0.65 },
  sentinel: { speed: 58, damage: 7, range: 280, windup: 900, cooldown: 1600, arc: 0.16 },
  lurker: { speed: 125, damage: 16, range: 150, windup: 700, cooldown: 1500, arc: 0.18 },
  guardian: { speed: 55, damage: 24, range: 120, windup: 1100, cooldown: 1500, arc: Math.PI * 2 },
  spewer: { speed: 68, damage: 9, range: 220, windup: 650, cooldown: 1800, arc: 0.9 },
  swarmling: { speed: 150, damage: 9, range: 42, windup: 600, cooldown: 700, arc: Math.PI * 0.8 },
  warden: { speed: 50, damage: 16, range: 260, windup: 800, cooldown: 2400, arc: 0.1 },
  channeler: { speed: 40, damage: 6, range: 230, windup: 550, cooldown: 1200, arc: 0.1 },
};

/** Shape of a burst of bullet-hell bolts fired from a single resolved attack. */
export interface ProjectilePattern {
  /** Bolts spawned at once. */
  count: number;
  /** `spread`/`ring`: radians between bolts. `volley`: pixels of stagger along the aim line. */
  spacing: number;
  speed: number;
  radius: number;
  /** Lifetime in ms before a bolt fizzles out even if it hits nothing. */
  life: number;
  /** `homing` only: max turn rate in rad/s while steering toward the nearest living player. */
  homingTurnRate?: number;
}

/** Default projectile shape per enemy for its primary ranged pattern. */
export const ENEMY_PROJECTILE_PATTERN: Partial<Record<EnemyId, ProjectilePattern>> = {
  sentinel: { count: 3, spacing: 22, speed: 320, radius: 5, life: 1200 },
  spewer: { count: 3, spacing: 0.28, speed: 190, radius: 6, life: 1700 },
  warden: { count: 1, spacing: 0, speed: 130, radius: 8, life: 3200, homingTurnRate: 1.4 },
};

/** Lurker's dash ends with a short-range ring of spore bolts (area denial, not its main hit). */
export const LURKER_SPORE_PATTERN: ProjectilePattern = { count: 4, spacing: (Math.PI * 2) / 4, speed: 140, radius: 5, life: 800 };
export const LURKER_SPORE_DAMAGE = 5;

/** Guardian's two projectile phases, interleaved with its original melee/beam hits. */
export const GUARDIAN_VOLLEY_PATTERN: ProjectilePattern = { count: 3, spacing: 24, speed: 300, radius: 6, life: 1400 };
export const GUARDIAN_VOLLEY_DAMAGE = 8;
export const GUARDIAN_RING_PATTERN: ProjectilePattern = { count: 8, spacing: (Math.PI * 2) / 8, speed: 260, radius: 6, life: 1300 };
export const GUARDIAN_RING_DAMAGE = 6;

/** Channeler's spiral: one bolt every `shotIntervalMs` while sweeping by `spacingRad`. */
export const CHANNEL_PATTERN = {
  durationMs: 1500,
  shotIntervalMs: 150,
  spacingRad: (Math.PI * 2) / 10,
  speed: 230,
  radius: 5,
  life: 1200,
};

export function decay(ms: number): number {
  return ms <= TICK_MS + 1e-7 ? 0 : ms - TICK_MS;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function inArc(origin: Point, target: Point, facing: number, range: number, arc: number, radius = 0): boolean {
  const d = distance(origin, target);
  if (d > range + radius) return false;
  if (d <= radius) return true;
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x) - facing;
  const difference = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
  return difference <= arc / 2 + Math.asin(Math.min(1, radius / d));
}

export function clearPath(grid: SolidGrid, from: Point, to: Point, radius = 1): boolean {
  const steps = Math.max(1, Math.ceil(distance(from, to) / 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (circleHitsSolid(grid, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius)) return false;
  }
  return true;
}

export function nearestOpenPosition(grid: SolidGrid, preferred: Point, radius: number): Point {
  if (!circleHitsSolid(grid, preferred.x, preferred.y, radius)) return preferred;
  let best = preferred;
  let bestDistance = Infinity;
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const candidate = tileToWorld(col, row);
      const d = distance(candidate, preferred);
      if (d < bestDistance && !circleHitsSolid(grid, candidate.x, candidate.y, radius)) {
        best = candidate;
        bestDistance = d;
      }
    }
  }
  return best;
}

/** Cardinal BFS keeps pursuit deterministic around walls and prop footprints. */
export function chaseWaypoint(grid: SolidGrid, from: Point, target: Point, radius: number): Point {
  if (clearPath(grid, from, target, radius)) return target;
  const start = worldToTile(from.x, from.y);
  const goalPoint = nearestOpenPosition(grid, target, radius);
  const goal = worldToTile(goalPoint.x, goalPoint.y);
  const startId = start.row * grid.width + start.col;
  const goalId = goal.row * grid.width + goal.col;
  const parents = new Map<number, number>([[startId, -1]]);
  const queue = [startId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (id === goalId) break;
    const x = id % grid.width;
    const y = Math.floor(id / grid.width);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const col = x + dx!;
      const row = y + dy!;
      if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) continue;
      const nextId = row * grid.width + col;
      const point = tileToWorld(col, row);
      if (parents.has(nextId) || circleHitsSolid(grid, point.x, point.y, radius)) continue;
      parents.set(nextId, id);
      queue.push(nextId);
    }
  }
  if (!parents.has(goalId)) return from;
  let next = goalId;
  while (parents.get(next) !== startId && parents.get(next) !== -1) next = parents.get(next)!;
  const waypoint = tileToWorld(next % grid.width, Math.floor(next / grid.width));
  const startCenter = tileToWorld(start.col, start.row);
  return clearPath(grid, from, waypoint, radius) ? waypoint : startCenter;
}
