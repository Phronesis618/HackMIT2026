/**
 * Word lists for the prose linter (src/shared/prose.ts). Pure data, no imports.
 *
 * Provenance and licence
 * ----------------------
 * - SLOP_WORDS_STRONG / SLOP_WORDS_WEAK / SLOP_NAMES / SLOP_PHRASES are a hand-curated
 *   subset (roughly 15%) of the lists published in sam-paech/antislop-sampler
 *   (`slop_words_2025-04-07.json`, `slop_phrases_2025-04-07.json`,
 *   `slop_phrase_prob_adjustments.json`), which is licensed Apache-2.0:
 *   https://github.com/sam-paech/antislop-sampler/blob/main/LICENSE
 *   Those lists rank words by how over-represented they are in LLM fiction against a
 *   human baseline (Paech et al., "Antislop", arXiv 2510.15061). We kept the entries
 *   that show up in short game text and DROPPED the ones that are ordinary nouns in
 *   this game: relic, beacon, neon, static, pulse, cracked, carved, armor, surge,
 *   spark, anomaly, holographic. Do not re-add them.
 * - The encyclopaedic-register words come from the vocabulary section of
 *   https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (CC BY-SA 4.0; single
 *   words are not copyrightable, the page is cited as the source of the selection).
 * - ABSTRACT_NOUNS, CONCRETE_NOUNS, PERSON_NOUNS, MENTAL_VERBS were written for this repo.
 *
 * Keep every entry lowercase. Plurals are handled by the linter (it strips -s / -es).
 */

/** 3 points each. One of these in a 60-word fragment is enough to fail it. */
export const SLOP_WORDS_STRONG: readonly string[] = [
  'tapestry', 'tapestries', 'testament', 'symphony', 'kaleidoscope', 'cacophony', 'ethereal',
  'otherworldly', 'palpable', 'ineffable', 'labyrinthine', 'gossamer', 'enigma', 'enigmatic',
  'unfathomable', 'unspoken', 'unyielding', 'unwavering', 'relentless', 'inexorable', 'eldritch',
  'timeless', 'eternal', 'eternity', 'ageless', 'primordial', 'primal', 'celestial', 'cosmic',
  'transcend', 'transcended', 'transcends', 'resonate', 'resonates', 'resonated', 'reverberate',
  'reverberates', 'reverberated', 'delve', 'delves', 'delved', 'delving', 'intricate', 'intricacies',
  'meticulous', 'meticulously', 'pivotal', 'crucial', 'vibrant', 'bustling', 'nestled', 'beckons',
  'beckon', 'beckoned', 'beckoning', 'harbinger', 'liminal', 'myriad', 'countless', 'untold',
  'unseen', 'forgotten', 'mysterious', 'mysteries', 'mystery', 'secrets', 'whispers', 'whisper',
  'whispered', 'whispering', 'echoes', 'echoed', 'echoing', 'shimmering', 'shimmered', 'shimmer',
  'thrum', 'thrums', 'thrummed', 'thrumming', 'pulsating', 'pulsated', 'iridescent', 'obsidian',
  'eerie', 'eerily', 'ominous', 'ominously', 'foreboding', 'unsettling', 'haunting', 'haunted',
  'sentinel-like', 'remnants', 'vestiges', 'essence', 'embrace', 'embraces', 'embraced',
  'yearning', 'yearns', 'yearned', 'solace', 'resilience', 'defiance', 'newfound', 'interplay',
  'landscape', 'realm', 'realms', 'showcase', 'showcases', 'showcasing', 'underscore', 'underscores',
  'underscoring', 'embark', 'embarks', 'dormant', 'fostering', 'garner', 'boasts', 'enduring', 'profound', 'profoundly',
];

