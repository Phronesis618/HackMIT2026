/**
 * World laws and world look — closed registries the model CHOOSES from.
 *
 * Owner: agent W2 (schema + prompt + validation only). NOTHING HERE IS IMPLEMENTED in the
 * sim or renderer yet: agent M1 implements behaviour from this file. Until then a recipe's
 * `laws` and `look` are validated, stored and ignored.
 *
 * Design rules (same as the rest of the recipe): the model never scripts behaviour. It
 * picks ids from a closed set plus one bounded intensity, and NAMES the law in-world under
 * docs/WRITING.md. Trusted code owns every number: `params[intensity - 1]` below.
 *
 *  - A world has 2–3 laws with distinct ids; laws in the same `group` never combine.
 *  - Every law must change what a player DOES in a fight, not only a stat total.
 *  - `solo` says what happens with one player, so no law is dead in a solo run.
 *  - `touches` tells M1 which system implements it.
 */
import { z } from 'zod';
import { MOTIF_IDS, type MotifId } from './registry';

export type LawSystem = 'sim' | 'director' | 'render';
export interface LawInfo {
  /** Plain description for the model and for the in-game law card (engine-owned text). */
  summary: string;
  /** Mutually exclusive families. */
  group: 'movement' | 'enemies' | 'damage' | 'terrain' | 'tempo' | 'crew' | 'vision';
  touches: LawSystem[];
  /** Bounded parameters per intensity 1, 2, 3. Units are in the key names. */
  params: [Record<string, number>, Record<string, number>, Record<string, number>];
  solo: string;
}

export const LAW_IDS = [
  'long_dash', 'slick_floors', 'swarm', 'elite_hunt', 'volatile_dead', 'glass_cannon',
  'ricochet', 'brittle_world', 'live_conduits', 'surge_cycle', 'bounty_clock',
  'tethered_crew', 'read_to_mend', 'blackout',
] as const;
export type LawId = (typeof LAW_IDS)[number];

