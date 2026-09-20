/**
 * World laws, world look, terrain skins and Custodian move picks: closed registries the
 * model CHOOSES from and NAMES. The engine owns every number.
 *
 * Owner: agent W2 (schema + prompt + validation only). NOTHING HERE IS IMPLEMENTED in the sim
 * or renderer yet. Ids, groups, budgets, conflict pairs and look ids follow
 * docs/design/WORLD_MUTATORS.md (laws section 2-3, look section 5); terrain skins follow
 * docs/design/TILES.md section 4.1; Custodian moves follow docs/design/BOSS_FINALE.md section 2.
 * `ResolvedLaws` / `resolveLaws` / `NEUTRAL_LAWS` (WORLD_MUTATORS section 1) are M1's to add here:
 * the numeric bands live in that document, not in the prompt.
 *
 * The recipe fields (`laws`, `look`, `terrainSkins`, `custodian`) are optional and bounded;
 * a recipe without them plays exactly as before. `sanitizeLaws` / `sanitizeCustodian` apply
 * the documents' guard-rails and never throw: generation never fails over flavour.
 */
import { z } from 'zod';
import { TERRAIN_FEATURE_IDS } from './registry';

export const WORLD_LAW_IDS = [
  // movement
  'thin_air', 'tidal_drag', 'committed_strike',
  // combat
  'glass_lattice', 'long_echo', 'bleeding_light', 'first_light',
  // enemies
  'few_and_terrible', 'the_many', 'wardens_watch', 'restless', 'unstable_matter',
  // terrain
  'hollow_ground', 'slow_fire', 'sealed_halls',
  // vision / look
  'long_dark', 'mirror_halls', 'held_breath',
] as const;
export type WorldLawId = (typeof WORLD_LAW_IDS)[number];
export type LawGroup = 'movement' | 'combat' | 'enemies' | 'terrain' | 'vision';

export const LAW_INFO: Record<WorldLawId, {
  group: LawGroup;
  /** Injected verbatim into the model prompt. Numbers are at intensity 0.5. */
  summary: string;
  /** Difficulty budget: negative helps the crew, positive hurts. */
  budget: -2 | -1 | 0 | 1 | 2;
  /**
   * True when the simulation or renderer applies this law today. Unimplemented laws are never
   * offered to the model (`lawsAndLookRegistry`), fixtures do not use them and `WorldLaws`
   * lists only laws in force, so no player is shown a law that does nothing.
   * tests/sim/law-honesty.test.ts keeps this in step
   * with `IMPLEMENTED_LAW_IDS` in src/sim/laws.ts.
   */
  implemented: boolean;
}> = {
  thin_air: { group: 'movement', budget: -1, implemented: true, summary: 'Dashes carry about 65% farther on a 25% longer cooldown. Gaps and hazard fields become crossable in one move.' },
  tidal_drag: { group: 'movement', budget: 0, implemented: true, summary: 'Crew and enemies walk about 17% slower; dash cooldown drops by a third. Movement becomes dashes with short walks between.' },
  committed_strike: { group: 'movement', budget: 0, implemented: true, summary: 'Operatives are rooted for the 220 ms of their own attack and hit 25% harder.' },
  glass_lattice: { group: 'combat', budget: 2, implemented: true, summary: 'Operatives have 48 Integrity instead of 100 and deal 1.8x damage. Every hit and hazard matters.' },
  long_echo: { group: 'combat', budget: -1, implemented: true, summary: 'Ability cooldowns are about a third shorter; the ultimate charges 25% slower.' },
  bleeding_light: { group: 'combat', budget: 2, implemented: false, summary: 'Abilities heal nothing. Reading a relic restores 32 Integrity to every living operative, once per relic.' },
  first_light: { group: 'combat', budget: -1, implemented: true, summary: "The crew's first hit on an enemy deals 2.5x damage." },
  few_and_terrible: { group: 'enemies', budget: 1, implemented: true, summary: 'Half as many enemies, each with 2.2x health and 28% more damage. Fights become duels.' },
  the_many: { group: 'enemies', budget: 1, implemented: true, summary: '1.8x as many enemies, each at 55% health and 78% damage. One wide attack can catch four of them.' },
  wardens_watch: { group: 'enemies', budget: 2, implemented: false, summary: 'About 37% of enemies are elites: +60% health, +25% damage, a visible ring, better drops.' },
  restless: { group: 'enemies', budget: 1, implemented: false, summary: 'A defeated enemy stands back up once after 11.5 s at 42% health unless an operative walks over its marker first.' },
  unstable_matter: { group: 'enemies', budget: 1, implemented: true, summary: 'Enemies burst when they fall: 70 px radius, 12 damage to crew, 20 to other enemies. Bursts chain through packs.' },
  hollow_ground: { group: 'terrain', budget: 1, implemented: false, summary: 'Rooms get one extra terrain feature and, at high intensity, one step denser terrain.' },
  slow_fire: { group: 'terrain', budget: 0, implemented: false, summary: 'Within 3 tiles of a live hazard everything moves at 57% speed and bolts at 72%. Dashes are exempt.' },
  sealed_halls: { group: 'terrain', budget: 1, implemented: false, summary: 'Every combat room is split by a sealing door or gate, with the exit on the far side.' },
  long_dark: { group: 'vision', budget: 2, implemented: true, summary: 'Sight fails past about 215 px from an operative; enemies beyond it are not drawn. Lanterns and conduits add light.' },
  mirror_halls: { group: 'vision', budget: 1, implemented: false, summary: 'The minimap is hidden and a room name is withheld until the room is entered.' },
  held_breath: { group: 'vision', budget: 0, implemented: false, summary: 'Enemy attack sounds are muted; in exchange every telegraph lasts about 32% longer and draws brighter.' },
};