/** 1 point each. Fine alone; two in a short line is a smell. */
export const SLOP_WORDS_WEAK: readonly string[] = [
  'glow', 'glows', 'glowed', 'glowing', 'faint', 'faintly', 'flicker', 'flickers', 'flickered',
  'flickering', 'hum', 'hums', 'hummed', 'humming', 'shadows', 'shadow', 'shadowy', 'echo',
  'ancient', 'silent', 'silence', 'silently', 'stillness', 'gleaming', 'gleamed', 'glinting',
  'luminous', 'bioluminescent', 'radiant', 'swirling', 'swirled', 'drifting', 'drifted', 'dancing',
  'danced', 'dances', 'lingering', 'lingered', 'lingers', 'looming', 'loomed', 'looms', 'towering',
  'sprawling', 'crumbling', 'weathered', 'jagged', 'twisted', 'hollow', 'void', 'abyss', 'depths',
  'veil', 'shroud-like', 'strange', 'strangely', 'peculiar', 'unnatural', 'unfamiliar', 'endless',
  'endlessly', 'forever', 'never-ending', 'utterly', 'truly', 'deeply',
  'very', 'quite', 'simply', 'merely', 'sheer', 'stark', 'subtle', 'subtly', 'delicate', 'fragile',
  'fleeting', 'restless', 'patiently', 'hungry', 'watchful', 'woven', 'weave', 'weaves',
  'weaving', 'wove', 'threads', 'beneath', 'amidst', 'amid', 'once-proud',
  'long-dead', 'long-lost', 'age-old', 'fate', 'destiny', 'souls', 'soul', 'heartbeat',
  'dread', 'unease', 'sorrow', 'longing', 'awe', 'wonder', 'serene', 'solemn', 'sacred', 'hallowed',
  'vigil', 'slumber', 'slumbers', 'slumbering', 'awaken', 'awakens', 'awakened', 'awakening',
  'stirs', 'stirred', 'stirring', 'gaze', 'gazes', 'gazed', 'robust', 'seamless', 'enhance',
  'enhances', 'unleash', 'unleashes', 'harness', 'journey', 'navigate', 'navigating',
];

/** Names LLMs reach for first. A hit is a hard fail: pick a name from the bible. */
export const SLOP_NAMES: readonly string[] = [
  'elara', 'kael', 'kaelen', 'lyra', 'elias', 'thorne', 'voss', 'seraphina', 'aria', 'zephyr',
  'zephyria', 'eldoria', 'elysia', 'elian', 'eira', 'silas', 'alaric', 'aldric', 'eadric', 'mira',
  'lira', 'lila', 'amara', 'zara', 'orion', 'nyx', 'nova', 'aether', 'aetheria', 'atheria',
  'oakhaven', 'ravenswood', 'whisperwood', 'blackwood', 'nightshade', 'xylar', 'jaxon', 'kaida',
  'isolde', 'rowan', 'ashara', 'vex', 'draven', 'caelum', 'solara', 'lumina', 'umbra',
];

/**
 * Stock phrases ("slop trigrams"). Matched case-insensitively as substrings on a
 * normalised copy of the text (straight apostrophes, single spaces). Hard fail.
 */
export const SLOP_PHRASES: readonly string[] = [
  'a testament to', 'testament to the', 'stands as a', 'stood as a', 'serves as a reminder',
  'a reminder that', 'a reminder of', "couldn't help but", 'could not help but', "can't help but",
  'barely above a whisper', 'barely a whisper', 'sent shivers', 'shiver down', 'shivers down',
  'chill run down', 'something shifted', 'something changed', 'something else entirely',
  'the air was thick', 'air is thick with', 'air hangs heavy', 'hung in the air', 'hangs in the air',
  'hung heavy', 'heavy with the weight', 'the weight of', 'weight of the past', 'casting long shadows',
  'long shadows', 'shadows danced', 'shadows dance', 'dust motes', 'little did', 'only just beginning',
  'was just the beginning', 'is just the beginning', 'that was enough', 'maybe, just maybe',
  'a dance of', 'dance of light', 'a symphony of', 'an orchestra of', 'a tapestry of', 'a sea of',
  'a sense of', 'a mixture of', 'a flicker of', 'a glimmer of', 'a hint of', 'a whisper of',
  'a world of', 'in the heart of', 'at the heart of', 'the heart of the', 'heart of darkness',
  'lost to time', 'sands of time', 'test of time', 'time itself', 'reality itself', 'the very fabric',
  'fabric of reality', 'between worlds', 'long since', 'long forgotten', 'once upon', 'once-great',
  'once great', 'bears witness', 'bore witness', 'silent witness', 'silent sentinel', 'silent guardian',
  'stands watch', 'stand watch', 'stands vigil', 'keeps its secrets', 'holds its secrets',
  'secrets of the', 'waiting to be', 'yet to come', 'no one remembers', 'none remember',
  'some say', 'it is said', 'legend has it', 'legends speak', 'whispers of', 'echoes of',
  'rich history', 'plays a vital role', 'plays a crucial role', 'plays a key role',
  'it is worth noting', "it's worth noting", 'in a world where', 'more than just', 'not merely',
];

