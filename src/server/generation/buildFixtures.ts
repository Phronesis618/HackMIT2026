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
      lore: [
        { kind: 'relic', roomIndex: 0, enemyId: null, title: 'Tide gauge, cracked',
          text: 'Someone scratched a line into the glass every hour the sea rose. The last mark is above the ceiling.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Observatory roster',
          text: 'Forty-one names, each followed by a small lens sigil. Thirty-eight are struck through in the same violet ink the sea glows with.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Prayer to the Focus',
          text: 'Turn your face to the lens and be counted. The sea only takes what refuses to be seen.' },
        { kind: 'relic', roomIndex: 2, enemyId: null, title: 'Lens-keeper’s last entry',
          text: 'I have stopped the lens. Whatever it was showing the sea, the sea was learning. Tell no one where the Anchor sits.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'sentinel', title: 'Surveyor’s badge',
          text: 'A crystal badge still warm from the volley. The etched title reads Sentinel, Second Watch: it was posted here to count the sea, not to shoot at it.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'lurker', title: 'Diver’s tether',
          text: 'Frayed cable and a mouthful of violet salt. The lurkers were the divers who went down to read the sea up close, and came back speaking its language.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'guardian', title: 'The Focus itself',
          text: 'Six lens-plates fall away from a body that was never a person. The Guardian was the observatory’s eye, and it did not want to be blinded.' },
      ],
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
      lore: [
        { kind: 'relic', roomIndex: 0, enemyId: null, title: 'Reading-room notice',
          text: 'Please return all records to the roots. Do not water the terminals. The archive remembers what you forget to.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Index card, overgrown',
          text: 'Subject: the machine. Filed under: soil. A root has grown clean through the hole where the card was pinned.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Lantern-lighter’s ledger',
          text: 'Lit nine lanterns on the dry path. Heard the terminals humming a tune I taught them. Did not light the tenth.' },
        { kind: 'relic', roomIndex: 2, enemyId: null, title: 'Seed vault plaque',
          text: 'Here the archive keeps one copy of everything it was told, so that endings can be argued with.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'husk', title: 'Reader’s spectacles',
          text: 'Cheap frames, lenses fogged green. The husks were patrons who stayed past closing and let the roots do their reading for them.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'lurker', title: 'Runner’s satchel',
          text: 'Empty, but the strap is worn through. Lurkers were the couriers who carried records between wings until the roots learned to carry them instead.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'guardian', title: 'Head archivist’s seal',
          text: 'Wax, root-fibre and a fingerprint. The Guardian was the last archivist, grown into the vault it swore to keep, still refusing every withdrawal.' },
      ],
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