/** WORLD_MUTATORS.md section 3.1. */
export const LAW_CONFLICTS: ReadonlyArray<readonly [WorldLawId, WorldLawId]> = [
  ['few_and_terrible', 'the_many'],
  ['thin_air', 'tidal_drag'],
  ['long_dark', 'mirror_halls'],
  ['long_dark', 'held_breath'],
  ['glass_lattice', 'bleeding_light'],
  ['glass_lattice', 'unstable_matter'],
  ['bleeding_light', 'restless'],
];
/** At most this many laws per group (section 3.2); groups not listed: no cap below MAX_WORLD_LAWS. */
export const LAW_GROUP_CAPS: Partial<Record<LawGroup, number>> = { combat: 1, enemies: 2, vision: 1 };
export const LAW_BUDGET_RANGE = { min: -1, max: 3 } as const;
export const MAX_WORLD_LAWS = 3;

export const WorldLawSchema = z.object({
  lawId: z.enum(WORLD_LAW_IDS),
  /** The world's name for this law: "Sele's 140% Order". */
  name: z.string().trim().min(1).max(36),
  /** Shown on the creation receipt and the pre-portal card. One bible fact; goes through prose.ts. */
  description: z.string().trim().min(1).max(160),
  /** Interpolates INSIDE the law's hard-clamped band. The model never sets a raw number. */
  intensity: z.number().min(0).max(1),
});
export type WorldLaw = z.infer<typeof WorldLawSchema>;
export const WorldLawListSchema = z.array(WorldLawSchema).max(MAX_WORLD_LAWS);

/**
 * Guard-rails from WORLD_MUTATORS.md section 3, in trusted code: distinct ids, conflict pairs
 * (the earlier law wins), group caps, then the difficulty budget (drop the highest-budget law
 * while the total is over, the lowest while it is under; ties drop the later one).
 */