/** Used by abstract-heavy and no-ominous-closer. Nouns with no weight, size or serial number. */
export const ABSTRACT_NOUNS: readonly string[] = [
  'silence', 'darkness', 'dark', 'memory', 'memories', 'time', 'fate', 'destiny', 'hope', 'fear',
  'dread', 'sorrow', 'grief', 'truth', 'truths', 'secret', 'secrets', 'mystery', 'eternity',
  'oblivion', 'void', 'nothing', 'nothingness', 'everything', 'essence', 'presence', 'absence',
  'echo', 'echoes', 'whisper', 'whispers', 'promise', 'promises', 'purpose', 'meaning', 'soul',
  'souls', 'spirit', 'dream', 'dreams', 'shadow', 'shadows', 'end', 'ending', 'endings', 'beginning',
  'story', 'stories', 'song', 'hunger', 'longing', 'loss', 'ruin', 'decay', 'legacy', 'past',
  'future', 'forever', 'arrangement', 'argument', 'bargain', 'price', 'burden', 
  'knowledge', 'wisdom', 'madness', 'chaos', 'balance', 'harmony', 'beauty', 'wonder',
  'awe', 'peace', 'death', 'life', 'love', 'faith', 'doubt', 'guilt', 'shame', 'pride', 'rage',
  'fury', 'despair', 'desperation', 'resilience', 'defiance', 'courage', 'sacrifice', 'vigil',
  'world', 'worlds', 'reality', 'existence', 'history', 'eternities', 'moment', 'moments',
  'thing', 'things', 'something', 'anything', 'way', 'ways', 'voice', 'voices', 
  'answer', 'answers', 'question', 'questions', 'warning', 'reminder', 'connection', 'choice',
];

/**
 * Things you can drop on your foot, plus jobs and units. A lore fragment needs at least one
 * of these (or a number). World-specific objects should ALSO be listed in the bible so they
 * count there; this list is the fallback.
 */
