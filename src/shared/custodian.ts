/**
 * The Custodian: a closed registry of boss attack patterns, the numbers each one runs on,
 * and the rules that turn a world's (optional) model-written pick into three legal moves.
 *
 * Spec: docs/design/BOSS_FINALE.md §2, §3. Owner: Agent B1.
 *
 * Shared rather than sim-local because three consumers need the same table: `src/sim/boss.ts`
 * runs it, `src/client/render/bossFx.ts` draws the telegraph, and the HUD names the move.
 * Nothing here touches simulation state; it is data plus pure selection.
 *
 * The rule the research agrees on: randomise WHICH patterns a world's Custodian uses, never
 * the relationship between a tell and its hitbox. Every pattern below is deterministic once
 * started, and the telegraph timings are the phase-1 values (phase 2 ×0.85, phase 3 ×0.75).
 */
import { z } from 'zod';
import { createRng, seedKey } from './floorgen/rng';
import { lintProse } from './prose';
import type { EnemyId } from './registry';

export const CUSTODIAN_PATTERN_IDS = [
  'sweep_arc', 'siege_charge', 'ring_bloom', 'summon_choir', 'tether_haul',
  'arena_flood', 'mirror_shade', 'pylon_lock', 'gravity_well', 'shatter_step', 'overload_vent',
] as const;
export type CustodianPatternId = (typeof CUSTODIAN_PATTERN_IDS)[number];
export const CustodianPatternIdSchema = z.enum(CUSTODIAN_PATTERN_IDS);

/**
 * What band of the fight a pattern occupies. The legality rules below use it: a moveset with
 * two arena-wide patterns is unreadable, and one without both a close and a ranged answer has
 * only one range band and therefore one answer.
 */
export type PatternClass = 'close' | 'ranged' | 'arena' | 'control';

/** Telegraph kinds the renderer already knows (EnemyTelegraph['kind']); bossFx adds the detail. */
export type TelegraphKind = 'melee' | 'beam' | 'charge' | 'burst' | 'volley' | 'spread' | 'ring' | 'homing' | 'spiral';

export interface CustodianPatternSpec {
  readonly id: CustodianPatternId;
  readonly patternClass: PatternClass;
  /** Phase-1 wind-up in ms. ×1.4 on the pattern's first use in a run. */
  readonly telegraphMs: number;
  readonly telegraph: TelegraphKind;
  /** How close a player must be (and in sight) before the Custodian starts this pattern. */
  readonly range: number;
  readonly arcRad: number;
  /** Damage of one application: one hitscan hit, one bolt, or one hazard tick. */
  readonly damage: number;
  /** Default in-world name, used when no model text is supplied or the text fails the linter. */
  readonly defaultName: string;
  /** Shown once, the first time the pattern runs. Plain and concrete (docs/WRITING.md). */
  readonly defaultTell: string;
  /** Designer-facing note; never shown to players. */
  readonly counterplay: string;
}

const P = (
  id: CustodianPatternId, patternClass: PatternClass, telegraphMs: number, telegraph: TelegraphKind,
  range: number, arcRad: number, damage: number, defaultName: string, defaultTell: string, counterplay: string,
): CustodianPatternSpec => ({ id, patternClass, telegraphMs, telegraph, range, arcRad, damage, defaultName, defaultTell, counterplay });

