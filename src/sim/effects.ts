/**
 * Effects: the one place the skill tree and the world's attunements touch the simulation
 * (docs/design/ITEMS.md §5, B-minus slice). `effectsFor(player, world)` is pure — the same
 * player and world always resolve to the same set — and every hook below is a pure function
 * of that set plus plain numbers, so the sim stays deterministic across both ends of a co-op
 * session.
 *
 * Composition rule: world laws (`src/sim/laws.ts`) and floors tier scaling are applied by the
 * caller FIRST; the multipliers here compose on top, multiplicatively, in one rounding.
 * `NO_EFFECTS` makes every hook the identity, so a crew that bought nothing plays
 * byte-identically to a build without this module.
 *
 * Owner: agent S1.
 */
import type { PlayerState, PreparedWorld } from '../shared/contracts';
import { isTerrainDamageSource } from '../shared/terrain';
import { buildSkillTree, ownedSkillEffects, type SkillEffectId, type SkillWorldContext } from '../shared/skills';

export interface EffectSet {
  readonly ids: readonly SkillEffectId[];
  has(id: SkillEffectId): boolean;
}

const fromIds = (ids: readonly SkillEffectId[]): EffectSet => {
  const set = new Set(ids);
  return { ids, has: (id) => set.has(id) };
};

export const NO_EFFECTS: EffectSet = fromIds([]);

/** The tree context the sim resolves against: the prepared world's title and attunements. */
export function skillWorldContext(world: PreparedWorld | SkillWorldContext | null): SkillWorldContext | null {
  if (!world) return null;
  if ('recipe' in world) return { title: world.recipe.title, attunements: world.recipe.attunements };
  return world;
}

/** Pure: owned, implemented nodes of this player's tree in this world → effect ids. */
export function effectsFor(
  player: Pick<PlayerState, 'classId' | 'skillNodeIds'>, world: PreparedWorld | SkillWorldContext | null,
): EffectSet {
  const owned = player.skillNodeIds ?? [];
  const tree = buildSkillTree(player.classId, skillWorldContext(world));
  const ids = ownedSkillEffects(tree, owned);
  return ids.length === 0 ? NO_EFFECTS : fromIds(ids);
}

// ---------------------------------------------------------------------------------------------
// Hook 1 — player takes damage: hazard_ward, bolt_ward, melee_ward
// ---------------------------------------------------------------------------------------------

export const HAZARD_WARD_MUL = 0.6;
export const BOLT_WARD_MUL = 0.75;
export const MELEE_WARD_MUL = 0.75;
/** The collapse (src/sim/escape.ts) damages through this source id; it is the room, not an enemy. */
export const COLLAPSE_DAMAGE_SOURCE = 'collapse';
/** The Anchor's own pulse is neither terrain nor an enemy; no ward touches it. */
export const ANCHOR_PULSE_SOURCE = 'anchor-pulse';

export type IncomingKind = 'terrain' | 'ranged' | 'melee' | 'other';

export function incomingKind(sourceId: string, ranged: boolean): IncomingKind {
  if (isTerrainDamageSource(sourceId) || sourceId === COLLAPSE_DAMAGE_SOURCE) return 'terrain';
  if (sourceId === ANCHOR_PULSE_SOURCE) return 'other';
  return ranged ? 'ranged' : 'melee';
}

