A biome brief is one floor of the run. Each brief: name
(max 40, aim 28: a bible place), tagline (max 80, aim 70: what is in there that matters to
a fight or to the story, with a number), motifIds (1 to 3), enemyPool (1 to 5 registry
enemy ids, at least one that is not guardian, no duplicates), propPool (1 to 5 prop ids,
never anchor_pedestal), hazards, and layout, which sets the SHAPE of the floor:
  linearity 0..1 (0 sprawling, 1 one long spine), branchiness 0..1 (0 few side rooms,
  1 a maze of dead ends), specials: treasure 0-2, lore 0-4, rest 0-2, elite 0-4.
terrain (or null for defaults): features (up to four of breakable_walls, bridges, rubble,
conduits), layout (scattered, barricades, crossroads), density (sparse, balanced, dense);
this decides how the biome's fighting rooms play.
Choose the shape from what the place was: an archive is a maze with many lore rooms; a
siege wall or a rail platform is a spine with elites; a ward has rest rooms. Biomes of one
world must differ from each other in shape, enemy pool and motifs.
roomLines: one line under each key entrance, combat, elite, treasure, lore, rest, exit
(max 100 chars each). What is visible from the door of that kind of room in this biome:
threat first with where it is, then one usable feature. Rest, lore and treasure rooms have
no threat: say what is on the table. Enemies are named by their former job from the bible.
Seven lines, seven different openings. Rest and treasure rooms differ from floor to floor:
name what this particular room was used for and the one object left on its table.