export const CUSTODIAN_PATTERNS: Record<CustodianPatternId, CustodianPatternSpec> = {
  sweep_arc: P('sweep_arc', 'ranged', 900, 'beam', 420, 0.5, 18, 'Long Sweep',
    'The beam crosses 300 degrees. The first 70 units stay cold.',
    'Walk with the sweep, stand inside the dead zone, or put a wall between you and it.'),
  siege_charge: P('siege_charge', 'close', 750, 'charge', 260, 0.3, 26, 'Siege Run',
    'It backs up 40 units, then runs 260 in a straight line.',
    'Sidestep one tile; bait the run into rubble or a wall.'),
  ring_bloom: P('ring_bloom', 'ranged', 700, 'ring', 300, Math.PI * 2, 6, 'Ring Bloom',
    'Twelve bolts go out, then twelve more through the gaps.',
    'Dash a gap; the second ring fills where the first ring left room.'),
  summon_choir: P('summon_choir', 'control', 1100, 'burst', 380, Math.PI * 2, 0, 'Muster',
    'It stands still for 1.1 seconds and calls four crew.',
    'Punish the cast at 25% extra damage, or kill the adds first.'),
  tether_haul: P('tether_haul', 'control', 800, 'homing', 480, 0.4, 10, 'Line Haul',
    'A line reaches the farthest operative and pulls 180 units.',
    'Break line of sight before it fires; a teammate can block the line.'),
  arena_flood: P('arena_flood', 'arena', 1200, 'ring', 460, Math.PI * 2, 14, 'Floor Wash',
    'Two fifths of the floor lights up for 2.5 seconds.',
    'Read the marks and take the clear route; one always exists.'),
  mirror_shade: P('mirror_shade', 'control', 600, 'burst', 420, Math.PI * 2, 0, 'Two Copies',
    'Two copies split off. They hit for nothing and hold 1 point.',
    'The real one keeps its rim light; a copy pays 12 charge.'),
  pylon_lock: P('pylon_lock', 'arena', 1000, 'beam', 460, Math.PI * 2, 32, 'Pylon Lock',
    'Three pylons cut the floor into wedges for 6 seconds.',
    'Leave the wedge it stands in; in co-op one operative draws the beam.'),
  gravity_well: P('gravity_well', 'arena', 900, 'ring', 440, Math.PI * 2, 0, 'Draw Down',
    'The floor pulls everything in at 90 units for 2 seconds.',
    'It deals no damage: let it feed the room into a hazard.'),
  shatter_step: P('shatter_step', 'close', 500, 'charge', 520, Math.PI * 2, 22, 'Step Through',
    'It marks the far operative, then arrives in half a second.',
    'The mark is a free half-second read: walk off it.'),
  overload_vent: P('overload_vent', 'arena', 1000, 'burst', 460, Math.PI * 2, 18, 'Vent Purge',
    'Every vent fires three times while it stands still.',
    'Stand off the vents and burn it: 30% extra damage for 2.7 seconds.'),
};

export function patternSpec(id: CustodianPatternId): CustodianPatternSpec {
  return CUSTODIAN_PATTERNS[id];
}

// ---------------------------------------------------------------------------
// Health, caps and the phase-3 shield
// ---------------------------------------------------------------------------

export const CUSTODIAN_BASE_HP = 1200;
export const CUSTODIAN_HP_PER_EXTRA_PLAYER = 400;
export const GATEKEEPER_BASE_HP = 320;
export const GATEKEEPER_HP_PER_EXTRA_PLAYER = 80;

/** Living players, recomputed when someone goes down (RoR2's trick); `maxHp` itself never moves. */
export function custodianMaxHp(players: number): number {
  return CUSTODIAN_BASE_HP + CUSTODIAN_HP_PER_EXTRA_PLAYER * (Math.max(1, players) - 1);
}

/**
 * Dead Cells' Conjunctivius caps a single hit at 15% of her max HP, which is what keeps her
 * phase structure intact whatever the player's build does. Ours is 12%.
 */
export const CUSTODIAN_HIT_CAP = 0.12;

export function capCustodianHit(amount: number, maxHp: number): number {
  return Math.min(amount, Math.round(maxHp * CUSTODIAN_HIT_CAP));
}

/** Damage reduction in phase 3, indexed by how many relays the crew holds. Continuous, so solo works. */
export const CUSTODIAN_SHIELD_DR = [0.9, 0.6, 0.3, 0] as const;
/** Time standing on a relay before it latches. */
export const RELAY_LATCH_ARM_MS = 1200;
/** How long a latched relay keeps counting after the operative leaves. Solo gets the long one. */
export const RELAY_LATCH_MS = 2000;
export const RELAY_LATCH_MS_SOLO = 8000;
/** The Custodian darkens one relay at a time, and rotates which one, so the crew must move. */
export const RELAY_INERT_ROTATE_MS = 12_000;

/** Cooldown between patterns, indexed by phase (1..3). Phase 2 chains a pair, then rests. */
export const PHASE_COOLDOWN_MS = [1900, 2200, 2400] as const;
/** Gap between the two halves of a phase-2 pair. */
export const PHASE2_CHAIN_MS = 400;
export const PHASE_TELEGRAPH_SCALE = [1, 0.85, 0.75] as const;
export const FIRST_USE_TELEGRAPH_SCALE = 1.4;
export const FIRST_USE_TELL_MS = 2500;
export const PHASE_CHANGE_RECOVERY_MS = 1600;
export const CLOSE_RECOVERY_MS = 1100;
export const RANGED_RECOVERY_MS = 650;

export function telegraphMsFor(spec: CustodianPatternSpec, phase: 1 | 2 | 3, firstUse: boolean): number {
  return Math.round(spec.telegraphMs * PHASE_TELEGRAPH_SCALE[phase - 1]! * (firstUse ? FIRST_USE_TELEGRAPH_SCALE : 1));
}

// ---------------------------------------------------------------------------
// Gatekeepers: one of the final boss's three patterns, per biome tier
// ---------------------------------------------------------------------------

