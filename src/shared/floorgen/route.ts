/**
 * World route — the biome DAG a crew walks: 1 opener → 2 → 2 → 2 → 1 finale.
 *
 * Owner: Agent F1a (floors). Pure and deterministic.
 *
 * After each biome's exit the crew picks 1 of the 2 biomes of the next tier (Dead Cells'
 * fixed biome map), so every biome of tier t has an edge to every biome of tier t+1.
 * A run plays 5 of the 8 biomes.
 */
import {
  BIOME_BRIEF_COUNT,
  BIOME_TIER_WIDTHS,
  ROOM_BUDGETS,
  type BiomeBrief,
  type BiomeEdge,
  type BiomeNode,
  type WorldRoute,
} from '../floors';
import { createRng, seedKey } from './rng';

/** Slot ids used when the caller has no brief ids yet. */
export const DEFAULT_BIOME_IDS = ['b0', 'b1a', 'b1b', 'b2a', 'b2b', 'b3a', 'b3b', 'b4'] as const;

/**
 * Lays 8 biome ids out on the DAG. The FIRST id is always the opener and the LAST is
 * always the finale (the model writes them for those roles); the six in between are
 * dealt onto tiers 1–3 by a seeded shuffle, so the same briefs pair up differently in
 * different worlds. Omit `biomeIds` to get DEFAULT_BIOME_IDS slots (no shuffle).
 */
export function planWorldRoute(seed: string, biomeIds?: readonly string[]): WorldRoute {
  let ids: string[] = [...DEFAULT_BIOME_IDS];
  if (biomeIds) {
    if (biomeIds.length !== BIOME_BRIEF_COUNT || new Set(biomeIds).size !== BIOME_BRIEF_COUNT) {
      throw new Error(`floorgen: planWorldRoute needs ${BIOME_BRIEF_COUNT} distinct biome ids`);
    }
    const middle = createRng(seedKey(seed, 'route')).shuffle(biomeIds.slice(1, -1));
    ids = [biomeIds[0]!, ...middle, biomeIds[biomeIds.length - 1]!];
  }

  const tiers: string[][] = [];
  const nodes: BiomeNode[] = [];
  let cursor = 0;
  BIOME_TIER_WIDTHS.forEach((tierWidth, tier) => {
    const tierIds = ids.slice(cursor, cursor + tierWidth);
    cursor += tierWidth;
    tiers.push(tierIds);
    for (const biomeId of tierIds) nodes.push({ biomeId, tier, roomBudget: ROOM_BUDGETS[tier]! });
  });
  const edges: BiomeEdge[] = [];
  for (let tier = 0; tier + 1 < tiers.length; tier++) {
    for (const from of tiers[tier]!) for (const to of tiers[tier + 1]!) edges.push({ from, to });
  }
  return { seed, tiers, graph: { nodes, edges } };
}

/** The biomes offered after finishing `biomeId` (empty after the finale). */
export function nextBiomeChoices(route: WorldRoute, biomeId: string): string[] {
  return route.graph.edges.filter((edge) => edge.from === biomeId).map((edge) => edge.to);
}

export function biomeTier(route: WorldRoute, biomeId: string): number | undefined {
  return route.graph.nodes.find((node) => node.biomeId === biomeId)?.tier;
}

/**
 * Eight offline briefs with deliberately different layout personalities. Used by tests,
 * by docs, and as the no-model fallback ("5 linear biomes" risk in the overnight plan).
 */
export const DEFAULT_BIOME_BRIEFS: readonly BiomeBrief[] = [
  {
    id: 'b0', name: 'Intake Causeway', tagline: 'The quarantine road into the city. Gates every forty metres.',
    motifIds: ['arches', 'lanterns'], enemyPool: ['husk', 'swarmling'], propPool: ['crate', 'lantern', 'pillar'], hazards: false,
    layout: { linearity: 0.8, branchiness: 0.2, specials: { treasure: 1, lore: 1, rest: 0, elite: 0 } },
  },
  {
    id: 'b1a', name: 'Flooded Archive', tagline: 'Six floors of ledgers under a metre of water.',
    motifIds: ['monoliths', 'cables'], enemyPool: ['husk', 'lurker', 'spewer'], propPool: ['terminal', 'crate', 'cable_bundle'], hazards: true,
    layout: { linearity: 0.1, branchiness: 0.9, specials: { treasure: 1, lore: 3, rest: 1, elite: 1 } },
  },
  {
    id: 'b1b', name: 'Siege Wall', tagline: 'A rampart held for ninety days, one tower at a time.',
    motifIds: ['spires', 'ruined_machinery'], enemyPool: ['husk', 'sentinel', 'warden'], propPool: ['pillar', 'crate', 'monolith_shard'], hazards: false,
    layout: { linearity: 0.95, branchiness: 0.05, specials: { treasure: 1, lore: 1, rest: 1, elite: 3 } },
  },
  {
    id: 'b2a', name: 'Root Cellars', tagline: 'Storage vaults the orchard grew back into.',
    motifIds: ['roots', 'lanterns'], enemyPool: ['swarmling', 'lurker', 'spewer'], propPool: ['root_mass', 'lantern', 'crate'], hazards: true,
    layout: { linearity: 0.3, branchiness: 0.7, specials: { treasure: 2, lore: 2, rest: 1, elite: 2 } },
  },
  {
    id: 'b2b', name: 'Relay Yard', tagline: 'Forty pylons, eleven still carrying current.',
    motifIds: ['cables', 'ruined_machinery'], enemyPool: ['sentinel', 'channeler', 'husk'], propPool: ['cable_bundle', 'terminal', 'pillar'], hazards: false,
    layout: { linearity: 0.6, branchiness: 0.4, specials: { treasure: 1, lore: 2, rest: 1, elite: 2 } },
  },
  {
    id: 'b3a', name: 'Crystal Galleries', tagline: 'A mine that was turned into a museum of itself.',
    motifIds: ['crystals', 'arches'], enemyPool: ['channeler', 'lurker', 'swarmling', 'warden'], propPool: ['crystal_cluster', 'lantern', 'pillar'], hazards: true,
    layout: { linearity: 0.2, branchiness: 0.8, specials: { treasure: 2, lore: 3, rest: 2, elite: 3 } },
  },
  {
    id: 'b3b', name: 'Processional', tagline: 'The road the wardens walked at shift change.',
    motifIds: ['monoliths', 'spires'], enemyPool: ['warden', 'sentinel', 'husk', 'spewer'], propPool: ['monolith_shard', 'pillar', 'lantern'], hazards: false,
    layout: { linearity: 0.9, branchiness: 0.15, specials: { treasure: 1, lore: 2, rest: 2, elite: 4 } },
  },
  {
    id: 'b4', name: 'Anchor Vault', tagline: 'The room the whole city was built to keep shut.',
    motifIds: ['monoliths', 'crystals', 'cables'], enemyPool: ['warden', 'channeler', 'sentinel', 'lurker', 'swarmling'], propPool: ['monolith_shard', 'crystal_cluster', 'terminal'], hazards: true,
    layout: { linearity: 0.5, branchiness: 0.5, specials: { treasure: 2, lore: 4, rest: 2, elite: 4 } },
  },
];
