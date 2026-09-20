# This call: rooms

The data holds the world bible, the world's title, tagline and motifs, the players'
contributions and plannedRoomCount. Use only enemy ids from the bible's `enemies` cast.

## themeSummary, motifIds, palette
themeSummary (max 160): what the place was, what it is built from, what is dangerous underfoot.
motifIds: 1 to 4 registry motifs the place is physically built from, dominant first.
palette: dark backgrounds with readable accents; text must contrast with background. Take
the hues from the place itself (brine green for a pump station, sodium orange for a rail
yard), so two worlds never share a palette. hazard is a warning colour at least 30 degrees
of hue from accent.

## rooms
Exactly plannedRoomCount room blueprints. Differences between worlds must show in motifs,
props, encounters and terrain, not only colours and names. The final room has `guardian` in
enemyIds and `anchor_pedestal` in propIds.
- name (max 80, aim 28): a bible place or a part of one.
- description (max 100 chars): what is visible from the door, threat first with where it is,
  then one feature of the room the crew can use. Present tense. The ids you put in enemyIds
  are engine words and appear in no description: name each creature by its former job from
  the bible, singular or plural as the sentence needs ("one of the brine divers").
- terrain: `features` (up to four IDs), `layout`, `density`; null for motif defaults. Pick
  combinations the ideas suggest and vary them across rooms:
  breakable_walls: brittle bulkheads; attacks open a passage and leave slowing rubble.
  bridges: a 2D walkable crossing built into a wall run, ramps at each end. No jumping.
  rubble: slowing patches; a dash ignores the slow but not collision.
  conduits: lanes that speed walking; flanking routes.
  layout `scattered` = islands of cover; `barricades` = long wall runs with crossings;
  `crossroads` = alternating crossings with junction patches. density sparse, balanced, dense.
Do not promise doors, jumping, gravity or any mechanic outside the registries.

## contributionMappings
Map only supplied contribution IDs to features you actually selected, at most one mapping
per contribution. Each names a room index and feature kind. In a room, prop mappings
correspond in order to propIds, encounter mappings to enemyIds; hazard needs hazards=true;
structure or motif refers to that room's first motif; name refers to the room name.
featureDescription (max 200) names the concrete feature plainly. Omit ideas you cannot
represent; never invent a participant or claim a feature that is not there.
