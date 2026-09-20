/**
 * Biome briefs for a world — derived when the model wrote none.
 *
 * Owner: Agent F1b (floors core). Pure and deterministic.
 *
 * `deriveBiomeBriefs` turns any legacy `WorldRecipe` (title, motifs, 1–3 room blueprints)
 * into 8 valid briefs, so every fixture and every model output that predates floors is
 * playable as a floors world with no model change. The world's own blueprints become the
 * opener and the finale; the six biomes between them each take one layout archetype, one
 * world motif paired with one registry motif the world does not use, and an enemy pool
 * that gets more expensive with the tier the route deals the brief to.
 */
import type { WorldRecipe } from '../contracts';
import { BiomeBriefListSchema, type BiomeBrief, type BiomeLayout, type BiomeTerrain } from '../floors';
import { ENEMY_IDS, MOTIF_IDS, type EnemyId, type MotifId, type PropId } from '../registry';
import { ENEMY_COST } from './director';
import { createRng, seedKey } from './rng';
import { biomeTier, planWorldRoute } from './route';

/** Brief ids of a derived world, in brief order (first = opener, last = finale). */
export const DERIVED_BIOME_IDS = ['biome-1', 'biome-2', 'biome-3', 'biome-4', 'biome-5', 'biome-6', 'biome-7', 'biome-8'] as const;

interface Archetype {
  noun: string;
  tagline: string;
  layout: BiomeLayout;
  hazards: boolean;
  density: BiomeTerrain['density'];
}

const OPENER: Archetype = {
  noun: 'Approach', tagline: 'The way in. One road, few side rooms.', hazards: false, density: 'sparse',
  layout: { linearity: 0.8, branchiness: 0.2, specials: { treasure: 1, lore: 1, rest: 0, elite: 0 } },
};
const FINALE: Archetype = {
  noun: 'Core', tagline: 'The last floor. Thirty rooms, and the Anchor site behind its custodian.', hazards: true, density: 'dense',
  layout: { linearity: 0.5, branchiness: 0.5, specials: { treasure: 2, lore: 2, rest: 2, elite: 4 } },
};
/** The six middle biomes; a seeded shuffle decides which brief slot gets which. */
const MIDDLE: readonly Archetype[] = [
  {
    noun: 'Warren', tagline: 'A maze of short passages and dead ends. Most of the records are here.', hazards: true, density: 'balanced',
    layout: { linearity: 0.1, branchiness: 0.9, specials: { treasure: 1, lore: 3, rest: 1, elite: 1 } },
  },
  {
    noun: 'Wall', tagline: 'One long line of guarded rooms. Nowhere to rest.', hazards: false, density: 'dense',
    layout: { linearity: 0.95, branchiness: 0.05, specials: { treasure: 1, lore: 1, rest: 0, elite: 3 } },
  },
  {
    noun: 'Crossing', tagline: 'Four wings off a central hall. The exit is at the end of one of them.', hazards: false, density: 'balanced',
    layout: { linearity: 0.3, branchiness: 0.6, specials: { treasure: 1, lore: 2, rest: 1, elite: 2 } },
  },
  {
    noun: 'Vaults', tagline: 'Two sealed stores, each behind a heavy guard.', hazards: true, density: 'balanced',
    layout: { linearity: 0.55, branchiness: 0.45, specials: { treasure: 2, lore: 1, rest: 0, elite: 3 } },
  },
  {
    noun: 'Shelter', tagline: 'Quiet rooms where a crew can stop, and wide halls between them.', hazards: false, density: 'sparse',
    layout: { linearity: 0.35, branchiness: 0.35, specials: { treasure: 1, lore: 2, rest: 2, elite: 1 } },
  },
  {
    noun: 'Works', tagline: 'Flooded machine halls strung along a service corridor.', hazards: true, density: 'dense',
    layout: { linearity: 0.7, branchiness: 0.3, specials: { treasure: 1, lore: 1, rest: 1, elite: 2 } },
  },
];

const MOTIF_WORD: Record<MotifId, string> = {
  spires: 'Spire', arches: 'Arch', cables: 'Cable', crystals: 'Crystal',
  roots: 'Root', monoliths: 'Monolith', lanterns: 'Lantern', ruined_machinery: 'Machine',
};
const MOTIF_PROP: Record<MotifId, PropId> = {
  spires: 'pillar', arches: 'pillar', cables: 'cable_bundle', crystals: 'crystal_cluster',
  roots: 'root_mass', monoliths: 'monolith_shard', lanterns: 'lantern', ruined_machinery: 'terminal',
};
/** How many enemy kinds a biome of tier t fields, and the most expensive kind it may add from the registry. */
const POOL_SIZE = [2, 3, 3, 4, 4] as const;
const MAX_ADDED_COST = [2, 3, 4, 5, 5] as const;

