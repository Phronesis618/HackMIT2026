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

export const ENEMY_COMBAT: Record<EnemyId, {
  speed: number; damage: number; range: number; windup: number; cooldown: number; arc: number;
}> = {
  husk: { speed: 78, damage: 14, range: 52, windup: 600, cooldown: 1150, arc: Math.PI * 0.65 },
  sentinel: { speed: 58, damage: 18, range: 280, windup: 900, cooldown: 1600, arc: 0.12 },
  lurker: { speed: 125, damage: 16, range: 150, windup: 700, cooldown: 1500, arc: 0.18 },
  guardian: { speed: 55, damage: 24, range: 120, windup: 1100, cooldown: 1500, arc: Math.PI * 2 },
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
