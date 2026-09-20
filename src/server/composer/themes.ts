/**
 * Theme library for the offline composer. Every theme is a complete visual + lore +
 * encounter vocabulary built from the closed registry, so a composed world differs from
 * another in motifs (construction), palette, props, enemy mix, hazards, names, lore voice
 * and attunements — not just colour. Player ideas pick the theme(s) by keyword and are
 * echoed into names and lore through `{word}` / `{idea}` slots.
 *
 * All text here is authored, never generated; the composer only substitutes sanitized
 * player words. Owner: Agent A.
 */
import type { Palette } from '../../shared/contracts';
import type { AttunementEffectId, EnemyId, MotifId, PropId } from '../../shared/registry';

export interface LoreTemplate {
  title: string;
  source: string;
  text: string;
}

export interface RoomBank {
  /** Room name templates. `{word}` = a player word (Title Case). */
  names: string[];
  descriptions: string[];
}

export interface ThemeDef {
  id: string;
  keywords: string[];
  motifs: MotifId[];
  palette: Palette;
  adjectives: string[];
  nouns: string[];
  taglines: string[];
  summary: string;
  rooms: { entry: RoomBank; mid: RoomBank; final: RoomBank };
  props: PropId[];
  enemies: { entry: EnemyId[]; mid: EnemyId[]; final: EnemyId[] };
  hazardChance: number;
  hazardName: string;
  relics: LoreTemplate[];
  /** Theme flavour inserted into generic remains lore, e.g. "in the flotilla". */
  remainsFlavor: string;
  attunements: Array<{ effectId: AttunementEffectId; name: string; description: string }>;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'pirates',
    keywords: ['pirate', 'buccaneer', 'corsair', 'plunder', 'loot', 'treasure', 'armada', 'flotilla', 'ship', 'galleon', 'captain', 'privateer', 'smuggl', 'bounty', 'raider', 'mutiny', 'cannon', 'sailor', 'crew'],
    motifs: ['ruined_machinery', 'cables', 'lanterns', 'spires'],
    palette: { background: '#120a12', floor: '#2a1b22', floorAlt: '#33222a', wall: '#4a2d2a', wallEdge: '#ff9f43', accent: '#ffb347', accentSoft: '#ff4d6d', glow: '#ffd166', hazard: '#ff3b5c', text: '#fff3e0' },
    adjectives: ['Black', 'Rusted', 'Lashed', 'Gilded', 'Mutinous'],
    nouns: ['Flotilla', 'Armada', 'Ledger', 'Hulk', 'Prize'],
    taglines: ['Lashed-together wrecks flying {word} colours over a dead star.', 'A raiders\' flotilla that never struck its colours.', 'Stolen hulls, brass lanterns, and a captain who will not leave the helm.'],
    summary: 'Boarding docks, plunder holds and a captain\'s bridge welded from stolen hulls; brass lanterns, boarding cables and vented plasma mark the raiders\' last run.',
    rooms: {
      entry: { names: ['Boarding Dock', '{word} Gangway', 'Prize Airlock'], descriptions: ['A raided freighter lashed to the flotilla by boarding cables, its airlocks still venting.', 'Grapple lines and loot crates litter the dock where the {word} came aboard.'] },
      mid: { names: ['Plunder Hold', '{word} Hold', 'Quartermaster\'s Deck'], descriptions: ['Stacked loot under swinging brass lanterns, guarded by a crew that never left.', 'The hold where the {word} was tallied and never shared.'] },
      final: { names: ['Captain\'s Bridge', 'Helm of the {word}'], descriptions: ['The flagship bridge where the captain still holds the helm above the Anchor site.'] },
    },
    props: ['crate', 'cable_bundle', 'lantern', 'terminal', 'crate', 'pillar'],
    enemies: { entry: ['husk', 'swarmling'], mid: ['sentinel', 'lurker'], final: ['guardian', 'warden'] },
    hazardChance: 0.8,
    hazardName: 'vented plasma along the deck plates',
    relics: [
      { title: 'Boarding manifest', source: 'stencilled on a loot crate by the airlock', text: 'Prize: freighter {word}. Crew: eleven, offered the articles. Nine signed. Two did not. Someone has added two more tally marks in a different hand, and then scratched through all eleven.' },
      { title: 'The Black Ledger', source: 'an open ledger chained to the quartermaster\'s terminal', text: 'Shares paid in full to every hand, living or otherwise. The last entry is a single line: the star is going out, and the captain says we do not run from anything, so we are not running.' },
      { title: 'Captain\'s standing order', source: 'burned into the helm rail of the flagship', text: 'No hand abandons this ship while her colours fly. The colours are still flying. Nobody is sure any more who keeps raising them.' },
    ],
    remainsFlavor: 'aboard the flotilla',
    attunements: [
      { effectId: 'clear_surge', name: 'Plunder Share', description: 'Clearing a hold pays the whole crew: 2 extra resources on every room clear.' },
      { effectId: 'first_strike', name: 'Boarding Action', description: 'The first strike on a fresh hostile hits like a grapple volley.' },
    ],
  },
  {
    id: 'drowned',
    keywords: ['drown', 'underwater', 'ocean', 'sea', 'tide', 'reef', 'coral', 'flood', 'sunken', 'abyss', 'deep', 'whale', 'jellyfish', 'siren', 'kelp', 'submerged', 'aquatic', 'lagoon', 'atlantis', 'shipwreck', 'wreck'],
    motifs: ['arches', 'lanterns', 'cables', 'monoliths'],
    palette: { background: '#071a24', floor: '#0e3340', floorAlt: '#124052', wall: '#16515f', wallEdge: '#5fd0d8', accent: '#7ff0e6', accentSoft: '#ffb35c', glow: '#9ff7ff', hazard: '#ff6b9d', text: '#eafcff' },
    adjectives: ['Drowned', 'Sunken', 'Tidal', 'Bell-Deep', 'Silted'],
    nouns: ['Carillon', 'Cathedral', 'Reef', 'Trench', 'Nave'],
    taglines: ['A city sunk beneath a glowing sea, where the {word} never stopped.', 'Flooded naves lit by things that drift and remember.', 'Every tide brings the drowned back to the hour they lost.'],
    summary: 'Flooded stone naves and bell galleries lit by drifting sentries; every toll of the sunken bells ripples through the luminous shallows.',
    rooms: {
      entry: { names: ['Drowned Nave', '{word} Shallows', 'Tide Gate'], descriptions: ['Sunken arches rise from luminous shallows while the bells overhead still toll.', 'The first flooded hall, where the {word} still catches the light.'] },
      mid: { names: ['Bell Gallery', '{word} Gallery', 'Kelp Cloister'], descriptions: ['Bell ropes hang like kelp and glowing sentries drift between the pillars.', 'A gallery where the {word} drifts between the pillars.'] },
      final: { names: ['Choir of the Deep Bell', 'Heart of the {word}'], descriptions: ['The great bell hangs over the Anchor site, ringing in time with the Guardian.'] },
    },
    props: ['pillar', 'lantern', 'cable_bundle', 'pillar', 'monolith_shard', 'lantern'],
    enemies: { entry: ['husk', 'swarmling'], mid: ['sentinel', 'lurker'], final: ['guardian', 'channeler'] },
    hazardChance: 0.85,
    hazardName: 'luminous shallows that sting',
    relics: [
      { title: 'Bell-ringer\'s tally', source: 'chalk strokes on a drowned pillar, above the waterline', text: 'Nine strokes for the nine bells. The water reached the choir loft on the third day and I kept ringing. It reached the ropes on the fifth and the bells kept ringing without me. I count tolls now, and the tolls have not stopped, and I did not ring the last four hundred.' },
      { title: 'Rope-burn prayer', source: 'knotted into a bell rope, one knot per line', text: 'Keep the lamps lit so the drowned can find the nave. Keep the bells ringing so the drowned know the hour. Keep your eyes on the floor when the {word} drifts past, because it remembers faces.' },
      { title: 'The last carillon', source: 'engraved around the lip of the great bell', text: 'Cast for the founding, rung for the flood. Whoever stands beneath me when I fall silent will hold the hour for everyone who ever listened. It has not fallen silent, and something below is holding the hour for us.' },
    ],
    remainsFlavor: 'beneath the tide',
    attunements: [
      { effectId: 'hazard_ward', name: 'Tide-Walker', description: 'The stinging shallows and their bolts bite far less.' },
      { effectId: 'relic_mend', name: 'Bell-Deep Breath', description: 'Reading a relic mends 20 Integrity, one held breath at a time.' },
    ],
  },
  {
    id: 'jungle',
    keywords: ['jungle', 'forest', 'tree', 'root', 'vine', 'overgrown', 'moss', 'canopy', 'wild', 'fern', 'garden', 'bloom', 'flower', 'orchard', 'grove', 'plant', 'leaf', 'leaves', 'rainforest', 'wood', 'nature', 'green', 'petal'],
    motifs: ['roots', 'lanterns', 'arches', 'monoliths'],
    palette: { background: '#0b140c', floor: '#1d2e1a', floorAlt: '#24381f', wall: '#2f4a2a', wallEdge: '#9be27a', accent: '#b6ff8a', accentSoft: '#ffcf6b', glow: '#d2ffb0', hazard: '#ff7a5c', text: '#f1ffe8' },
    adjectives: ['Overgrown', 'Verdant', 'Root-Bound', 'Blooming', 'Feral'],
    nouns: ['Archive', 'Canopy', 'Grove', 'Understory', 'Garden'],
    taglines: ['A place the forest swallowed and kept reading in the dark, {word} and all.', 'Roots hold the walls up now, and eleven of the archivists with them.', 'Everything here grew back except the people.'],
    summary: 'Root-choked halls under a living canopy; moss and warm lanterns where the forest reclaimed every corridor and keeps the dead standing in its grip.',
    rooms: {
      entry: { names: ['Root Threshold', '{word} Grove', 'Mossway'], descriptions: ['Roots split the stone underfoot and hold the entry arch together like a fist.', 'The forest\'s first hall, thick with the {word}.'] },
      mid: { names: ['Canopy Hall', '{word} Understory', 'Lantern Glade'], descriptions: ['Lanterns hang from living roots; the canopy drinks whatever light escapes.', 'The understory where the {word} grows loudest.'] },
      final: { names: ['Heartwood Chamber', 'Seat of the {word}'], descriptions: ['The great root wraps the Anchor site; the Guardian is what the forest grew to keep it.'] },
    },
    props: ['root_mass', 'lantern', 'root_mass', 'pillar', 'crate', 'monolith_shard'],
    enemies: { entry: ['swarmling', 'husk'], mid: ['spewer', 'lurker'], final: ['guardian', 'warden'] },
    hazardChance: 0.6,
    hazardName: 'thorn beds and sap pools',
    relics: [
      { title: 'Gardener\'s ledger', source: 'pressed between two great leaves', text: 'Planted the {word} on the first warm day. It took. Everything takes here. The archivists asked me to stop planting and I told them the forest was not asking permission either.' },
      { title: 'Warning carved in bark', source: 'cut into a root as thick as a doorway', text: 'Do not sleep against the roots. They are gentle and they are patient and in the morning you will not be able to tell where you end.' },
      { title: 'Last watering', source: 'a tin can hanging from a lantern hook', text: 'Half full. Whoever carried it set it down carefully, meaning to come back. The moss has grown a small green hand around the handle.' },
    ],
    remainsFlavor: 'under the canopy',
    attunements: [
      { effectId: 'relic_mend', name: 'Sap Salve', description: 'Reading a relic mends 20 Integrity; sap closes the cut.' },
      { effectId: 'remains_charge', name: 'Compost Bloom', description: 'Every remains picked up feeds the ultimate 15 points of charge.' },
    ],
  },
  {
    id: 'frozen',
    keywords: ['ice', 'frozen', 'glacier', 'snow', 'frost', 'arctic', 'tundra', 'winter', 'blizzard', 'cold', 'icy', 'polar', 'freez', 'icicle', 'permafrost'],
    motifs: ['crystals', 'monoliths', 'spires', 'arches'],
    palette: { background: '#0a1420', floor: '#1b2f45', floorAlt: '#223a54', wall: '#2e4f6e', wallEdge: '#bfe9ff', accent: '#dff6ff', accentSoft: '#8fd3ff', glow: '#ffffff', hazard: '#7fd4ff', text: '#f4fbff' },
    adjectives: ['Frozen', 'Glacial', 'White', 'Still', 'Hoarfrost'],
    nouns: ['Reach', 'Vault', 'Shelf', 'Watch', 'Silence'],
    taglines: ['A station frozen mid-sentence, the {word} still waiting for an answer.', 'Ice keeps everything, including the moment it happened.', 'Cold enough that the last words are still hanging in the air.'],
    summary: 'Ice-cased vaults and frost-rimed monoliths under a white glare; everything that stopped here stopped at once and was kept exactly as it fell.',
    rooms: {
      entry: { names: ['Frost Gate', '{word} Shelf', 'Rime Antechamber'], descriptions: ['Ice has grown over the entry arch in slow blue sheets; the floor rings like glass.', 'The first hall of the ice, where the {word} was left standing.'] },
      mid: { names: ['Glacial Vault', '{word} Vault', 'Icefall Gallery'], descriptions: ['Crystal columns hold a frozen ceiling; frost-caught figures line the walls.', 'A vault of blue ice where the {word} is kept.'] },
      final: { names: ['The Still Heart', 'Core of the {word}'], descriptions: ['The Anchor site sits in a bowl of clear ice; the Guardian has not moved in a very long time.'] },
    },
    props: ['crystal_cluster', 'monolith_shard', 'crystal_cluster', 'pillar', 'lantern', 'crate'],
    enemies: { entry: ['sentinel', 'swarmling'], mid: ['warden', 'lurker'], final: ['guardian', 'sentinel'] },
    hazardChance: 0.7,
    hazardName: 'black ice that steals footing',
    relics: [
      { title: 'Frozen dispatch', source: 'a message slate, cracked by the cold', text: 'Request immediate evacuation. Temperature falling faster than the models. The {word} has stopped responding. If you read this, we did not send it in time.' },
      { title: 'Breath on the glass', source: 'scratched into frost on a viewing pane', text: 'Someone drew a small house with smoke coming out of the chimney. Underneath, in a different hand: we are not going home. Keep drawing.' },
      { title: 'The keeper\'s count', source: 'tallies on a frost-white monolith', text: 'Forty-one kept warm. Then thirty. Then twelve. The last stroke is longer than the others, as if the hand that made it was already slowing.' },
    ],
    remainsFlavor: 'in the ice',
    attunements: [
      { effectId: 'melee_ward', name: 'Frost Plating', description: 'Rime hardens over the armour plates; melee and charge hits deal 25% less.' },
      { effectId: 'dash_echo', name: 'Glissade', description: 'The dash slides 40% further and leaves a frost trail on the tiles.' },
    ],
  },
  {
    id: 'desert',
    keywords: ['desert', 'sand', 'dune', 'tomb', 'pyramid', 'temple', 'pharaoh', 'sun', 'scorch', 'oasis', 'ruin', 'mirage', 'sandstone', 'sphinx', 'ancient', 'egypt', 'canyon', 'wasteland'],
    motifs: ['monoliths', 'arches', 'lanterns', 'spires'],
    palette: { background: '#1a1208', floor: '#4a3a20', floorAlt: '#55432a', wall: '#6b5330', wallEdge: '#ffd27a', accent: '#ffe08a', accentSoft: '#4fd1c5', glow: '#fff1b8', hazard: '#ff8f3d', text: '#fff8e6' },
    adjectives: ['Sunken', 'Gilded', 'Buried', 'Sun-Scoured', 'Silent'],
    nouns: ['Necropolis', 'Tomb', 'Threshold', 'Dune-Court', 'Sanctum'],
    taglines: ['A tomb the sand gave back, one {word} at a time.', 'Gold under the dust, and something under the gold.', 'The sun set here once and never quite rose again.'],
    summary: 'Sand-choked courts and gilded monoliths under a copper sky; the dead were buried with everything they owned and have started using it.',
    rooms: {
      entry: { names: ['Dune Threshold', '{word} Court', 'Sand Gate'], descriptions: ['Half-buried monoliths mark the way in; sand pours through every crack in the arch.', 'The outer court, where the {word} was first uncovered.'] },
      mid: { names: ['Gilded Passage', '{word} Passage', 'Hall of Offerings'], descriptions: ['Lanterns of hammered gold light a corridor of carved slabs and patient statues.', 'A passage lined with offerings to the {word}.'] },
      final: { names: ['Sealed Sanctum', 'Tomb of the {word}'], descriptions: ['The Anchor site rests on the sealed sarcophagus; the Guardian was buried standing.'] },
    },
    props: ['monolith_shard', 'pillar', 'lantern', 'crate', 'monolith_shard', 'pillar'],
    enemies: { entry: ['husk', 'swarmling'], mid: ['sentinel', 'warden'], final: ['guardian', 'channeler'] },
    hazardChance: 0.55,
    hazardName: 'sinking sand and sun-glass',
    relics: [
      { title: 'Excavation note', source: 'pencilled on the back of a survey card', text: 'Third chamber opened at dawn. The {word} inside is untouched. Nobody has robbed this tomb in four thousand years and I think I finally understand why.' },
      { title: 'Offering tag', source: 'a copper tag tied to a sealed jar', text: 'For the long dark: water, oil, a name to answer to. The jar is empty. The name has been scratched out and replaced with mine.' },
      { title: 'Sun-prayer', source: 'gold leaf pressed into a slab', text: 'Rise and we will rise, cut into a slab that faces east. Four thousand mornings without a dawn, and the twelve in the offering hall have risen anyway.' },
    ],
    remainsFlavor: 'in the sand',
    attunements: [
      { effectId: 'guardian_bane', name: 'Tomb-Breaker', description: 'Strikes against the Guardian deal 25% more; nine seals were opened to get here.' },
      { effectId: 'anchor_grace', name: 'Dawn Vigil', description: 'The Anchor plants 30% faster on the slab that faces east.' },
    ],
  },
  {
    id: 'volcanic',
    keywords: ['volcano', 'volcanic', 'lava', 'magma', 'forge', 'furnace', 'fire', 'ember', 'ash', 'inferno', 'hell', 'smith', 'burn', 'flame', 'molten', 'scorched', 'obsidian', 'brimstone', 'demon'],
    motifs: ['ruined_machinery', 'monoliths', 'cables', 'spires'],
    palette: { background: '#140806', floor: '#2b1410', floorAlt: '#331a12', wall: '#4a2018', wallEdge: '#ff6a2a', accent: '#ff8f3a', accentSoft: '#ffd13a', glow: '#ffb070', hazard: '#ff3a1a', text: '#ffeee0' },
    adjectives: ['Molten', 'Ashen', 'Smouldering', 'Black', 'Furnace-Lit'],
    nouns: ['Forge', 'Foundry', 'Caldera', 'Crucible', 'Kiln'],
    taglines: ['A forge that kept working after the smiths were gone, hammering out the {word}.', 'Everything here is still warm.', 'The mountain breathes, and the machines breathe with it.'],
    summary: 'Ash-black foundry floors split by molten channels; gear-trains and slag monoliths glow from within, still forging for masters who burned.',
    rooms: {
      entry: { names: ['Slag Gate', '{word} Approach', 'Cinder Yard'], descriptions: ['Slag heaps and dead furnaces flank the entry; the floor glows through the cracks.', 'The cinder yard where the {word} was cast.'] },
      mid: { names: ['Foundry Floor', '{word} Foundry', 'Bellows Hall'], descriptions: ['Great gear-trains still turn over channels of molten rock.', 'The foundry where the {word} was hammered into shape.'] },
      final: { names: ['The Crucible', 'Heart of the {word}'], descriptions: ['The Anchor site sits on the cooled lip of the crucible; the Guardian stokes it still.'] },
    },
    props: ['monolith_shard', 'cable_bundle', 'terminal', 'crate', 'pillar', 'monolith_shard'],
    enemies: { entry: ['husk', 'spewer'], mid: ['warden', 'swarmling'], final: ['guardian', 'channeler'] },
    hazardChance: 0.95,
    hazardName: 'molten channels across the floor',
    relics: [
      { title: 'Smith\'s mark', source: 'stamped into a cooled ingot', text: 'Forged for the {word}, tempered nine times, never drawn. The last stamp on the ingot is a handprint, five fingers pressed in while the metal was still soft.' },
      { title: 'Furnace log', source: 'chalk on a slag-black slate', text: 'Fed the fire at first bell. Fed it at second. Ran out of coal at third and it kept burning. Went to see what it was eating. Did not write down what I found.' },
      { title: 'Cooling prayer', source: 'scratched around the crucible lip', text: 'Let it cool. Let it cool. Let it cool. The letters get larger and less careful, and then they stop.' },
    ],
    remainsFlavor: 'in the ash',
    attunements: [
      { effectId: 'hazard_ward', name: 'Ash-Walker', description: 'Molten channels and their spat bolts burn you far less.' },
      { effectId: 'first_strike', name: 'Quenching Blow', description: 'Your first strike on a fresh hostile lands like a hammer on hot steel.' },
    ],
  },
  {
    id: 'neon',
    keywords: ['neon', 'cyber', 'city', 'market', 'street', 'hologram', 'corporate', 'arcade', 'tokyo', 'synth', 'hacker', 'punk', 'bazaar', 'metropolis', 'skyline', 'downtown', 'club', 'megacity', 'urban', 'billboard', 'subway'],
    motifs: ['spires', 'cables', 'lanterns', 'ruined_machinery'],
    palette: { background: '#0c0716', floor: '#1a1130', floorAlt: '#22163d', wall: '#2d1f52', wallEdge: '#ff4fd8', accent: '#5ff7ff', accentSoft: '#ff4fd8', glow: '#b8fbff', hazard: '#ffe64a', text: '#f6f0ff' },
    adjectives: ['Neon', 'Flickering', 'Unlicensed', 'Midnight', 'Overclocked'],
    nouns: ['Arcade', 'Concourse', 'Undercity', 'Exchange', 'Grid'],
    taglines: ['A city that sells everything, tonight offering the {word}.', 'Signs still flicker for shops whose owners never went home.', 'The grid still draws forty megawatts for a market with no customers.'],
    summary: 'Rain-slick concourses under flickering spire signage, power cables strung between stalls, and machines that keep trading long after the market closed.',
    rooms: {
      entry: { names: ['Night Market Gate', '{word} Street', 'Turnstile Row'], descriptions: ['Dead signage flickers awake over the turnstiles; cables sag between forty shuttered stalls.', 'The street where the {word} was sold.'] },
      mid: { names: ['Arcade Concourse', '{word} Exchange', 'Cable Row'], descriptions: ['Lanterns of every colour hang over a concourse of humming terminals.', 'The exchange where the {word} changed hands.'] },
      final: { names: ['Grid Core', 'Vault of the {word}'], descriptions: ['The city\'s power core wraps the Anchor site; the Guardian is what keeps the lights on.'] },
    },
    props: ['terminal', 'cable_bundle', 'lantern', 'crate', 'terminal', 'pillar'],
    enemies: { entry: ['swarmling', 'husk'], mid: ['sentinel', 'channeler'], final: ['guardian', 'warden'] },
    hazardChance: 0.65,
    hazardName: 'live cabling underfoot',
    relics: [
      { title: 'Closing notice', source: 'a flickering sign above a shuttered stall', text: 'Back in five minutes. Cash only. We have the {word} you asked about. The sign has been saying five minutes for a very long time.' },
      { title: 'Transit card', source: 'a fare card jammed in a turnstile', text: 'Balance: enough for one more ride. Last tap: the station under the core, which was closed before the card was issued.' },
      { title: 'Graffiti', source: 'sprayed across a service door', text: 'THE GRID REMEMBERS YOUR FACE, sprayed a metre high across the service door. Under it, smaller: it remembered mine. Under that, in pencil: run to platform 4.' },
    ],
    remainsFlavor: 'under the neon',
    attunements: [
      { effectId: 'bolt_ward', name: 'Signal Jammer', description: 'Enemy bolts deal 40% less; the static from the array scatters them.' },
      { effectId: 'dash_echo', name: 'Latency Ghost', description: 'Your dash leaves an afterimage the grid cannot track.' },
    ],
  },
  {
    id: 'haunted',
    keywords: ['haunt', 'ghost', 'graveyard', 'grave', 'spirit', 'cursed', 'phantom', 'wraith', 'bone', 'crypt', 'undead', 'zombie', 'skull', 'spooky', 'halloween', 'mansion', 'cemetery', 'spectre', 'specter', 'poltergeist', 'vampire', 'coffin'],
    motifs: ['monoliths', 'lanterns', 'arches', 'roots'],
    palette: { background: '#0a0f0d', floor: '#1a221e', floorAlt: '#202a25', wall: '#2c3a33', wallEdge: '#a9c9b2', accent: '#b8f5c8', accentSoft: '#e7c46a', glow: '#d8ffe6', hazard: '#8ee06f', text: '#eef5f0' },
    adjectives: ['Haunted', 'Unquiet', 'Pale', 'Mourning', 'Hollow'],
    nouns: ['Necropolis', 'Vigil', 'Wake', 'Ossuary', 'Chapel'],
    taglines: ['The dead kept the appointment; the living did not. Eleven lanterns burn.', 'Grave-lanterns lit for a funeral nobody finished.', 'Something still says the names every night.'],
    summary: 'Grave-marker monoliths and mourning lanterns in a mist that will not lift; the buried stood up for a wake that has not ended.',
    rooms: {
      entry: { names: ['Lychgate', '{word} Yard', 'Mourners\' Path'], descriptions: ['Grave-lanterns lead between leaning monoliths; the mist keeps the names to itself.', 'The yard where the {word} was laid to rest, briefly.'] },
      mid: { names: ['Ossuary Cloister', '{word} Cloister', 'Vigil Hall'], descriptions: ['Arches of stacked bone; a lantern burns for every name still being called.', 'The cloister where the {word} is still mourned.'] },
      final: { names: ['The Unfinished Wake', 'Rest of the {word}'], descriptions: ['The Anchor site is a bier under the great lantern; the Guardian is the mourner who never left.'] },
    },
    props: ['monolith_shard', 'lantern', 'pillar', 'monolith_shard', 'root_mass', 'lantern'],
    enemies: { entry: ['husk', 'swarmling'], mid: ['channeler', 'lurker'], final: ['guardian', 'husk'] },
    hazardChance: 0.5,
    hazardName: 'grave-mist that drains warmth',
    relics: [
      { title: 'Mourner\'s card', source: 'a damp card left on a bier', text: 'In loving memory of the {word}. The card lists the mourners. Every name on it also appears on a grave-marker outside, in the same order.' },
      { title: 'Sexton\'s roster', source: 'chalked inside the lychgate', text: 'Dug: eleven. Filled: eleven. Occupied this morning: four. Nobody has been up here since the gate was locked, and the gate is still locked.' },
      { title: 'Lantern rite', source: 'engraved on a lantern base', text: 'Light one for each who is gone and they will not come looking for the light themselves. Every lantern is lit. They came anyway.' },
    ],
    remainsFlavor: 'in the grave-mist',
    attunements: [
      { effectId: 'remains_charge', name: 'Last Rites', description: 'Every remains gathered feeds the ultimate 15 points of charge; the dead pay in kind.' },
      { effectId: 'relic_mend', name: 'Mourner\'s Comfort', description: 'Reading a relic mends 20 Integrity; somebody had to remember the names.' },
    ],
  },
  {
    id: 'void',
    keywords: ['void', 'space', 'star', 'cosmos', 'cosmic', 'nebula', 'orbit', 'galaxy', 'moon', 'asteroid', 'observatory', 'astral', 'comet', 'blackhole', 'planet', 'satellite', 'alien', 'astronaut', 'lunar', 'stellar', 'universe', 'constellation'],
    motifs: ['spires', 'crystals', 'monoliths', 'cables'],
    palette: { background: '#05040f', floor: '#12102a', floorAlt: '#181538', wall: '#241f52', wallEdge: '#8f7bff', accent: '#b39cff', accentSoft: '#ff7ab6', glow: '#e0d6ff', hazard: '#ff5c8a', text: '#f1edff' },
    adjectives: ['Starless', 'Orbital', 'Distant', 'Silent', 'Vantage'],
    nouns: ['Observatory', 'Relay', 'Spire', 'Array', 'Horizon'],
    taglines: ['A relay tower still listening for the {word} from a star that went dark.', 'The stars went out one at a time. Someone kept count.', 'Signal received at the dish at 04:12; the reply desk has been empty since.'],
    summary: 'Needle spires and crystal antennae under a dead sky; a listening post that kept transmitting after the last star it watched went dark.',
    rooms: {
      entry: { names: ['Threshold Concourse', '{word} Platform', 'Uplink Gate'], descriptions: ['A transit platform under a starless dome; the spires above still hum with signal.', 'The platform where the {word} first came through.'] },
      mid: { names: ['Signal Gallery', '{word} Array', 'Antenna Cloister'], descriptions: ['Crystal antennae line the gallery, each tuned to a star that is no longer there.', 'The array that was pointed at the {word}.'] },
      final: { names: ['Vantage Core', 'Horizon of the {word}'], descriptions: ['The Anchor site sits under the great dish; the Guardian is the last thing it received.'] },
    },
    props: ['terminal', 'crystal_cluster', 'pillar', 'cable_bundle', 'monolith_shard', 'crystal_cluster'],
    enemies: { entry: ['sentinel', 'swarmling'], mid: ['channeler', 'lurker'], final: ['guardian', 'sentinel'] },
    hazardChance: 0.5,
    hazardName: 'decompression seams in the floor',
    relics: [
      { title: 'Transmission log', source: 'a terminal frozen on its last frame', text: 'Star 4471 dark. Star 4472 dark. Star 4473 answered. It has never answered before. It asked for the {word}. Reply pending.' },
      { title: 'Astronomer\'s note', source: 'taped to an eyepiece', text: 'Do not look at the new star through the 40-inch lens. Star 4473 has an iris, and on the third night it learned how to focus.' },
      { title: 'Countdown', source: 'painted along the dish rim', text: 'Ten stars left. Nine. Eight. The numbers continue all the way around the rim and end at a single word: one, underlined many times.' },
    ],
    remainsFlavor: 'under the dead sky',
    attunements: [
      { effectId: 'bolt_ward', name: 'Signal Shielding', description: 'Enemy bolts scatter against the static of the array.' },
      { effectId: 'anchor_grace', name: 'Uplink Priority', description: 'The Anchor plants faster while the relay still listens.' },
    ],
  },
  {
    id: 'archive',
    keywords: ['library', 'archive', 'book', 'scroll', 'scholar', 'ink', 'tome', 'letter', 'museum', 'record', 'memory', 'manuscript', 'librarian', 'study', 'university', 'school', 'academy', 'knowledge', 'whisper'],
    motifs: ['arches', 'lanterns', 'monoliths', 'roots'],
    palette: { background: '#140f0a', floor: '#2e2317', floorAlt: '#38291b', wall: '#4b3824', wallEdge: '#e8b86a', accent: '#ffd591', accentSoft: '#7fb3ff', glow: '#fff0c8', hazard: '#ff7f50', text: '#fff6e8' },
    adjectives: ['Whispering', 'Unread', 'Ink-Dark', 'Catalogued', 'Forgotten'],
    nouns: ['Archive', 'Athenaeum', 'Stacks', 'Scriptorium', 'Index'],
    taglines: ['A library where the books still whisper, mostly about the {word}.', 'Every shelf is full. Every reader is gone.', 'The catalogue knows where you are.'],
    summary: 'Vaulted reading halls under amber lanterns, shelf-monoliths of unread volumes, and an index that kept filing long after the last scholar left.',
    rooms: {
      entry: { names: ['Reading Room', '{word} Wing', 'Card Catalogue'], descriptions: ['Amber lanterns over long tables; books left open for years still turn their own pages.', 'The wing devoted to the {word}.'] },
      mid: { names: ['The Stacks', '{word} Stacks', 'Scriptorium'], descriptions: ['Shelf-monoliths climb into the dark; a ladder on rails moves along the stacks with nobody on it.', 'The stacks where the {word} was filed and forgotten.'] },
      final: { names: ['Restricted Index', 'Last Page of the {word}'], descriptions: ['The Anchor site is the reading desk of the head archivist; the Guardian is the index itself.'] },
    },
    props: ['pillar', 'lantern', 'monolith_shard', 'crate', 'pillar', 'lantern'],
    enemies: { entry: ['husk', 'swarmling'], mid: ['channeler', 'sentinel'], final: ['guardian', 'channeler'] },
    hazardChance: 0.35,
    hazardName: 'ink pools that never dried',
    relics: [
      { title: 'Overdue slip', source: 'tucked inside a book left open', text: 'Title: the {word}. Borrower: illegible. Due: a date the calendar no longer reaches. Fine accrued: everything.' },
      { title: 'Marginalia', source: 'pencilled in a margin, growing more hurried', text: 'The whispering is the books reading themselves, three shelves at a time. It is louder in the stacks and loudest at the index desk. The index has my name from a borrowing card I signed in year nine.' },
      { title: 'Archivist\'s last entry', source: 'ink on the head desk, unblotted', text: 'Filed the last volume. Turned to leave. The catalogue drawer for my own name was already open, and there was already a card in it.' },
    ],
    remainsFlavor: 'between the shelves',
    attunements: [
      { effectId: 'relic_mend', name: 'Well-Read', description: 'Reading a relic mends 20 Integrity; a chair and a page are a kind of rest.' },
      { effectId: 'clear_surge', name: 'Catalogued', description: 'Each cleared hall is filed and paid: 2 bonus resources on room clear.' },
    ],
  },
  {
    id: 'swamp',
    keywords: ['swamp', 'bog', 'marsh', 'fungus', 'fungal', 'mushroom', 'spore', 'mud', 'rot', 'slime', 'mire', 'toad', 'frog', 'mold', 'mould', 'fen', 'decay', 'sludge', 'ooze', 'toxic', 'poison'],
    motifs: ['roots', 'lanterns', 'ruined_machinery', 'monoliths'],
    palette: { background: '#0a0e08', floor: '#1c2416', floorAlt: '#23301c', wall: '#33422a', wallEdge: '#b9d96a', accent: '#c8f06a', accentSoft: '#c07cff', glow: '#e4ff9a', hazard: '#a7ff3d', text: '#f2f7e6' },
    adjectives: ['Rotting', 'Spore-Lit', 'Sunken', 'Fetid', 'Blooming'],
    nouns: ['Mire', 'Fen', 'Bloom', 'Bog-Hall', 'Rot'],
    taglines: ['A drowned mill where the fungus does the milling now, grinding the {word}.', 'Everything is soft here. Do not stand still.', 'The spores glow so you can see what is growing on you.'],
    summary: 'Root-tangled walkways over glowing bog, spore-lit lanterns, and drowned machinery slowly being digested by something patient and violet.',
    rooms: {
      entry: { names: ['Bog Landing', '{word} Fen', 'Sporeway'], descriptions: ['Rotting roots make a walkway over glowing mire; the spores drift up to meet you.', 'The landing where the {word} first took root.'] },
      mid: { names: ['Fungal Mill', '{word} Bloom', 'Digestion Hall'], descriptions: ['Half-swallowed machinery turns under violet spore-lanterns.', 'The hall where the {word} blooms brightest.'] },
      final: { names: ['The Fruiting Body', 'Root of the {word}'], descriptions: ['The Anchor site is the one dry stone; the Guardian is what the bog grew to keep it.'] },
    },
    props: ['root_mass', 'lantern', 'cable_bundle', 'crate', 'root_mass', 'monolith_shard'],
    enemies: { entry: ['spewer', 'swarmling'], mid: ['lurker', 'husk'], final: ['guardian', 'spewer'] },
    hazardChance: 0.95,
    hazardName: 'glowing bog that dissolves footing',
    relics: [
      { title: 'Miller\'s complaint', source: 'carved into a waterlogged beam', text: 'The wheel turns without water now. Something under the {word} is turning it. I have stopped asking what it grinds.' },
      { title: 'Spore chart', source: 'a botanist\'s slate, half dissolved', text: 'Day one: the glow is beautiful. Day four: the glow is on my hands. Day nine: the glow is under them. I have decided to find it beautiful again.' },
      { title: 'Warning stake', source: 'a stake driven into the walkway, lettering half eaten', text: 'DO NOT DRINK. DO NOT TOUCH. DO NOT STAND STILL, burned into a stake driven at the third plank. The bottom of the stake has been chewed through to the iron pin.' },
    ],
    remainsFlavor: 'in the mire',
    attunements: [
      { effectId: 'hazard_ward', name: 'Waxed Boots', description: 'The bog and its spat acid deal 40% less through the waxed boot leather.' },
      { effectId: 'remains_charge', name: 'Decomposer', description: 'Each remains picked up feeds the ultimate 15 points of charge; rot is fuel here.' },
    ],
  },
  {
    id: 'clockwork',
    keywords: ['clock', 'clockwork', 'gear', 'cog', 'automaton', 'machine', 'factory', 'engine', 'steam', 'brass', 'mechanical', 'robot', 'android', 'piston', 'assembly', 'industrial', 'mech', 'reactor', 'laboratory', 'lab', 'workshop'],
    motifs: ['ruined_machinery', 'spires', 'cables', 'lanterns'],
    palette: { background: '#100c08', floor: '#2a2015', floorAlt: '#33281b', wall: '#4a3a22', wallEdge: '#f0b95a', accent: '#ffcf6e', accentSoft: '#55d6c2', glow: '#ffe6a8', hazard: '#ff7d3a', text: '#fff4e0' },
    adjectives: ['Brass', 'Ticking', 'Wound', 'Unattended', 'Escapement'],
    nouns: ['Works', 'Manufactory', 'Escapement', 'Movement', 'Assembly'],
    taglines: ['A factory that kept its shifts after the workers stopped, building the {word}.', 'Every gear turns and the assembly line delivers nothing to the loading dock.', 'Wound once, a very long time ago.'],
    summary: 'Brass gear-halls and steam-scarred assembly lines under teal warning lamps; the machines finished their work and started on the workers.',
    rooms: {
      entry: { names: ['Intake Floor', '{word} Line', 'Escapement Gate'], descriptions: ['Conveyor pits and idle grapples; a great escapement ticks above the entry.', 'The intake line where the {word} arrived in crates.'] },
      mid: { names: ['Assembly Hall', '{word} Works', 'Boiler Gallery'], descriptions: ['Gear-trains climb the walls; something is assembled and disassembled in turn.', 'The works where the {word} was fitted together.'] },
      final: { names: ['The Mainspring', 'Movement of the {word}'], descriptions: ['The Anchor site sits inside the mainspring housing; the Guardian is the governor that never let it stop.'] },
    },
    props: ['terminal', 'cable_bundle', 'crate', 'pillar', 'lantern', 'terminal'],
    enemies: { entry: ['sentinel', 'swarmling'], mid: ['warden', 'sentinel'], final: ['guardian', 'warden'] },
    hazardChance: 0.7,
    hazardName: 'steam vents and live gearing',
    relics: [
      { title: 'Shift card', source: 'punched and left in the clock', text: 'In: sixth bell. Out: blank. Every card in the rack is punched in and never out. The clock is still running. So is the shift.' },
      { title: 'Foreman\'s standing order', source: 'riveted brass plate above the line', text: 'The line does not stop for anyone, riveted in brass above station 12. Beneath it, scratched with a punch: it did not. Then, deeper, in the same hand: it did not.' },
      { title: 'Blueprint fragment', source: 'oil-stained draughting paper', text: 'Assembly {word}: fit part A to part B. Part A is drawn as a hand. Part B is drawn as a hand. The tolerances are very precise.' },
    ],
    remainsFlavor: 'on the line',
    attunements: [
      { effectId: 'melee_ward', name: 'Brass Gauntlets', description: 'Melee and charge hits ring off your plating and deal less.' },
      { effectId: 'first_strike', name: 'Escapement Strike', description: 'Your first blow on a fresh hostile lands with the whole movement behind it.' },
    ],
  },
  {
    id: 'crystal',
    keywords: ['crystal', 'gem', 'diamond', 'prism', 'glass', 'mirror', 'amethyst', 'quartz', 'geode', 'shard', 'jewel', 'rainbow', 'light', 'refract', 'lens', 'kaleidoscope', 'sapphire', 'emerald', 'ruby'],
    motifs: ['crystals', 'arches', 'monoliths', 'spires'],
    palette: { background: '#150c2a', floor: '#2c1d4d', floorAlt: '#36265c', wall: '#472f74', wallEdge: '#b58cff', accent: '#d8a8ff', accentSoft: '#ff6bd6', glow: '#d8a8ff', hazard: '#ff658f', text: '#f4e9ff' },
    adjectives: ['Prismatic', 'Refracted', 'Violet', 'Faceted', 'Shattered'],
    nouns: ['Observatory', 'Geode', 'Lens', 'Gallery', 'Tide'],
    taglines: ['A prism observatory above a frozen electric sea, its lens turned on the {word}.', 'Every surface shows you something slightly wrong.', 'The light comes in. It does not leave.'],
    summary: 'Broken crystal chambers and arched galleries around an observatory core; violet shelves refract a light that arrived from somewhere it should not have.',
    rooms: {
      entry: { names: ['Prism Landing', '{word} Landing', 'Facet Gate'], descriptions: ['Crystal shelves interrupt the violet shallows; every shard shows a different you.', 'The landing where the {word} was first refracted.'] },
      mid: { names: ['Refraction Gallery', '{word} Gallery', 'Lens Cloister'], descriptions: ['Arched buttresses hold a cracked observatory aloft; the light bends to look at you.', 'The gallery where the {word} is kept in focus.'] },
      final: { names: ['Prism Heart', 'Focus of the {word}'], descriptions: ['The Guardian holds the final crystal lens and the Anchor site beneath it.'] },
    },
    props: ['crystal_cluster', 'pillar', 'crystal_cluster', 'monolith_shard', 'lantern', 'terminal'],
    enemies: { entry: ['sentinel', 'swarmling'], mid: ['sentinel', 'lurker'], final: ['guardian', 'channeler'] },
    hazardChance: 0.75,
    hazardName: 'razor shallows of broken crystal',
    relics: [
      { title: 'Tide gauge, cracked', source: 'scratched into the glass of a brass tide gauge', text: 'Hour 1: two fingers over the low mark. Hour 6: the glass is warm. Hour 14: it is not water, whatever they say about the {word}; water does not look back.' },
      { title: 'Observatory roster', source: 'a duty roster pinned under a crystal shelf', text: 'Forty-one names, each with a small lens sigil. Thirty-eight are struck through in the same violet ink the shallows glow with. The three untouched names all share one shift: the night the lens was first turned downward.' },
      { title: 'Prayer to the Focus', source: 'etched around the rim of a cracked lens-plate', text: 'Turn your face to the lens and be counted. Be seen and be kept. The sea only takes what refuses to be seen. My watch-partner Orrin has answered from the third shelf in the wrong voice for six nights.' },
    ],
    remainsFlavor: 'in the refracted light',
    attunements: [
      { effectId: 'bolt_ward', name: 'Prism Skin', description: 'Enemy bolts split against you and arrive weaker.' },
      { effectId: 'guardian_bane', name: 'Focused Light', description: 'Strikes on the Guardian deal 25% more, bent to a burning point through the lens.' },
    ],
  },
  {
    id: 'storm',
    keywords: ['storm', 'thunder', 'lightning', 'sky', 'cloud', 'wind', 'tempest', 'hurricane', 'airship', 'floating', 'tower', 'rain', 'electric', 'gale', 'aerial', 'zeppelin', 'balloon', 'heaven', 'stratosphere'],
    motifs: ['cables', 'spires', 'crystals', 'lanterns'],
    palette: { background: '#070c18', floor: '#142038', floorAlt: '#1a2846', wall: '#24365c', wallEdge: '#7fb8ff', accent: '#9fd0ff', accentSoft: '#ffe66b', glow: '#dbeeff', hazard: '#ffee55', text: '#eef5ff' },
    adjectives: ['Storm-Lashed', 'Windward', 'Thunderous', 'Tethered', 'High'],
    nouns: ['Mooring', 'Spire', 'Anchorage', 'Tower', 'Gantry'],
    taglines: ['A mooring tower in a permanent storm, still waiting for the {word} to dock.', 'Lightning walks the cables like it owns them.', 'Nothing up here has touched the ground in years.'],
    summary: 'Storm-lashed mooring spires strung with live tethers; lightning climbs the cables and the docked airships have not come down.',
    rooms: {
      entry: { names: ['Mooring Deck', '{word} Gantry', 'Windward Gate'], descriptions: ['Tether cables hum with charge; the deck sways in a wind that never drops.', 'The gantry where the {word} was moored.'] },
      mid: { names: ['Tether Gallery', '{word} Spire', 'Lightning Walk'], descriptions: ['Cables converge on a spire of crystal lightning-rods; the floor tingles.', 'The spire the {word} was tethered to.'] },
      final: { names: ['Eye of the Storm', 'Summit of the {word}'], descriptions: ['The Anchor site is the tower\'s crown; the Guardian is what the lightning has been feeding.'] },
    },
    props: ['cable_bundle', 'crystal_cluster', 'pillar', 'lantern', 'cable_bundle', 'terminal'],
    enemies: { entry: ['swarmling', 'sentinel'], mid: ['channeler', 'warden'], final: ['guardian', 'channeler'] },
    hazardChance: 0.85,
    hazardName: 'charged plating that arcs underfoot',
    relics: [
      { title: 'Harbourmaster\'s log', source: 'a rain-warped logbook chained to the mooring post', text: 'Docked: the {word}, storm-damaged, crew of six. Departed: blank. The line for departed has been blank for every ship on the page.' },
      { title: 'Lightning count', source: 'burn marks tallied on a spire', text: 'Struck eleven times before noon. The rods should have carried it. The rods carried it somewhere. The somewhere is getting warmer.' },
      { title: 'Rigger\'s knot', source: 'a message tied into a tether', text: 'If the wind drops, cut every line and let them go. The wind has not dropped. The knot has been retied by a hand with too many fingers.' },
    ],
    remainsFlavor: 'in the storm',
    attunements: [
      { effectId: 'bolt_ward', name: 'Lightning Rod', description: 'Enemy bolts are drawn off you into the tethers.' },
      { effectId: 'dash_echo', name: 'Gale-Step', description: 'The dash carries 40% further on the wind and leaves a crackling wake along the cables.' },
    ],
  },
  {
    id: 'cathedral',
    keywords: ['cathedral', 'church', 'chapel', 'monastery', 'choir', 'saint', 'prayer', 'bell', 'hymn', 'abbey', 'shrine', 'holy', 'sacred', 'angel', 'divine', 'monk', 'priest', 'altar', 'god', 'goddess', 'heavenly'],
    motifs: ['arches', 'lanterns', 'monoliths', 'spires'],
    palette: { background: '#0b0c1c', floor: '#1e2140', floorAlt: '#262a4d', wall: '#363b6a', wallEdge: '#f0c96a', accent: '#ffd98a', accentSoft: '#8fa8ff', glow: '#fff0c0', hazard: '#ff7a7a', text: '#fff7e6' },
    adjectives: ['Gilded', 'Silent', 'Vaulted', 'Consecrated', 'Fallen'],
    nouns: ['Cathedral', 'Basilica', 'Choir', 'Sanctum', 'Reliquary'],
    taglines: ['A cathedral still holding service for a congregation of the {word}.', 'The candles never went out. Neither did the singing.', 'Somebody is still praying, very slowly.'],
    summary: 'Vaulted naves and gilded reliquaries under hundreds of candle-lanterns; a service that began before the end is still being sung.',
    rooms: {
      entry: { names: ['Narthex', '{word} Porch', 'Candle Gate'], descriptions: ['A thousand candles gutter in the entry; the arches above are lost in incense.', 'The porch where the {word} was welcomed in.'] },
      mid: { names: ['The Nave', '{word} Nave', 'Reliquary Aisle'], descriptions: ['Monolith saints watch from the aisles; the choir is somewhere above, still singing.', 'The nave devoted to the {word}.'] },
      final: { names: ['High Altar', 'Sanctum of the {word}'], descriptions: ['The Anchor site is the altar stone; the Guardian is the last celebrant, still robed.'] },
    },
    props: ['pillar', 'lantern', 'monolith_shard', 'lantern', 'pillar', 'crate'],
    enemies: { entry: ['husk', 'swarmling'], mid: ['channeler', 'sentinel'], final: ['guardian', 'channeler'] },
    hazardChance: 0.4,
    hazardName: 'consecrated ground that burns the unblessed',
    relics: [
      { title: 'Order of service', source: 'a printed leaflet on a pew', text: 'Processional. Hymn for the {word}. Reading. Hymn. Blessing. Dismissal. Everything after the Blessing has been crossed out. The service has not reached the Blessing yet.' },
      { title: 'Candle-keeper\'s note', source: 'wax-spotted paper by the candle racks', text: 'Lit a candle for every soul in the parish, 311 of them. Ran out of candles at 300. The racks kept lighting on their own. I have stopped counting the flames at 340 because there are more flames than parish.' },
      { title: 'Confession', source: 'scratched inside the confessional', text: 'I locked the doors so nobody would leave before the Blessing. Forgive me. They did not leave. Forgive me. They are still here. Forgive me.' },
    ],
    remainsFlavor: 'in the candlelight',
    attunements: [
      { effectId: 'relic_mend', name: 'Benediction', description: 'Reading a relic mends 20 Integrity; the blessing on the card was meant for someone else.' },
      { effectId: 'anchor_grace', name: 'Consecration', description: 'The Anchor plants 30% faster on the altar stone.' },
    ],
  },
  {
    id: 'festival',
    keywords: ['festival', 'lantern', 'celebration', 'paper', 'kite', 'carnival', 'circus', 'parade', 'fireworks', 'dream', 'candy', 'sugar', 'toy', 'playground', 'party', 'fair', 'masquerade', 'dance', 'music', 'song'],
    motifs: ['lanterns', 'cables', 'spires', 'arches'],
    palette: { background: '#170a0e', floor: '#33161e', floorAlt: '#3d1c26', wall: '#56283a', wallEdge: '#ffb35c', accent: '#ffd07a', accentSoft: '#ff6f91', glow: '#ffe3a8', hazard: '#ff5e5e', text: '#fff1ea' },
    adjectives: ['Lantern-Lit', 'Paper', 'Festival', 'Midnight', 'Unmasked'],
    nouns: ['Fairground', 'Promenade', 'Pavilion', 'Carnival', 'Night-Market'],
    taglines: ['A festival that never ended because nobody could find the exit, or the {word}.', 'Paper lanterns, painted smiles, and music from somewhere behind the tents.', 'Everyone is still wearing their mask.'],
    summary: 'Lantern-strung promenades and paper pavilions in perpetual dusk; the celebration went on so long the celebrants forgot how to stop.',
    rooms: {
      entry: { names: ['Lantern Promenade', '{word} Gate', 'Ticket Row'], descriptions: ['Strings of paper lanterns sway over an empty promenade; the music is close.', 'The gate where the {word} was let in for free.'] },
      mid: { names: ['Masquerade Pavilion', '{word} Pavilion', 'Dance Floor'], descriptions: ['Masks hang from the cables; the dancers are still turning in the lantern light.', 'The pavilion built for the {word}.'] },
      final: { names: ['The Last Dance', 'Crown of the {word}'], descriptions: ['The Anchor site is the bandstand; the Guardian is the master of ceremonies, still bowing.'] },
    },
    props: ['lantern', 'cable_bundle', 'crate', 'pillar', 'lantern', 'terminal'],
    enemies: { entry: ['swarmling', 'husk'], mid: ['channeler', 'lurker'], final: ['guardian', 'swarmling'] },
    hazardChance: 0.45,
    hazardName: 'firework-scorched boards',
    relics: [
      { title: 'Ticket stub', source: 'a stub trampled into the boards', text: 'Admit one to the {word}. Valid until the music stops. The stub is worn soft from being checked every night for a very long time.' },
      { title: 'Mask-maker\'s sign', source: 'painted board outside an empty stall', text: 'Masks for every face. Faces for every mask. Returns accepted only in person. The stall is empty, and the returns box is full.' },
      { title: 'Bandleader\'s cue card', source: 'sweat-stained card on the bandstand', text: 'Play until they leave. Under it, later: they are not leaving. Under that: keep playing. The card is worn through where a thumb held it.' },
    ],
    remainsFlavor: 'under the paper lanterns',
    attunements: [
      { effectId: 'clear_surge', name: 'Prize Booth', description: 'Every cleared pavilion pays out: 2 bonus resources on room clear.' },
      { effectId: 'dash_echo', name: 'Quickstep', description: 'The dash carries 40% further and leaves a trail of paper-lantern light.' },
    ],
  },
];