export interface GatekeeperTier {
  /** Which of the Custodian's three moves this tier previews (two ids = alternating). */
  readonly moveIndices: readonly number[];
  readonly hp: number;
  readonly hpPerExtraPlayer: number;
  readonly telegraphScale: number;
}

export const GATEKEEPER_TIERS: readonly GatekeeperTier[] = [
  { moveIndices: [0], hp: 320, hpPerExtraPlayer: 80, telegraphScale: 1.3 },
  { moveIndices: [1], hp: 360, hpPerExtraPlayer: 90, telegraphScale: 1.2 },
  { moveIndices: [2], hp: 400, hpPerExtraPlayer: 100, telegraphScale: 1.15 },
  { moveIndices: [0, 1], hp: 480, hpPerExtraPlayer: 120, telegraphScale: 1.05 },
];

export function gatekeeperTier(tier: number): GatekeeperTier {
  return GATEKEEPER_TIERS[Math.max(0, Math.min(GATEKEEPER_TIERS.length - 1, tier))]!;
}

export function gatekeeperMaxHp(tier: number, players: number): number {
  const spec = gatekeeperTier(tier);
  return spec.hp + spec.hpPerExtraPlayer * (Math.max(1, players) - 1);
}

// ---------------------------------------------------------------------------
// The model's choice, and the validation that keeps it readable
// ---------------------------------------------------------------------------

export const CustodianMoveSchema = z.object({
  patternId: CustodianPatternIdSchema,
  /** The world's name for this attack. */
  name: z.string().trim().min(1).max(32),
  /** One line, shown once, the first time the pattern is used. */
  tell: z.string().trim().min(1).max(60),
});
export type CustodianMove = z.infer<typeof CustodianMoveSchema>;

export const CustodianSchema = z.object({
  /** Replaces 'THE LAST CUSTODIAN'. */
  title: z.string().trim().min(1).max(40),
  /** Replaces WATCH / FRACTURE / LAST LIGHT. */
  phaseTitles: z.tuple([z.string().trim().min(1).max(40), z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)]),
  moves: z.array(CustodianMoveSchema).length(3),
});
export type CustodianRecipe = z.infer<typeof CustodianSchema>;

export const DEFAULT_CUSTODIAN_TITLE = 'THE LAST CUSTODIAN';
export const DEFAULT_PHASE_TITLES = ['WATCH', 'FRACTURE', 'LAST LIGHT'] as const;
export const DEFAULT_CUSTODIAN_MOVES: readonly CustodianPatternId[] = ['ring_bloom', 'siege_charge', 'arena_flood'];

export interface ResolvedCustodian {
  title: string;
  phaseTitles: [string, string, string];
  moves: [CustodianMove, CustodianMove, CustodianMove];
  /** Where the identity came from; the HUD may say so, and tests assert it. */
  source: 'recipe' | 'derived';
}

export interface CustodianSelection {
  /** `recipe.custodian` if the pipeline supplies one; anything else is ignored safely. */
  spec?: unknown;
  /** World seed (or world id) — the derived pick is a pure function of this plus motifs. */
  seed: string;
  motifIds?: readonly string[];
  /** Non-boss enemy ids the biome can actually spawn; `summon_choir` needs two of them. */
  enemyPool?: readonly EnemyId[];
}

/** Three distinct ids, at most one `arena`, at least one `close` and one `ranged`. */
export function movesAreLegal(ids: readonly CustodianPatternId[], enemyPool: readonly EnemyId[]): boolean {
  if (ids.length !== 3 || new Set(ids).size !== 3) return false;
  const classes = ids.map((id) => CUSTODIAN_PATTERNS[id].patternClass);
  if (classes.filter((c) => c === 'arena').length > 1) return false;
  if (!classes.includes('close') || !classes.includes('ranged')) return false;
  if (ids.includes('summon_choir') && enemyPool.filter((id) => id !== 'guardian').length < 2) return false;
  return true;
}

/**
 * Substitutes from DEFAULT_CUSTODIAN_MOVES one slot at a time until the set is legal.
 * Generation never fails over the boss: this always returns three usable ids.
 */
export function repairMoves(ids: readonly CustodianPatternId[], enemyPool: readonly EnemyId[]): [CustodianPatternId, CustodianPatternId, CustodianPatternId] {
  const out = [...ids].slice(0, 3) as CustodianPatternId[];
  while (out.length < 3) out.push(DEFAULT_CUSTODIAN_MOVES[out.length]!);
  if (movesAreLegal(out, enemyPool)) return out as [CustodianPatternId, CustodianPatternId, CustodianPatternId];
  for (let slot = 0; slot < 3; slot++) {
    for (const candidate of [...DEFAULT_CUSTODIAN_MOVES, ...CUSTODIAN_PATTERN_IDS]) {
      const trial = [...out];
      trial[slot] = candidate;
      if (movesAreLegal(trial, enemyPool)) return trial as [CustodianPatternId, CustodianPatternId, CustodianPatternId];
    }
  }
  return [...DEFAULT_CUSTODIAN_MOVES] as [CustodianPatternId, CustodianPatternId, CustodianPatternId];
}