/** Multiplier on damage the player takes, after laws and tier scaling. */
export function incomingDamageMul(fx: EffectSet, sourceId: string, ranged: boolean): number {
  switch (incomingKind(sourceId, ranged)) {
    case 'terrain': return fx.has('hazard_ward') ? HAZARD_WARD_MUL : 1;
    case 'ranged': return fx.has('bolt_ward') ? BOLT_WARD_MUL : 1;
    case 'melee': return fx.has('melee_ward') ? MELEE_WARD_MUL : 1;
    default: return 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Hook 2 — player deals damage: first_strike, guardian_bane
// ---------------------------------------------------------------------------------------------

export const FIRST_STRIKE_MUL = 2;
export const GUARDIAN_BANE_MUL = 1.2;

/**
 * Multiplier on a direct hit the player lands, after `laws.playerDamageMul` and the laws'
 * own opening-strike multiplier. Gatekeepers and the Custodian are both `enemyId: 'guardian'`.
 */
export function outgoingDamageMul(fx: EffectSet, target: { enemyId: string; hp: number; maxHp: number }): number {
  return (fx.has('first_strike') && target.hp === target.maxHp ? FIRST_STRIKE_MUL : 1) *
    (fx.has('guardian_bane') && target.enemyId === 'guardian' ? GUARDIAN_BANE_MUL : 1);
}

// ---------------------------------------------------------------------------------------------
// Hook 3 — room cleared: clear_surge, salvage_bonus
// ---------------------------------------------------------------------------------------------

export const CLEAR_SURGE_HASTE_MS = 4000;
export const HASTE_MOVE_MUL = 1.3;
export const HASTE_ATTACK_COOLDOWN_MUL = 0.8;
export const SALVAGE_BONUS_RESOURCES = 1;

export function clearBonusResources(fx: EffectSet): number {
  return fx.has('salvage_bonus') ? SALVAGE_BONUS_RESOURCES : 0;
}

export function clearHasteMs(fx: EffectSet): number {
  return fx.has('clear_surge') ? CLEAR_SURGE_HASTE_MS : 0;
}

export function hasteMoveMul(hasteMs: number): number {
  return hasteMs > 0 ? HASTE_MOVE_MUL : 1;
}

export function hasteAttackCooldownMul(hasteMs: number): number {
  return hasteMs > 0 ? HASTE_ATTACK_COOLDOWN_MUL : 1;
}

// ---------------------------------------------------------------------------------------------
// Hook 4 — dash: second_wind, dash_echo
// ---------------------------------------------------------------------------------------------

export const SECOND_WIND_COOLDOWN_MUL = 0.75;
export const SECOND_WIND_INVULNERABLE_BONUS_MS = 50;

export function dashCooldownMul(fx: EffectSet): number {
  return fx.has('second_wind') ? SECOND_WIND_COOLDOWN_MUL : 1;
}

export function dashInvulnerableBonusMs(fx: EffectSet): number {
  return fx.has('second_wind') ? SECOND_WIND_INVULNERABLE_BONUS_MS : 0;
}

export const DASH_TRAIL_MS = 1500;
export const DASH_TRAIL_RADIUS = 30;
/** 2 damage every 250 ms = the 8 per second the summary promises, in whole points. */
export const DASH_TRAIL_TICK_MS = 250;
export const DASH_TRAIL_DAMAGE = 2;

export interface DashTrail {
  points: Array<{ x: number; y: number; remainingMs: number }>;
  /** Per-enemy time until the trail may burn it again. */
  burnCooldownMs: Record<string, number>;
}

export function createDashTrail(): DashTrail {
  return { points: [], burnCooldownMs: {} };
}

/** Call once per tick while the player is dashing; the trail stays behind them. */
export function dropTrailPoint(trail: DashTrail | null, fx: EffectSet, x: number, y: number): DashTrail | null {
  if (!fx.has('dash_echo')) return trail;
  const next = trail ?? createDashTrail();
  next.points.push({ x, y, remainingMs: DASH_TRAIL_MS });
  return next;
}

/**
 * Advances the trail by one tick and returns the ids of enemies it burns this tick, in the
 * order given. Returns null once the trail has fully faded so the caller can drop it.
 */
export function stepDashTrail(
  trail: DashTrail, tickMs: number, enemies: ReadonlyArray<{ id: string; x: number; y: number; hp: number }>,
): { trail: DashTrail | null; burned: string[] } {
  for (const point of trail.points) point.remainingMs -= tickMs;
  trail.points = trail.points.filter((point) => point.remainingMs > 0);
  for (const id of Object.keys(trail.burnCooldownMs)) {
    const left = trail.burnCooldownMs[id]! - tickMs;
    if (left <= 0) delete trail.burnCooldownMs[id];
    else trail.burnCooldownMs[id] = left;
  }
  const burned: string[] = [];
  if (trail.points.length === 0) return { trail: Object.keys(trail.burnCooldownMs).length ? trail : null, burned };
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || trail.burnCooldownMs[enemy.id] !== undefined) continue;
    if (trail.points.some((point) => Math.hypot(point.x - enemy.x, point.y - enemy.y) <= DASH_TRAIL_RADIUS)) {
      trail.burnCooldownMs[enemy.id] = DASH_TRAIL_TICK_MS;
      burned.push(enemy.id);
    }
  }
  return { trail, burned };
}

// ---------------------------------------------------------------------------------------------
// Hook 5 — lore: relic_mend, remains_charge
// ---------------------------------------------------------------------------------------------

export const RELIC_MEND_HP = 25;
export const REMAINS_CHARGE = 40;

export function relicMendHp(fx: EffectSet): number {
  return fx.has('relic_mend') ? RELIC_MEND_HP : 0;
}

export function remainsCharge(fx: EffectSet): number {
  return fx.has('remains_charge') ? REMAINS_CHARGE : 0;
}

// ---------------------------------------------------------------------------------------------
// Hook 6 — Anchor: anchor_grace
// ---------------------------------------------------------------------------------------------

export const ANCHOR_GRACE_MUL = 2;

/** Progress-rate multiplier for the plant hold and the ritual discharge. Any one holder is enough. */
export function anchorRateMul(crew: ReadonlyArray<EffectSet>): number {
  return crew.some((fx) => fx.has('anchor_grace')) ? ANCHOR_GRACE_MUL : 1;
}