export const LAW_INFO: Record<LawId, LawInfo> = {
  long_dash: {
    summary: 'Dashes travel farther but recharge slower. Gaps and rubble matter less; mistimed dashes cost more.',
    group: 'movement', touches: ['sim'], solo: 'Same.',
    params: [{ dashDistancePct: 20, dashCooldownPct: 10 }, { dashDistancePct: 35, dashCooldownPct: 20 }, { dashDistancePct: 50, dashCooldownPct: 30 }],
  },
  slick_floors: {
    summary: 'Everyone, enemies included, keeps sliding briefly after they stop moving. Knockback carries farther.',
    group: 'movement', touches: ['sim'], solo: 'Same.',
    params: [{ slideMs: 120, knockbackPct: 15 }, { slideMs: 200, knockbackPct: 30 }, { slideMs: 280, knockbackPct: 45 }],
  },
  swarm: {
    summary: 'More enemies per room, each with less health. Area attacks gain value; single-target builds struggle.',
    group: 'enemies', touches: ['director'], solo: 'Same.',
    params: [{ enemyCountPct: 25, enemyHealthPct: -20 }, { enemyCountPct: 50, enemyHealthPct: -33 }, { enemyCountPct: 75, enemyHealthPct: -43 }],
  },
  elite_hunt: {
    summary: 'Fewer enemies per room, but every combat room has one elite with more health that drops a heal when it falls.',
    group: 'enemies', touches: ['director', 'sim'], solo: 'Same.',
    params: [{ enemyCountPct: -20, eliteHealthPct: 40, healPct: 8 }, { enemyCountPct: -30, eliteHealthPct: 70, healPct: 10 }, { enemyCountPct: -40, eliteHealthPct: 100, healPct: 12 }],
  },
  volatile_dead: {
    summary: 'Enemies burst a moment after they fall, hurting everything near them, other enemies included. Kill them next to each other, then step away.',
    group: 'damage', touches: ['sim', 'render'], solo: 'Same.',
    params: [{ fuseMs: 900, radiusTiles: 1.5, damage: 12 }, { fuseMs: 800, radiusTiles: 2, damage: 18 }, { fuseMs: 700, radiusTiles: 2.5, damage: 24 }],
  },
  glass_cannon: {
    summary: 'All damage is raised, dealt and taken, for crew and enemies alike. Fights end quickly either way.',
    group: 'damage', touches: ['sim'], solo: 'Same.',
    params: [{ damagePct: 20 }, { damagePct: 35 }, { damagePct: 50 }],
  },
  ricochet: {
    summary: 'Projectiles from crew and enemies bounce off walls once. Cover protects less; angles matter.',
    group: 'damage', touches: ['sim'], solo: 'Same.',
    params: [{ bounces: 1, bounceDamagePct: 50 }, { bounces: 1, bounceDamagePct: 75 }, { bounces: 2, bounceDamagePct: 75 }],
  },
  brittle_world: {
    summary: 'More walls are breakable, and breaking one stuns enemies next to it. The crew can cut its own routes.',
    group: 'terrain', touches: ['director', 'sim'], solo: 'Same.',
    params: [{ breakableWallPct: 30, stunMs: 600 }, { breakableWallPct: 50, stunMs: 800 }, { breakableWallPct: 70, stunMs: 1000 }],
  },
  live_conduits: {
    summary: 'Conduit lanes carry a charge on a timer: standing on one when it fires hurts crew and enemies. Lure enemies onto the lanes.',
    group: 'terrain', touches: ['sim', 'render'], solo: 'Same.',
    params: [{ periodMs: 6000, warnMs: 1200, damage: 10 }, { periodMs: 5000, warnMs: 1000, damage: 15 }, { periodMs: 4000, warnMs: 900, damage: 20 }],
  },
  surge_cycle: {
    summary: 'On a fixed cycle the whole room speeds up for a few seconds, crew and enemies both, with a countdown on the HUD.',
    group: 'tempo', touches: ['sim', 'render'], solo: 'Same.',
    params: [{ periodMs: 24000, surgeMs: 4000, speedPct: 20 }, { periodMs: 20000, surgeMs: 5000, speedPct: 30 }, { periodMs: 16000, surgeMs: 5000, speedPct: 40 }],
  },
  bounty_clock: {
    summary: 'Clearing a room before its timer runs out drops a heal. Slow, careful play gives up the reward.',
    group: 'tempo', touches: ['sim', 'render'], solo: 'Timer is 25% longer.',
    params: [{ clearSeconds: 40, healPct: 8 }, { clearSeconds: 32, healPct: 10 }, { clearSeconds: 25, healPct: 12 }],
  },
  tethered_crew: {
    summary: 'Operatives close to a crewmate take less damage; operatives alone take more. The crew moves as one or pays for it.',
    group: 'crew', touches: ['sim', 'render'], solo: 'The bonus applies while within range of the last relic read or the room entrance.',
    params: [{ rangeTiles: 6, nearDamagePct: -10, farDamagePct: 10 }, { rangeTiles: 5, nearDamagePct: -15, farDamagePct: 15 }, { rangeTiles: 4, nearDamagePct: -20, farDamagePct: 25 }],
  },
  read_to_mend: {
    summary: 'Healing drops are rarer, but reading a relic heals the whole crew. Exploring for lore is how the crew recovers.',
    group: 'crew', touches: ['sim', 'director'], solo: 'Same.',
    params: [{ healDropPct: -25, relicHealPct: 10 }, { healDropPct: -40, relicHealPct: 15 }, { healDropPct: -55, relicHealPct: 20 }],
  },
  blackout: {
    summary: 'Rooms are dark beyond a radius around each operative and each light source. Enemy telegraphs still show.',
    group: 'vision', touches: ['render'], solo: 'Radius is one tile wider.',
    params: [{ visionTiles: 9 }, { visionTiles: 7 }, { visionTiles: 5.5 }],
  },
};

export const MIN_WORLD_LAWS = 2;
export const MAX_WORLD_LAWS = 3;

export const WorldLawSchema = z.object({
  lawId: z.enum(LAW_IDS),
  /** In-world name, the way the inhabitants would have said it: "Sele's 140% Order". */
  name: z.string().trim().min(1).max(40),
  /** One owner fact from the bible explaining why this place works this way. No numbers for the effect. */
  description: z.string().trim().min(1).max(160),
  intensity: z.number().int().min(1).max(3),
});
export type WorldLaw = z.infer<typeof WorldLawSchema>;

export const WorldLawListSchema = z.array(WorldLawSchema).max(MAX_WORLD_LAWS);

/** Drops duplicate ids and same-group laws (first wins). Never throws: laws are optional flavour. */
export function sanitizeLaws(laws: readonly WorldLaw[]): { laws: WorldLaw[]; dropped: number } {
  const ids = new Set<LawId>();
  const groups = new Set<string>();
  const kept: WorldLaw[] = [];
  for (const law of laws) {
    const group = LAW_INFO[law.lawId].group;
    if (ids.has(law.lawId) || groups.has(group) || kept.length >= MAX_WORLD_LAWS) continue;
    ids.add(law.lawId);
    groups.add(group);
    kept.push(law);
  }
  return { laws: kept, dropped: laws.length - kept.length };
}

/** Resolved numbers for a law, for M1. */
export function lawParams(law: Pick<WorldLaw, 'lawId' | 'intensity'>): Record<string, number> {
  return LAW_INFO[law.lawId].params[law.intensity - 1]!;
}

// ---------------------------------------------------------------------------
// World look: bounded renderer parameters beyond the palette
// ---------------------------------------------------------------------------

