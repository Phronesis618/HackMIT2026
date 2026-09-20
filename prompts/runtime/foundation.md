# This call: the foundation

Write the fields in schema order. The bible comes first because everything after it must
use its names. The bible is never shown to players; it is a list of things that happened.

## bible
- premise (max 200 chars): one flat sentence, what this place was for. A real institution
  with a purpose, staff and a budget. Build it from the players' ideas.
- collapse (max 400): one cause. A named person made a decision on a date; give the number
  that went wrong and how many people were caught by it. No unknown forces.
- people: 3 or 4. name, job, want. The want is small and concrete: a transfer, a count that
  balances, a letter answered. Names are ordinary, the kind found on a payroll: mix origins,
  given name plus surname; the data includes a `namePool` you may draw from when the ideas do
  not imply a culture. Include the person responsible for the collapse.
- places: 2 to 5, objects: 2 to 5 (max 40 chars each). Named, physical, reusable:
  "Pump 6", "Stores Cage B", "Tarn's red wrench". These are the nouns all later text reuses.
- events: 5 to 7 in date order. date (the world's own calendar: "Day 11", "14 March, 22:10",
  "Shift 212") and fact (max 200): one flat past-tense sentence naming a person and
  carrying a number. Events form a chain of cause: each makes the next one possible. If a
  fact could be moved to another world unchanged, make it specific.
- authors: exactly 3 of the people, the ones who wrote things down. document is the physical
  thing they write in. register (max 200) is three or four observable habits: what they
  count, how long their sentences run, a verbal habit. never is what they would not write.
  The three must differ sharply in sentence length and in what they count: a quartermaster
  counts stock, a child counts days, an engineer counts readings. At most one of them is sad.
- enemies: one entry for every enemy id you use in rooms or in the opener biome, guardian
  included. formerJob (max 100) says what those creatures were before the collapse, as a job
  at a named place. The guardian is the person responsible, or the machine they left running.

## title, tagline, themeSummary
- title (max 40, aim 28): the name the inhabitants painted on the door. A place name, or
  facility type plus a number or proper noun. No "of the", no abstract nouns.
- tagline (max 80, aim 70): what it was, then one number that shows the damage.
- themeSummary (max 160): what the place was, what it is built from, what is dangerous underfoot.

## palette, look
Dark backgrounds with readable accents; text must contrast with background. Take the hues
from the place itself (brine green for a pump station, sodium orange for a rail yard), so
two worlds never share a palette. hazard is a warning colour distinct from accent.
look: pick floorMaterial, wallStyle, lighting, particles and particleDensity (1 to 3) from
the registry to match what the place is physically built from and how it is lit now.

## laws
Pick 2 or 3 laws from the registry, from different groups, that follow from the collapse:
the law is the mechanical consequence of what went wrong. intensity 1 to 3.
name (max 40): what the inhabitants called it, from a bible person, place or object.
description (max 160, aim 120): one bible fact that explains why this place works this way.
Do not restate the mechanic or give effect numbers; the engine appends those.

## rooms
Exactly plannedRoomCount room blueprints. Differences between worlds must show in motifs,
props, encounters and terrain, not only colours and names. The final room has `guardian` in
enemyIds and `anchor_pedestal` in propIds.
- name (max 80, aim 28): a bible place or a part of one.
- description (max 100 chars): what is visible from the door, threat first with where it is,
  then one feature of the room the crew can use. Present tense. Name the enemies by their
  former job from the bible, never by registry id.
- terrain: `features` (up to four IDs), `layout`, `density`; null for motif defaults. Pick
  combinations the ideas suggest and vary them across rooms:
  breakable_walls: brittle bulkheads; attacks open a passage and leave slowing rubble.
  bridges: a 2D walkable crossing built into a wall run, ramps at each end. No jumping.
  rubble: slowing patches; a dash ignores the slow but not collision.
  conduits: lanes that speed walking; flanking routes.
  layout `scattered` = islands of cover; `barricades` = long wall runs with crossings;
  `crossroads` = alternating crossings with junction patches. density sparse, balanced, dense.
Do not promise doors, jumping, gravity or any mechanic outside the registries.

## openerBiome
If `floors` is true in the data, write the first biome brief (see the brief rules below);
otherwise null.
{{briefRules}}

## contributionMappings
Map only supplied contribution IDs to features you actually selected, at most one mapping
per contribution. Each names a room index and feature kind. In a room, prop mappings
correspond in order to propIds, encounter mappings to enemyIds; hazard needs hazards=true;
structure or motif refers to that room's first motif; name refers to the room name.
featureDescription (max 200) names the concrete feature plainly. Omit ideas you cannot
represent; never invent a participant or claim a feature that is not there.
