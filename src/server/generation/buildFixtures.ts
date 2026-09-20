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
        { kind: 'relic', roomIndex: 0, enemyId: null, title: 'Tide gauge, cracked', source: 'scratched into the glass of a brass tide gauge',
          text: 'Hour 1: two fingers over the low mark. Hour 6: the glass is warm. Hour 14: it is not water, whatever they say in the gallery, water does not look back. I have stopped marking the hours and started marking the faces.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Observatory roster', source: 'a duty roster pinned under a crystal shelf',
          text: 'Forty-one names, each with a small lens sigil, each with a watch assigned. Thirty-eight are struck through in the same violet ink the shallows glow with. The three untouched names all share one shift: the night the lens was first turned downward.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Prayer to the Focus', source: 'etched around the rim of a cracked lens-plate',
          text: 'Turn your face to the lens and be counted. Be seen and be kept. The sea only takes what refuses to be seen, and we have refused nothing, so why is the gallery quiet, and why does my watch-partner answer in the wrong voice.' },
        { kind: 'relic', roomIndex: 2, enemyId: null, title: 'Lens-keeper\u2019s last entry', source: 'a logbook wedged beneath the Anchor pedestal',
          text: 'I have stopped the lens. Whatever it was showing the sea, the sea was learning, and it had nearly learned enough to show it back. The observatory core will hold as long as something is planted here that the sea cannot count. Tell no one where the Anchor sits.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'sentinel', title: 'Surveyor\u2019s badge', source: 'a crystal badge, still warm from the volley',
          text: 'The etching reads Sentinel, Second Watch, with a tally of tides counted underneath. Whoever wore it was posted to count the sea, not to shoot at it. The last tally mark is scratched so hard it went through the crystal.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'lurker', title: 'Diver\u2019s tether', source: 'frayed tether cable and a mouthful of violet salt',
          text: 'Divers went down to read the sea up close, on lines like this one, and reported back in words that grew shorter every trip. The final reports are single syllables. The cable is chewed through from the diver\u2019s end.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'guardian', title: 'The Focus itself', source: 'six lens-plates that fell away from a body',
          text: 'It was never a person. It was the observatory\u2019s own eye, the great lens given something to stand with, and it did not want to be blinded a second time. Through the plates, faintly, the sea is still trying to show you something.' },
      ],
      attunements: [
        { effectId: 'bolt_ward', name: 'Counted by the Lens', description: 'Turn your face to the lens and be kept: the sea\u2019s bolts find less of you.' },
        { effectId: 'hazard_ward', name: 'Salt-Sure Footing', description: 'The divers\u2019 trick for the shallows: what glows underfoot burns a watcher less.' },
        { effectId: 'relic_mend', name: 'Tide-Gauge Reading', description: 'Each mark read from the glass steadies the hand that reads it.' },
        { effectId: 'guardian_bane', name: 'Lens-Keeper\u2019s Stop', description: 'You know where the Focus was blinded once. Strike there.' },
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
        { kind: 'relic', roomIndex: 0, enemyId: null, title: 'Reading-room notice', source: 'a laminated notice, half swallowed by root',
          text: 'Please return all records to the roots when finished. Do not water the terminals. Do not answer the terminals. The archive remembers what you forget to, and it has been getting very good at remembering.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Index card, overgrown', source: 'an index card with a root grown through the pin-hole',
          text: 'Subject: the machine. Filed under: soil. Cross-reference: everyone. A second hand has added, in green: it is not filed under soil, it is filed as soil, and so, soon, are we.' },
        { kind: 'relic', roomIndex: 1, enemyId: null, title: 'Lantern-lighter\u2019s ledger', source: 'a ledger left on the dry path, pages damp',
          text: 'Lit nine lanterns along the dry path, the way my mother did. Heard the terminals humming a tune I taught them as a girl. Did not light the tenth. The tenth is where the path stops being dry, and where the humming stops being a tune.' },
        { kind: 'relic', roomIndex: 2, enemyId: null, title: 'Seed vault plaque', source: 'a brass plaque above the Anchor site',
          text: 'Here the archive keeps one copy of everything it was ever told, so that endings can be argued with. Plant carefully. What is planted here is read aloud, forever, to the roots.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'husk', title: 'Reader\u2019s spectacles', source: 'cheap wire frames, lenses fogged green',
          text: 'The husks were patrons who stayed past closing. The roots offered to do their reading for them, and they accepted, and they are still reading. Behind the fogged lenses the eyes move left to right, left to right.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'lurker', title: 'Runner\u2019s satchel', source: 'a courier satchel, strap worn through',
          text: 'Lurkers were the couriers who carried records between wings until the roots learned to carry them instead. The satchel is empty. The last delivery slip inside reads: recipient will come to you.' },
        { kind: 'remains', roomIndex: 0, enemyId: 'guardian', title: 'Head archivist\u2019s seal', source: 'a wax seal, root-fibre and one fingerprint',
          text: 'The Guardian was the last archivist, who chose to be grown into the vault rather than leave it unkept. It refused every withdrawal for a very long time. Under the wax, the fingerprint has the whorl of a leaf.' },
      ],
      attunements: [
        { effectId: 'melee_ward', name: 'Reader\u2019s Calm', description: 'Patrons who stayed past closing learned to let the roots pass over them.' },
        { effectId: 'relic_mend', name: 'Returned to the Roots', description: 'A record read and returned is a record that keeps you.' },
        { effectId: 'remains_charge', name: 'Courier\u2019s Ledger', description: 'Every satchel recovered is a delivery the archive still owes you.' },
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