/** Player words → enemy kinds, for honest `encounter` attributions. */
export const CREATURE_SYNONYMS: Array<{ enemyId: EnemyId; words: string[] }> = [
  { enemyId: 'guardian', words: ['boss', 'dragon', 'titan', 'colossus', 'leviathan', 'king', 'queen', 'emperor', 'kraken', 'behemoth', 'overlord', 'warlord'] },
  { enemyId: 'warden', words: ['knight', 'warden', 'brute', 'ogre', 'troll', 'juggernaut', 'mech', 'tank', 'bear', 'minotaur', 'golem', 'armored', 'armoured', 'gorilla', 'yeti', 'guard'] },
  { enemyId: 'channeler', words: ['mage', 'wizard', 'witch', 'priest', 'cultist', 'sorcer', 'siren', 'shaman', 'oracle', 'channeler', 'psychic', 'ghost', 'spirit', 'wraith', 'necromancer', 'summoner', 'phantom', 'banshee', 'seer'] },
  { enemyId: 'spewer', words: ['slime', 'acid', 'spitter', 'toad', 'frog', 'worm', 'blob', 'ooze', 'plant', 'venom', 'slug', 'leech', 'fungus', 'mushroom', 'puffball'] },
  { enemyId: 'swarmling', words: ['swarm', 'rat', 'bat', 'insect', 'bug', 'drone', 'bee', 'wasp', 'locust', 'imp', 'minion', 'piranha', 'spider', 'crab', 'gremlin', 'goblin', 'scarab', 'beetle', 'moth', 'ant', 'mosquito', 'jellyfish', 'fish'] },
  { enemyId: 'lurker', words: ['shark', 'ambush', 'stalker', 'lurker', 'snake', 'wolf', 'assassin', 'shadow', 'panther', 'tiger', 'hunter', 'crocodile', 'alligator', 'eel', 'octopus', 'squid', 'scorpion', 'raptor', 'ninja'] },
  { enemyId: 'sentinel', words: ['sentry', 'sentri', 'turret', 'statue', 'robot', 'sentinel', 'watcher', 'eye', 'android', 'automaton', 'construct', 'gargoyle', 'totem', 'idol'] },
  { enemyId: 'husk', words: ['zombie', 'undead', 'corpse', 'ghoul', 'husk', 'mummy', 'skeleton', 'crew', 'soldier', 'pirate', 'bandit', 'thug', 'cultist', 'villager', 'miner', 'sailor', 'raider', 'marine', 'trooper'] },
];