/** Same ids as `FloorPattern` in src/client/render/dressing.ts (which derives one from the first motif today). */
export const FLOOR_MATERIALS = ['plates', 'lattice', 'flagstone', 'grating', 'crystal', 'organic', 'slabs', 'boards'] as const;
export const FLOOR_MATERIAL_INFO: Record<(typeof FLOOR_MATERIALS)[number], string> = {
  plates: 'riveted metal deck plates', lattice: 'open lattice over a drop', flagstone: 'irregular cut stone',
  grating: 'industrial floor grating', crystal: 'faceted mineral floor', organic: 'soil, moss and root mat',
  slabs: 'large poured or carved slabs', boards: 'timber boards',
};

/** One wall construction style per motif in dressing.ts `drawWallDressing`; the value is the motif whose drawing code it reuses. */
export const WALL_STYLES = ['pinnacled', 'arched', 'piped', 'shard_veined', 'overgrown', 'glyph_banded', 'lantern_hung', 'geared'] as const;
export const WALL_STYLE_INFO: Record<(typeof WALL_STYLES)[number], { motif: MotifId; summary: string }> = {
  pinnacled: { motif: 'spires', summary: 'pinnacles, fins and landing lights' },
  arched: { motif: 'arches', summary: 'arched openings and vault ribs' },
  piped: { motif: 'cables', summary: 'pipe runs, junction boxes, cable trays' },
  shard_veined: { motif: 'crystals', summary: 'mineral veins and shards on the wall caps' },
  overgrown: { motif: 'roots', summary: 'tendrils, moss and root masses' },
  glyph_banded: { motif: 'monoliths', summary: 'bands of cut glyphs on plain slabs' },
  lantern_hung: { motif: 'lanterns', summary: 'hanging lanterns and lantern strings' },
  geared: { motif: 'ruined_machinery', summary: 'gears, vents and hanging chains' },
};
const wallMotifs = new Set<string>(Object.values(WALL_STYLE_INFO).map((style) => style.motif));
if (MOTIF_IDS.some((id) => !wallMotifs.has(id))) throw new Error('laws.ts: every motif needs a wall style');

/** Lighting moods. Numbers are for M1's renderer: ambient 0..1 brightness, vignette 0..1, tint source, flicker. */
export const LIGHTING_MOODS = ['floodlit', 'overcast', 'dusk', 'emergency', 'lamplit', 'glare'] as const;
export const LIGHTING_MOOD_INFO: Record<(typeof LIGHTING_MOODS)[number], { summary: string; ambient: number; vignette: number; tint: 'none' | 'accent' | 'danger' | 'warm' | 'cold'; flicker: boolean }> = {
  floodlit: { summary: 'even white work lighting, everything visible', ambient: 0.95, vignette: 0.1, tint: 'none', flicker: false },
  overcast: { summary: 'flat grey daylight, soft shadows', ambient: 0.8, vignette: 0.2, tint: 'cold', flicker: false },
  dusk: { summary: 'low warm light from one side, long shadows', ambient: 0.6, vignette: 0.35, tint: 'warm', flicker: false },
  emergency: { summary: 'backup lighting in the danger colour, flickering', ambient: 0.5, vignette: 0.45, tint: 'danger', flicker: true },
  lamplit: { summary: 'dark, with pools of light around props and lanterns', ambient: 0.35, vignette: 0.55, tint: 'accent', flicker: false },
  glare: { summary: 'overbright, washed out, hard highlights', ambient: 1, vignette: 0, tint: 'accent', flicker: false },
};

/** Same ids as `MoteStyle` in dressing.ts, plus `none`. */
export const PARTICLE_STYLES = ['none', 'sparks', 'dust', 'flicker', 'glints', 'spores', 'ash', 'fireflies', 'embers'] as const;

export const WorldLookSchema = z.object({
  floorMaterial: z.enum(FLOOR_MATERIALS),
  wallStyle: z.enum(WALL_STYLES),
  lighting: z.enum(LIGHTING_MOODS),
  particles: z.enum(PARTICLE_STYLES),
  /** 1 = a few motes, 3 = thick. Ignored when particles is `none`. */
  particleDensity: z.number().int().min(1).max(3),
});
export type WorldLook = z.infer<typeof WorldLookSchema>;

/** Compact registry text for prompts and the operator request file. */
export function lawsAndLookRegistry(): Record<string, unknown> {
  return {
    laws: Object.fromEntries(LAW_IDS.map((id) => [id, `${LAW_INFO[id].summary} [group: ${LAW_INFO[id].group}]`])),
    floorMaterials: FLOOR_MATERIAL_INFO,
    wallStyles: Object.fromEntries(WALL_STYLES.map((id) => [id, WALL_STYLE_INFO[id].summary])),
    lighting: Object.fromEntries(LIGHTING_MOODS.map((id) => [id, LIGHTING_MOOD_INFO[id].summary])),
    particles: PARTICLE_STYLES,
  };
}
