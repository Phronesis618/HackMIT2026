import fs from 'node:fs';
import { WorldFixtureSchema, type WorldRecipe } from '../../shared/contracts';
import { compileWorldRecipe } from './compiler';

const themes: { fixtureId: string; seed: number; recipe: WorldRecipe }[] = [
  {
    fixtureId: 'crystal-tide',
    seed: 618,
    recipe: {
      title: 'Crystal Tide',
      tagline: 'A prism observatory suspended above a frozen electric sea.',
      themeSummary: 'Broken crystal chambers and arched galleries guard an observatory core. Violet crystal shelves flank hazardous luminous shallows.',
      motifIds: ['crystals', 'arches', 'monoliths'],
      palette: {
        background: '#100b1c', floor: '#211831', floorAlt: '#2b2140', wall: '#342349',
        wallEdge: '#9573cd', accent: '#d0a0ff', accentSoft: '#9573cd', glow: '#bfa5ff',
        hazard: '#ff658f', text: '#eee2ff',
      },
      rooms: [
        {
          name: 'Prism Landing', description: 'Crystal shelves interrupt the violet shallows.',
          motifIds: ['crystals', 'arches'], propIds: ['crystal_cluster', 'crystal_cluster', 'monolith_shard'],
          enemyIds: ['sentinel'], hazards: true,
        },
        {
          name: 'Refraction Gallery', description: 'Arched buttresses hold a cracked observatory aloft.',
          motifIds: ['arches', 'crystals'], propIds: ['pillar', 'crystal_cluster', 'monolith_shard', 'crystal_cluster'],
          enemyIds: ['sentinel', 'lurker'], hazards: true,
        },
        {
          name: 'Prism Heart', description: 'The Guardian stands watch over the final crystal lens.',
          motifIds: ['monoliths', 'crystals'], propIds: ['anchor_pedestal', 'crystal_cluster', 'monolith_shard'],
          enemyIds: ['guardian', 'sentinel'], hazards: true,
        },
      ],
      contributionMappings: [],
    },
  },
  {
    fixtureId: 'root-archive',
    seed: 2026,
    recipe: {
      title: 'Root Archive',
      tagline: 'A living archive grows through the remains of a silent machine.',
      themeSummary: 'Bioluminescent roots consume broken terminals. Warm lanterns mark a dry path through branching pillars to the ancient archive core.',
      motifIds: ['roots', 'ruined_machinery', 'lanterns'],
      palette: {
        background: '#081210', floor: '#13241e', floorAlt: '#1a3028', wall: '#294137',
        wallEdge: '#779f72', accent: '#c7e58c', accentSoft: '#83ae6c', glow: '#dbf3a4',
        hazard: '#ff9668', text: '#e2efdf',
      },
      rooms: [
        {
          name: 'Root Vestibule', description: 'Lanterns light the roots threading through abandoned records.',
          motifIds: ['roots', 'lanterns'], propIds: ['root_mass', 'root_mass', 'lantern', 'terminal'],
          enemyIds: ['lurker', 'husk'], hazards: false,
        },
        {
          name: 'Buried Index', description: 'Broken machines have become planters for a luminous forest.',
          motifIds: ['ruined_machinery', 'roots'], propIds: ['terminal', 'root_mass', 'crate', 'lantern'],
          enemyIds: ['lurker', 'lurker', 'husk'], hazards: false,
        },
        {
          name: 'Seed Vault', description: 'The Guardian defends the archive seed beside the Anchor site.',
          motifIds: ['roots', 'lanterns'], propIds: ['anchor_pedestal', 'root_mass', 'lantern', 'terminal'],
          enemyIds: ['guardian', 'lurker'], hazards: false,
        },
      ],
      contributionMappings: [],
    },
  },
];

for (const { fixtureId, seed, recipe } of themes) {
  const { rooms, art } = compileWorldRecipe(recipe, { seed, plannedRoomCount: 3 });
  const fixture = WorldFixtureSchema.parse({
    fixtureId,
    fixtureNote: 'Authored offline theme compiled with a fixed seed. Not generated from player contributions.',
    plannedRoomCount: 3, recipe, art, rooms,
  });
  fs.writeFileSync(new URL(`../../../fixtures/worlds/${fixtureId}.json`, import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Wrote ${fixtureId}.`);
}