export const CONCRETE_NOUNS: readonly string[] = [
  // materials
  'brass', 'iron', 'steel', 'copper', 'tin', 'lead', 'zinc', 'glass', 'crystal', 'salt', 'brine',
  'wax', 'chalk', 'ink', 'paper', 'card', 'cardboard', 'canvas', 'leather', 'rubber', 'plastic',
  'ceramic', 'concrete', 'gravel', 'sand', 'mud', 'clay', 'soil', 'rust', 'oil', 'grease', 'diesel',
  'coolant', 'solder', 'wire', 'cable', 'rope', 'twine', 'tape', 'wood', 'bark', 'root', 'moss',
  'resin', 'bone', 'ash', 'soot', 'coal', 'ice', 'steam', 'bleach', 'soap', 'flour', 'rice', 'tea',
  'coffee', 'sugar', 'vinegar', 'water', 'blood',
  // tools and parts
  'wrench', 'spanner', 'hammer', 'crowbar', 'drill', 'saw', 'knife', 'blade', 'needle', 'hook',
  'bolt', 'nut', 'rivet', 'screw', 'nail', 'pin', 'valve', 'pipe', 'pump', 'gasket', 'seal', 'flange',
  'gauge', 'dial', 'lever', 'switch', 'fuse', 'relay', 'breaker', 'coil', 'rotor', 'piston', 'gear',
  'bearing', 'turbine', 'fan', 'filter', 'vent', 'duct', 'hatch', 'hinge', 'latch', 'lock', 'padlock',
  'chain', 'winch', 'crane', 'rail', 'track', 'sleeper', 'wheel', 'axle', 'brake', 'engine', 'motor',
  'battery', 'cell', 'lamp', 'lantern', 'bulb', 'lens', 'mirror', 'prism', 'antenna', 'dish', 'mast',
  'speaker', 'radio', 'handset', 'terminal', 'console', 'keyboard', 'screen', 'monitor', 'printer',
  'scanner', 'sensor', 'camera', 'drone', 'turret', 'barrel', 'magazine', 'cartridge', 'shell',
  // containers and furniture
  'crate', 'box', 'case', 'trunk', 'locker', 'drawer', 'cabinet', 'shelf', 'shelves', 'rack', 'pallet',
  'drum', 'tank', 'vat', 'bucket', 'jar', 'bottle', 'flask', 'can', 'tin', 'tray', 'bowl', 'mug', 'cup',
  'kettle', 'pot', 'pan', 'stove', 'oven', 'sink', 'table', 'desk', 'bench', 'chair', 'stool', 'bunk',
  'bed', 'cot', 'mattress', 'blanket', 'pillow', 'curtain', 'trolley', 'gurney', 'stretcher', 'cart',
  'wagon', 'carriage', 'satchel', 'bag', 'sack', 'backpack', 'pouch', 'wallet', 'envelope',
  // documents
  'ledger', 'logbook', 'log', 'roster', 'manifest', 'invoice', 'receipt', 'ticket', 'stub', 'tag',
  'label', 'form', 'docket', 'permit', 'passport', 'stamp', 'badge', 'plaque', 'notice', 'poster',
  'letter', 'postcard', 'page', 'notebook', 'clipboard', 'chart', 'map', 'timetable', 'menu',
  'register', 'file', 'folder', 'binder', 'tape', 'reel', 'photograph', 'photo', 'drawing',
  // structures
  'door', 'gate', 'barrier', 'turnstile', 'wall', 'floor', 'ceiling', 'roof', 'stair', 'stairs',
  'ladder', 'ramp', 'bridge', 'gantry', 'catwalk', 'platform', 'pier', 'dock', 'bay', 'berth', 'deck',
  'bulkhead', 'airlock', 'ring', 'corridor', 'gallery', 'ward', 'kitchen', 'canteen', 'mess', 'laundry', 'office', 'booth', 'kiosk',
  'cabin', 'shed', 'silo', 'vault', 'cellar', 'tunnel', 'shaft', 'well', 'pit', 'trench', 'drain',
  'sluice', 'culvert', 'pillar', 'column', 'arch', 'buttress', 'girder', 'beam', 'window', 'pane',
  'shutter', 'greenhouse', 'bed', 'planter', 'trellis', 'pedestal', 'altar', 'grave', 'cairn',
  // body and clothing
  'hand', 'hands', 'finger', 'fingers', 'thumb', 'fingerprint', 'arm', 'elbow', 'knee', 'leg', 'foot',
  'feet', 'boot', 'boots', 'shoe', 'glove', 'gloves', 'helmet', 'visor', 'mask', 'goggles',
  'spectacles', 'glasses', 'coat', 'jacket', 'apron', 'overalls', 'uniform', 'sleeve', 'collar',
  'belt', 'buckle', 'strap', 'tether', 'harness', 'scarf', 'hat', 'cap', 'tooth', 'teeth', 'jaw',
  'rib', 'ribs', 'skull', 'hair', 'nail', 'scar', 'tattoo',
  // jobs
  'engineer', 'quartermaster', 'clerk', 'nurse', 'porter', 'janitor', 'cook', 'driver', 'pilot',
  'diver', 'welder', 'fitter', 'rigger', 'loader', 'stoker', 'signalman', 'inspector', 'warden',
  'guard', 'courier', 'archivist', 'librarian', 'surveyor', 'botanist', 'gardener', 'medic',
  'surgeon', 'foreman', 'captain', 'purser', 'cashier', 'auditor', 'apprentice', 'smuggler',
  // units and money
  'metre', 'metres', 'meter', 'meters', 'litre', 'litres', 'kilo', 'kilos', 'gram', 'grams', 'tonne',
  'tonnes', 'volt', 'volts', 'amp', 'amps', 'degree', 'degrees', 'minute', 'minutes', 'hour', 'hours',
  'shift', 'shifts', 'week', 'weeks', 'coin', 'coins', 'credit', 'credits', 'wage', 'wages', 'fine',
  // animals and food
  'rat', 'rats', 'dog', 'cat', 'goat', 'mule', 'crab', 'eel', 'moth', 'beetle', 'wasp', 'gull',
  'bread', 'soup', 'stew', 'onion', 'onions', 'potato', 'potatoes', 'egg', 'eggs', 'tomato',
  'tomatoes', 'bean', 'beans', 'seed', 'seeds', 'seedling', 'seedlings',
];