/** Player words → props, for honest `prop` attributions. */
export const PROP_SYNONYMS: Array<{ propId: PropId; words: string[]; label: string }> = [
  { propId: 'crate', words: ['crate', 'box', 'barrel', 'loot', 'treasure', 'chest', 'cargo', 'supplies', 'coffin', 'trunk'], label: 'crates' },
  { propId: 'lantern', words: ['lantern', 'lamp', 'candle', 'torch', 'light', 'beacon', 'fire', 'flame', 'glow'], label: 'lanterns' },
  { propId: 'terminal', words: ['terminal', 'computer', 'console', 'screen', 'machine', 'server', 'radio', 'transmitter', 'panel', 'monitor'], label: 'terminals' },
  { propId: 'crystal_cluster', words: ['crystal', 'gem', 'shard', 'diamond', 'ice', 'glass', 'prism', 'quartz'], label: 'crystal clusters' },
  { propId: 'root_mass', words: ['root', 'tree', 'vine', 'forest', 'wood', 'plant', 'branch', 'bush', 'moss', 'mushroom', 'fungus'], label: 'root masses' },
  { propId: 'cable_bundle', words: ['cable', 'wire', 'rope', 'chain', 'tether', 'net', 'web', 'cord'], label: 'cable bundles' },
  { propId: 'pillar', words: ['pillar', 'column', 'statue', 'post', 'totem', 'obelisk', 'tower'], label: 'pillars' },
  { propId: 'monolith_shard', words: ['monolith', 'stone', 'tomb', 'altar', 'grave', 'slab', 'rune', 'tablet', 'rock', 'boulder'], label: 'monolith shards' },
];