/** Same defaults the legacy compiler uses for a blueprint without terrain. */
export function defaultBiomeTerrain(motif: MotifId, density: BiomeTerrain['density'] = 'balanced'): BiomeTerrain {
  if (motif === 'roots' || motif === 'crystals') return { features: ['breakable_walls', 'rubble'], layout: 'scattered', density };
  if (motif === 'arches' || motif === 'monoliths' || motif === 'spires') return { features: ['breakable_walls', 'bridges'], layout: 'barricades', density };
  return { features: ['bridges', 'conduits'], layout: 'crossroads', density };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function deriveBiomeBriefs(recipe: WorldRecipe, seed: string): BiomeBrief[] {
  const rng = createRng(seedKey(seed, 'briefs'));
  const route = planWorldRoute(seed, DERIVED_BIOME_IDS);
  const first = recipe.rooms[0]!;
  const last = recipe.rooms[recipe.rooms.length - 1]!;
  const worldMotifs = unique([...recipe.motifIds, ...recipe.rooms.flatMap((room) => room.motifIds)]);
  const foreignMotifs = rng.shuffle(MOTIF_IDS.filter((motif) => !worldMotifs.includes(motif)));
  const worldEnemies = unique(recipe.rooms.flatMap((room) => room.enemyIds)).filter((id) => id !== 'guardian');
  const worldProps = unique(recipe.rooms.flatMap((room) => room.propIds)).filter((id) => id !== 'anchor_pedestal');
  const registryEnemies = ENEMY_IDS.filter((id) => id !== 'guardian').sort((a, b) => ENEMY_COST[a] - ENEMY_COST[b] || a.localeCompare(b));
  const archetypes = [OPENER, ...rng.shuffle(MIDDLE), FINALE];
  const names = new Set<string>();

  const briefs = DERIVED_BIOME_IDS.map((id, slot): BiomeBrief => {
    const archetype = archetypes[slot]!;
    const tier = biomeTier(route, id) ?? 0;
    const blueprint = slot === 0 ? first : slot === DERIVED_BIOME_IDS.length - 1 ? last : undefined;

    // Motifs: the blueprint's own for opener/finale; otherwise one world motif + one the world lacks.
    const primary = blueprint ? blueprint.motifIds[0]! : worldMotifs[(slot - 1) % worldMotifs.length]!;
    const foreign = foreignMotifs.length > 0 ? foreignMotifs[(slot - 1) % foreignMotifs.length]! : primary;
    const motifIds = blueprint ? unique(blueprint.motifIds).slice(0, 3) : unique([primary, foreign]);

    // Enemies: the world's own kinds first (rotated per slot), then registry kinds the tier can afford.
    const size = POOL_SIZE[tier]!;
    const own = worldEnemies.map((_, i) => worldEnemies[(i + slot) % worldEnemies.length]!).slice(0, Math.max(1, size - 1));
    const affordable = rng.shuffle(registryEnemies.filter((enemy) => ENEMY_COST[enemy] <= MAX_ADDED_COST[tier]! && !own.includes(enemy)));
    const enemyPool: EnemyId[] = unique([...own, ...affordable]).slice(0, size);
    if (enemyPool.length === 0) enemyPool.push('husk');

    const rotatedProps = worldProps.map((_, i) => worldProps[(i + slot) % worldProps.length]!);
    const propPool = unique<PropId>([MOTIF_PROP[primary], ...(blueprint ? [] : [MOTIF_PROP[foreign]]), ...rotatedProps, 'crate']).slice(0, 4);

    let name = blueprint && recipe.rooms.length > 1 ? blueprint.name : `${MOTIF_WORD[blueprint ? primary : foreign]} ${archetype.noun}`;
    if (names.has(name)) name = `${MOTIF_WORD[primary]} ${archetype.noun}`;
    for (let n = 2; names.has(name); n++) name = `${MOTIF_WORD[primary]} ${archetype.noun} ${n}`;
    names.add(name);

    return {
      id,
      name: name.slice(0, 80),
      tagline: archetype.tagline,
      motifIds,
      enemyPool,
      propPool,
      hazards: blueprint ? blueprint.hazards || slot !== 0 && archetype.hazards : archetype.hazards,
      layout: archetype.layout,
      terrain: blueprint?.terrain ?? defaultBiomeTerrain(primary, archetype.density),
    };
  });
  return BiomeBriefListSchema.parse(briefs);
}

/** The briefs a world plays with: the recipe's own when it has a valid set of 8, derived ones otherwise. */
export function resolveBiomeBriefs(recipe: WorldRecipe, seed: string): BiomeBrief[] {
  const own = BiomeBriefListSchema.safeParse(recipe.biomes);
  return own.success ? own.data : deriveBiomeBriefs(recipe, seed);
}