export function sanitizeLaws(laws: readonly WorldLaw[]): { laws: WorldLaw[]; dropped: number } {
  let kept: WorldLaw[] = [];
  for (const law of laws) {
    const { group } = LAW_INFO[law.lawId];
    const conflicts = kept.some((other) => other.lawId === law.lawId
      || LAW_CONFLICTS.some(([a, b]) => (a === law.lawId && b === other.lawId) || (b === law.lawId && a === other.lawId)));
    const cap = LAW_GROUP_CAPS[group] ?? MAX_WORLD_LAWS;
    if (conflicts || kept.length >= MAX_WORLD_LAWS || kept.filter((other) => LAW_INFO[other.lawId].group === group).length >= cap) continue;
    kept.push(law);
  }
  const total = () => kept.reduce((sum, law) => sum + LAW_INFO[law.lawId].budget, 0);
  for (let pass = 0; pass < MAX_WORLD_LAWS && kept.length > 0 && (total() > LAW_BUDGET_RANGE.max || total() < LAW_BUDGET_RANGE.min); pass++) {
    const over = total() > LAW_BUDGET_RANGE.max;
    let target = 0;
    kept.forEach((law, index) => {
      const budget = LAW_INFO[law.lawId].budget;
      const current = LAW_INFO[kept[target]!.lawId].budget;
      if (over ? budget >= current : budget <= current) target = index;
    });
    kept = kept.filter((_, index) => index !== target);
  }
  return { laws: kept, dropped: laws.length - kept.length };
}

// ---------------------------------------------------------------------------
// World look: bounded renderer parameters beyond the palette (WORLD_MUTATORS.md section 5.1)
// ---------------------------------------------------------------------------

export const PALETTE_FAMILY_IDS = ['ink_neon', 'bleach', 'rust', 'bloom', 'monochrome', 'sodium'] as const;
/** First eight are today's `FloorPattern` in src/client/render/dressing.ts. */
export const FLOOR_MATERIAL_IDS = ['plates', 'lattice', 'flagstone', 'grating', 'crystal', 'organic', 'slabs', 'boards', 'sand', 'mosaic', 'ice', 'sheet_metal'] as const;
export const WALL_STYLE_IDS = ['blockwork', 'panelled', 'hewn', 'overgrown', 'glass', 'girder'] as const;
export const LIGHTING_IDS = ['overhead', 'rim', 'underlit', 'shafts', 'flat', 'stormlight'] as const;
/** First eight are today's `MoteStyle` in dressing.ts. */
export const ATMOSPHERE_IDS = ['sparks', 'dust', 'flicker', 'glints', 'spores', 'ash', 'fireflies', 'embers', 'rain', 'snow', 'drift', 'none'] as const;

/** Plain descriptions for the prompt. The renderer owns what each id draws. */
export const LOOK_INFO = {
  paletteFamily: {
    ink_neon: 'dark, saturated, backlit (the default look)', bleach: 'sun-bleached, overexposed, daytime', rust: 'oxidised, industrial, warm',
    bloom: 'wet, luminous, overgrown', monochrome: 'greys on one hue, stark and printed; hazards keep their colour', sodium: 'streetlight at night, low saturation amber',
  },
  floorMaterial: {
    plates: 'riveted deck plates', lattice: 'open lattice over a drop', flagstone: 'irregular cut stone', grating: 'industrial grating',
    crystal: 'faceted mineral', organic: 'soil, moss and root mat', slabs: 'large poured or carved slabs', boards: 'timber boards',
    sand: 'drifted sand', mosaic: 'small tiles, some tinted', ice: 'near-white ice with fracture lines', sheet_metal: 'large bolted brushed plates',
  },
  wallStyle: {
    blockwork: 'laid blocks', panelled: 'fitted panels', hewn: 'cut from rock', overgrown: 'taken over by growth', glass: 'glazed', girder: 'exposed steel frame',
  },
  lighting: {
    overhead: 'lit from above (the default)', rim: 'dark walls with a bright accent rim', underlit: 'lit from the floor', shafts: 'vertical bands of light across the room',
    flat: 'no shadows, reads as a blueprint', stormlight: 'slow pulsing light',
  },
  atmosphere: {
    sparks: 'sparks', dust: 'dust', flicker: 'electrical flicker', glints: 'mineral glints', spores: 'spores', ash: 'ash', fireflies: 'fireflies',
    embers: 'embers', rain: 'rain', snow: 'snow', drift: 'large slow translucent shapes', none: 'still air',
  },
} as const;