function clip(value: unknown, max: number): unknown {
  return typeof value === 'string' ? value.trim().slice(0, max) : value;
}

/**
 * Over-long model text costs that field, never the whole Custodian: clip to the contract limits
 * before parsing, and let `keepText` decide whether what survives is house style.
 */
function clipSpec(spec: unknown): unknown {
  if (spec === null || typeof spec !== 'object') return spec;
  const raw = spec as { title?: unknown; phaseTitles?: unknown; moves?: unknown };
  return {
    ...raw,
    title: clip(raw.title, 40),
    phaseTitles: Array.isArray(raw.phaseTitles) ? raw.phaseTitles.map((title) => clip(title, 40)) : raw.phaseTitles,
    moves: Array.isArray(raw.moves) ? raw.moves.map((move) => move !== null && typeof move === 'object'
      ? { ...move, name: clip((move as { name?: unknown }).name, 32), tell: clip((move as { tell?: unknown }).tell, 60) }
      : move) : raw.moves,
  };
}

/** Keeps model text only when it passes the house style; otherwise the registry's own line. */
function keepText(text: unknown, kind: 'bossName' | 'bossCallout', fallback: string): string {
  if (typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (trimmed.length === 0) return fallback;
  return lintProse(trimmed, { kind }).hardFail ? fallback : trimmed;
}

/**
 * The world's Custodian. With a recipe slot it is the model's; without one the three patterns
 * are drawn deterministically from the world seed and its motifs, so the same world always
 * produces the same fight (co-op clients and the server must agree without talking).
 */
export function resolveCustodian(selection: CustodianSelection): ResolvedCustodian {
  const enemyPool = selection.enemyPool ?? [];
  const parsed = CustodianSchema.safeParse(clipSpec(selection.spec));
  if (parsed.success) {
    const ids = repairMoves(parsed.data.moves.map((move) => move.patternId), enemyPool);
    const moves = ids.map((id, index) => {
      const spec = CUSTODIAN_PATTERNS[id];
      const supplied = parsed.data.moves[index]?.patternId === id ? parsed.data.moves[index] : undefined;
      return {
        patternId: id,
        name: keepText(supplied?.name, 'bossName', spec.defaultName),
        tell: keepText(supplied?.tell, 'bossCallout', spec.defaultTell),
      };
    }) as [CustodianMove, CustodianMove, CustodianMove];
    const titles = parsed.data.phaseTitles.map((title, index) => keepText(title, 'bossName', DEFAULT_PHASE_TITLES[index]!));
    return {
      title: keepText(parsed.data.title, 'bossName', DEFAULT_CUSTODIAN_TITLE),
      phaseTitles: titles as [string, string, string],
      moves,
      source: 'recipe',
    };
  }
  const rng = createRng(seedKey('custodian', selection.seed, ...(selection.motifIds ?? [])));
  const shuffled = rng.shuffle(CUSTODIAN_PATTERN_IDS);
  const picked: CustodianPatternId[] = [];
  for (const id of shuffled) {
    const trial = [...picked, id];
    const classes = trial.map((pick) => CUSTODIAN_PATTERNS[pick].patternClass);
    if (classes.filter((c) => c === 'arena').length > 1) continue;
    if (id === 'summon_choir' && enemyPool.filter((pool) => pool !== 'guardian').length < 2) continue;
    picked.push(id);
    if (picked.length === 3) break;
  }
  const ids = repairMoves(picked, enemyPool);
  return {
    title: DEFAULT_CUSTODIAN_TITLE,
    phaseTitles: [...DEFAULT_PHASE_TITLES] as [string, string, string],
    moves: ids.map((id) => ({
      patternId: id, name: CUSTODIAN_PATTERNS[id].defaultName, tell: CUSTODIAN_PATTERNS[id].defaultTell,
    })) as [CustodianMove, CustodianMove, CustodianMove],
    source: 'derived',
  };
}

/** `THE LAST CUSTODIAN · FRACTURE`, or the world's own words for both halves. */
export function custodianTitle(custodian: ResolvedCustodian, phase: 1 | 2 | 3): string {
  return `${custodian.title} · ${custodian.phaseTitles[phase - 1]}`;
}