export const HAZARD_WORDS = ['lava', 'fire', 'acid', 'poison', 'toxic', 'water', 'flood', 'electric', 'lightning', 'ice', 'void', 'radiation', 'spike', 'trap', 'thorn', 'magma', 'plasma', 'steam', 'quicksand', 'tar', 'oil', 'gas', 'hazard', 'danger', 'deadly'];

/** Generic remains lore per enemy kind; `{flavor}` is the theme's remainsFlavor, `{word}` a player word. */
export const REMAINS_TEMPLATES: Record<EnemyId, LoreTemplate[]> = {
  husk: [
    { title: 'Signed articles', source: 'folded in a husk\'s jacket', text: 'A contract with a thumbprint where the name should be, dated the ninth. Whoever signed it kept working {flavor} long after the last paymaster left the ledger.' },
    { title: 'Identity tag', source: 'on a chain around a husk\'s neck', text: 'Name worn smooth. Role: {word} detail. The tag is warm, which it should not be, and it is the only warm thing about the body.' },
  ],
  swarmling: [
    { title: 'Salvage-drone casing', source: 'from a swarmling\'s cracked shell', text: 'Cheap drones loosed to strip everything {flavor}. Nobody told them the job was over, so they kept stripping until only the crew was left to take.' },
    { title: 'Hive scrap', source: 'chitin and wire from a swarmling', text: 'Part insect, part salvage, six legs of stripped wire. Something {flavor} taught the small things to work together, and then pointed them at the crew.' },
  ],
  sentinel: [
    { title: 'Deck-watch lantern', source: 'from the fist of a fallen sentinel', text: 'The watch walked {flavor} with lanterns so nothing could move unseen. The watch is still walking. The lanterns still see.' },
    { title: 'Standing order', source: 'etched into a sentinel\'s chestplate', text: 'HOLD POSITION UNTIL RELIEVED, stamped on the chestplate above the serial number. The relief roster {flavor} was never filled past the first two names.' },
  ],
  lurker: [
    { title: 'Stowaway\'s blade', source: 'wedged in a lurker\'s shell', text: 'A shiv ground from a hull rivet, twelve centimetres of it. Someone hid {flavor} for nine days waiting for their chance, and the carapace on the body is the bargain they took instead of the door.' },
    { title: 'Hunter\'s tally', source: 'notches on a lurker\'s carapace', text: 'One notch for every catch made {flavor}. There is not much carapace left without notches.' },
  ],
  guardian: [
    { title: 'The keeper\'s charge', source: 'torn from the guardian\'s shoulders', text: 'A standard stitched with a dying star, forty stitches to the point. The keeper swore this place would never fall while they stood {flavor}, and they never stopped standing at the pedestal.' },
    { title: 'Warden\'s key', source: 'hanging from the guardian\'s rusted chain', text: 'The key to the last door, worn smooth by one hand over a watch of eleven years. Relief never came {flavor}, so the hand kept the key.' },
  ],
  spewer: [
    { title: 'Ruptured sac', source: 'what a spewer leaves behind', text: 'Something that was once a container for water or fuel, {flavor}, until it learned to make its own and aim it.' },
    { title: 'Corroded badge', source: 'half dissolved in a spewer\'s residue', text: 'Sanitation detail, {word} sector. Whoever wore it worked {flavor} with the wrong chemicals for far too long.' },
  ],
  warden: [
    { title: 'First mate\'s whistle', source: 'on a chain around a warden\'s neck', text: 'Three notes to advance, two to fall back, one to hold. The mate has been blowing one note {flavor} for a very long time.' },
    { title: 'Riot plating', source: 'stripped from a warden', text: 'Heavy armour issued for keeping order {flavor}. The order it kept was the last one it was given.' },
  ],
  channeler: [
    { title: 'Tuning fork', source: 'from a channeler\'s open hand', text: 'Stamped with the pitch of the {word}, 440 cycles. The channeler tuned the other eleven to it every night {flavor}, and by the ninth night the choir bell rang the same 440 with no hand on the rope.' },
    { title: 'Focus stone', source: 'still warm in a channeler\'s grip', text: 'A lens for a mind. Whoever held it {flavor} looked into something for too long, and it started looking out.' },
  ],
};

export const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'where', 'that', 'this', 'is', 'are', 'was', 'were', 'be', 'it', 'its', 'as', 'by', 'from', 'into', 'over', 'under', 'through', 'still', 'very', 'some', 'lots', 'like', 'just', 'really', 'world', 'place', 'there', 'their', 'them', 'they', 'you', 'your', 'our', 'we', 'i', 'my', 'me', 'have', 'has', 'had', 'but', 'not', 'no', 'so', 'if', 'then', 'than', 'more', 'most', 'many', 'much', 'all', 'every', 'each', 'while', 'when', 'what', 'which', 'who', 'how', 'also', 'too', 'can', 'could', 'would', 'should', 'want', 'wants', 'make', 'made', 'full', 'lot', 'big', 'giant', 'huge', 'little', 'small', 'tiny', 'old', 'new', 'weird', 'cool', 'awesome', 'thing', 'things', 'stuff', 'something', 'everything', 'everyone', 'somewhere', 'level', 'room', 'rooms', 'area', 'zone', 'map', 'game', 'land', 'lands', 'place', 'places']);