export const WorldLookSchema = z.object({
  paletteFamily: z.enum(PALETTE_FAMILY_IDS),
  floorMaterial: z.enum(FLOOR_MATERIAL_IDS),
  wallStyle: z.enum(WALL_STYLE_IDS),
  lighting: z.enum(LIGHTING_IDS),
  atmosphere: z.enum(ATMOSPHERE_IDS),
  /** 0 = none, 1 = thick. */
  atmosphereDensity: z.number().min(0).max(1),
  /** 0 = reads as an interior, 1 = a skyline far behind the room. */
  skylineDepth: z.number().min(0).max(1),
  /** Per-tile luminance noise, a film-stock feel. */
  grain: z.number().min(0).max(1),
});
export type WorldLook = z.infer<typeof WorldLookSchema>;

// ---------------------------------------------------------------------------
// Terrain skins (TILES.md section 4.1): the world names each tile mechanic it uses
// ---------------------------------------------------------------------------

export const TerrainSkinSchema = z.object({
  featureId: z.enum(TERRAIN_FEATURE_IDS),
  /** In-world name: "tide-gauge vents", "ledger stacks". */
  name: z.string().trim().min(1).max(28),
  /** Replaces the hard-coded HUD caption: what it is and what it does to movement, plainly. */
  caption: z.string().trim().min(1).max(60),
});
export type TerrainSkin = z.infer<typeof TerrainSkinSchema>;
export const TerrainSkinListSchema = z.array(TerrainSkinSchema).max(15);

/** One skin per feature id, only for features the world uses. */
export function sanitizeTerrainSkins(skins: readonly TerrainSkin[], usedFeatureIds: readonly string[]): TerrainSkin[] {
  const seen = new Set<string>();
  return skins.filter((skin) => usedFeatureIds.includes(skin.featureId) && !seen.has(skin.featureId) && Boolean(seen.add(skin.featureId)));
}

// ---------------------------------------------------------------------------
// Custodian (final boss) move picks (BOSS_FINALE.md section 2). When src/shared/custodian.ts
// lands with the sim side, it should import or take over these ids.
// ---------------------------------------------------------------------------

export const CUSTODIAN_PATTERN_IDS = [
  'sweep_arc', 'siege_charge', 'ring_bloom', 'summon_choir', 'tether_haul',
  'arena_flood', 'mirror_shade', 'pylon_lock', 'gravity_well', 'shatter_step', 'overload_vent',
] as const;
export type CustodianPatternId = (typeof CUSTODIAN_PATTERN_IDS)[number];
export type PatternClass = 'close' | 'ranged' | 'arena' | 'control';

export const CUSTODIAN_PATTERN_INFO: Record<CustodianPatternId, { class: PatternClass; summary: string }> = {
  sweep_arc: { class: 'ranged', summary: 'a beam sweeps 300 degrees around the boss; walk with the sweep or stand close' },
  siege_charge: { class: 'close', summary: 'backs up, then dashes 260 px destroying breakable walls it crosses; sidestep one tile' },
  ring_bloom: { class: 'ranged', summary: 'two rings of 12 bolts, the second offset; dash through a gap' },
  summon_choir: { class: 'control', summary: 'stands still and calls four enemies from the biome pool; takes 25% more damage while casting' },
  tether_haul: { class: 'control', summary: 'a visible line to the farthest operative, then hauls them 180 px in; break line of sight' },
  arena_flood: { class: 'arena', summary: 'marks 40% of the floor in lanes, then the marked tiles become hazard for 2.5 s; a safe route always exists' },
  mirror_shade: { class: 'control', summary: 'two harmless decoys copy its next telegraph; the real one keeps its rim light' },
  pylon_lock: { class: 'arena', summary: 'gates split the arena into wedges for 6 s and a beam hits whoever shares its wedge' },
  gravity_well: { class: 'arena', summary: 'pulls everything toward the boss for 2 s, enemies and canisters included; no direct damage' },
  shatter_step: { class: 'close', summary: 'an after-image shows where it will teleport, then a radial burst there; walk off the mark' },
  overload_vent: { class: 'arena', summary: 'every vent in the room fires three times while the boss stands still and takes 30% more damage' },
};
export const DEFAULT_CUSTODIAN_MOVES = ['ring_bloom', 'siege_charge', 'arena_flood'] as const;
/** Engine-owned plain text for a substituted move (the model's own name and tell described another attack). */
const DEFAULT_MOVE_TEXT: Record<(typeof DEFAULT_CUSTODIAN_MOVES)[number], { name: string; tell: string }> = {
  ring_bloom: { name: 'Bolt rings', tell: 'TWO RINGS OF BOLTS. DASH THROUGH A GAP.' },
  siege_charge: { name: 'Charge', tell: 'IT BACKS UP TO CHARGE. STEP ONE TILE ASIDE.' },
  arena_flood: { name: 'Marked floor', tell: 'MARKED FLOOR GOES LIVE. FOLLOW THE CLEAR LANE.' },
};