/** Subjects that may legitimately remember, wait, watch or decide. */
export const PERSON_NOUNS: readonly string[] = [
  'engineer', 'quartermaster', 'clerk', 'nurse', 'porter', 'janitor', 'cook', 'driver', 'pilot',
  'diver', 'welder', 'fitter', 'rigger', 'loader', 'stoker', 'signalman', 'inspector', 'warden',
  'guard', 'courier', 'archivist', 'librarian', 'surveyor', 'botanist', 'gardener', 'medic',
  'surgeon', 'foreman', 'captain', 'purser', 'cashier', 'auditor', 'apprentice', 'smuggler', 'crew',
  'child', 'boy', 'girl', 'man', 'woman', 'mother', 'father', 'aunt', 'uncle', 'brother', 'sister',
  'director', 'doctor', 'patient', 'patients', 'passenger', 'passengers', 'operative', 'operatives',
  'keeper', 'owner', 'wearer', 'author', 'writer', 'reader', 'dog', 'cat', 'guardian', 'custodian',
  'husk', 'husks', 'lurker', 'lurkers', 'sentinel', 'sentinels', 'spewer', 'swarmling', 'channeler',
  'enemy', 'enemies', 'ally', 'allies', 'player', 'players', 'host', 'team', 'union', 'board',
  'management', 'company', 'office',
];

/** Verbs of mind. With a non-person subject ("the sea remembers") they personify. */
export const MENTAL_VERBS: readonly string[] = [
  'remembers', 'remembered', 'remember', 'forgets', 'forgot', 'forgotten', 'forget', 'knows', 'knew',
  'waits', 'waited', 'watches', 'watched', 'listens', 'listened', 'hungers', 'hungered', 'dreams',
  'dreamed', 'dreamt', 'wants', 'wanted', 'decides', 'decided', 'learns', 'learned', 'learnt',
  'mourns', 'mourned', 'grieves', 'grieved', 'refuses', 'refused', 'whispers', 'whispered', 'sings',
  'sang', 'weeps', 'wept', 'sleeps', 'slept', 'wakes', 'woke', 'breathes', 'breathed', 'expects',
  'expected', 'hopes', 'hoped', 'longs', 'longed', 'yearns', 'yearned', 'judges', 'judged',
  'forgives', 'forgave', 'keeps', 'takes',
];

/** Number words that count as "a number" for the specificity rule. */
export const NUMBER_WORDS: readonly string[] = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'half', 'dozen', 'twice', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'sunday', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
];
