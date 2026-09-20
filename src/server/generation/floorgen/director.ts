/**
 * Encounter director — decides WHO is in a room. Positions are the assembler's job.
 *
 * Owner: Agent F1a (floors). Pure. Follows Dead Cells' "density ratio + compatibility":
 * a point budget = f(biome tier, room kind, depth in floor) is spent on the biome's
 * enemy pool under compatibility rules.
 *
 * Rules:
 *  - entrance / rest / treasure / lore / shop rooms are always empty;
 *  - combat: budget spent on the pool; ranged enemies capped by room size;
 *  - elite: ONE tougher pack (the pool's most expensive enemy) + a reduced escort budget;
 *  - exit: a single gatekeeper (warden if the biome has one, else its toughest enemy)
 *    + escorts. In the FINAL biome the exit holds the guardian instead;
 *  - `guardian` is never bought as a pack, whatever the brief's pool says;
 *  - RoomSpec limits hold: <= 12 encounter entries, 1..6 per entry.
 */
import type { BiomeBrief, EncounterRole, RoomKind, SizeClass } from '../../../shared/floors';
import type { EnemyId } from '../../../shared/registry';
import type { Rng } from './rng';

export interface EncounterGroup {
  enemyId: EnemyId;
  count: number;
  role: EncounterRole;
}

export interface DirectorContext {
  brief: BiomeBrief;
  tier: number;
  kind: RoomKind;
  depth: number;
  /** Deepest room of the floor (FloorPlan.stats.maxDepth). */
  maxDepth: number;
  sizeClass: SizeClass;
  /** True for the exit room of the last biome. */
  isFinalExit: boolean;
}

/** Point cost per enemy; roughly maxHp / 14 adjusted for how dangerous the pattern is. */
export const ENEMY_COST: Record<EnemyId, number> = {
  swarmling: 1,
  husk: 2,
  lurker: 2,
  spewer: 3,
  channeler: 4,
  sentinel: 4,
  warden: 5,
  guardian: 99,
};

/** Enemies that fight at range (volley / spread / homing / spiral patterns in the sim). */
export const RANGED_ENEMIES: ReadonlySet<EnemyId> = new Set<EnemyId>(['sentinel', 'spewer', 'warden', 'channeler']);

export const MAX_ENEMIES_BY_SIZE: Record<SizeClass, number> = { small: 5, medium: 9, large: 13 };
export const MAX_RANGED_BY_SIZE: Record<SizeClass, number> = { small: 1, medium: 3, large: 5 };
export const MAX_ENCOUNTER_ENTRIES = 12;
const GROUP_SIZE = 3;
const MAX_GROUP_SIZE = 6;

const EMPTY_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['entrance', 'rest', 'treasure', 'lore', 'shop']);

/** Budget in points. Tier sets the base, depth ramps it up to +50 % at the far end of the floor. */
export function encounterBudget(tier: number, kind: RoomKind, depth: number, maxDepth: number): number {
  if (EMPTY_KINDS.has(kind)) return 0;
  const base = 5 + 3 * tier;
  const ramp = 0.8 + 0.5 * (maxDepth > 0 ? Math.min(1, depth / maxDepth) : 0);
  const kindFactor = kind === 'elite' ? 0.6 : kind === 'exit' ? 0.5 : 1;
  return Math.round(base * ramp * kindFactor);
}

export function rollEncounters(ctx: DirectorContext, rng: Rng): EncounterGroup[] {
  if (EMPTY_KINDS.has(ctx.kind)) return [];
  const pool = ctx.brief.enemyPool.filter((id) => id !== 'guardian');
  if (pool.length === 0) return [];
  const toughest = pool.reduce((best, id) => (ENEMY_COST[id] > ENEMY_COST[best] ? id : best), pool[0]!);

  const groups: EncounterGroup[] = [];
  let enemyCap = MAX_ENEMIES_BY_SIZE[ctx.sizeClass];
  let rangedCap = MAX_RANGED_BY_SIZE[ctx.sizeClass];

  if (ctx.kind === 'exit') {
    const boss: EnemyId = ctx.isFinalExit ? 'guardian' : pool.includes('warden') ? 'warden' : toughest;
    groups.push({ enemyId: boss, count: 1, role: ctx.isFinalExit ? 'guardian' : 'gatekeeper' });
    enemyCap -= 1;
  } else if (ctx.kind === 'elite') {
    const count = Math.min(MAX_GROUP_SIZE, 2 + Math.floor(ctx.tier / 2));
    groups.push({ enemyId: toughest, count, role: 'elite' });
    enemyCap -= count;
    if (RANGED_ENEMIES.has(toughest)) rangedCap = Math.max(0, rangedCap - count);
  }

  // Spend the budget. Cheap enemies are likelier early in the floor; each purchase must
  // be affordable and compatible, so the loop always terminates.
  let budget = encounterBudget(ctx.tier, ctx.kind, ctx.depth, ctx.maxDepth);
  const tally = new Map<EnemyId, number>();
  let ranged = 0;
  let bought = 0;
  while (bought < enemyCap) {
    const options = pool.filter((id) => ENEMY_COST[id] <= budget && (!RANGED_ENEMIES.has(id) || ranged < rangedCap));
    if (options.length === 0) break;
    const choice = rng.weighted(options, (id) => 1 / Math.sqrt(ENEMY_COST[id]));
    tally.set(choice, (tally.get(choice) ?? 0) + 1);
    budget -= ENEMY_COST[choice];
    if (RANGED_ENEMIES.has(choice)) ranged++;
    bought++;
  }
  // A combat room is never empty: if nothing was affordable, the cheapest enemy shows up alone.
  if (bought === 0 && ctx.kind === 'combat' && enemyCap > 0) {
    const cheapest = pool.reduce((best, id) => (ENEMY_COST[id] < ENEMY_COST[best] ? id : best), pool[0]!);
    tally.set(cheapest, 1);
  }

  // Pool order (not Map insertion order) keeps the output independent of roll order.
  for (const enemyId of pool) {
    let left = tally.get(enemyId) ?? 0;
    while (left > 0) {
      const count = Math.min(GROUP_SIZE, left);
      groups.push({ enemyId, count, role: 'pack' });
      left -= count;
    }
  }
  return mergeToLimit(groups);
}

/** Folds surplus pack entries into earlier entries of the same enemy so there are never more than 12. */
function mergeToLimit(groups: EncounterGroup[]): EncounterGroup[] {
  const out = [...groups];
  while (out.length > MAX_ENCOUNTER_ENTRIES) {
    const last = out.pop()!;
    const host = out.find((group) => group.role === 'pack' && group.enemyId === last.enemyId && group.count + last.count <= MAX_GROUP_SIZE);
    if (host) host.count += last.count;
    // No host: the surplus group is dropped. Unreachable with the caps above (<= 13 enemies).
  }
  return out;
}