// Single source of truth for the recipe's Custodian slot is src/shared/custodian.ts (agent B1's
// runtime reads it). Re-exported here so the generation pipeline keeps importing from laws.ts.
import { CustodianSchema, CustodianMoveSchema, movesAreLegal, type CustodianRecipe } from './custodian';
export { CustodianSchema, CustodianMoveSchema };
export type Custodian = CustodianRecipe;

/**
 * True when the three moves are legal under BOSS_FINALE section 2.1. One rule, one owner:
 * this defers to `movesAreLegal` in custodian.ts, which the boss runtime uses. Callers here
 * hold a count of the non-boss cast rather than the cast itself, so a pool of that size is
 * synthesised; `movesAreLegal` only ever counts its non-guardian entries.
 */
export function custodianMovesValid(patternIds: readonly CustodianPatternId[], nonBossPoolSize: number): boolean {
  return movesAreLegal(patternIds, Array.from({ length: Math.max(0, nonBossPoolSize) }, () => 'husk' as const));
}

/**
 * Substitutes default patterns one at a time until the move set is legal. A substituted move
 * loses its model-written name and tell (they described another attack) and gets plain ones.
 */
export function sanitizeCustodian(custodian: Custodian, nonBossPoolSize: number): { custodian: Custodian; substituted: number } {
  const moves = custodian.moves.map((move) => ({ ...move }));
  let substituted = 0;
  for (let index = moves.length - 1; index >= 0 && !custodianMovesValid(moves.map((move) => move.patternId), nonBossPoolSize); index--) {
    const replacement = DEFAULT_CUSTODIAN_MOVES.find((id) => !moves.some((move, other) => other !== index && move.patternId === id))!;
    moves[index] = { patternId: replacement, ...DEFAULT_MOVE_TEXT[replacement] };
    substituted++;
  }
  if (!custodianMovesValid(moves.map((move) => move.patternId), nonBossPoolSize)) {
    DEFAULT_CUSTODIAN_MOVES.forEach((id, index) => { moves[index] = { patternId: id, ...DEFAULT_MOVE_TEXT[id] }; });
    substituted = 3;
  }
  return { custodian: { ...custodian, moves }, substituted };
}

/** Compact registry text for prompts and the operator request file. */
export function lawsAndLookRegistry(): Record<string, unknown> {
  return {
    // Only laws the engine applies are offered: the model cannot pick a law that does nothing.
    laws: Object.fromEntries(WORLD_LAW_IDS.filter((id) => LAW_INFO[id].implemented).map((id) => [id, `${LAW_INFO[id].summary} [group ${LAW_INFO[id].group}, difficulty ${LAW_INFO[id].budget}]`])),
    lawConflicts: LAW_CONFLICTS.filter(([a, b]) => LAW_INFO[a].implemented && LAW_INFO[b].implemented),
    look: LOOK_INFO,
  };
}
export function custodianRegistry(): Record<string, string> {
  return Object.fromEntries(CUSTODIAN_PATTERN_IDS.map((id) => [id, `[${CUSTODIAN_PATTERN_INFO[id].class}] ${CUSTODIAN_PATTERN_INFO[id].summary}`]));
}
