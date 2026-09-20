A biome brief is one floor of the run. Each brief: name
(max 40, aim 28: a bible place), tagline (ONE sentence, eleven words at most, counted, and
under 80 characters: what is in there that matters to a fight or to the story, with a
number. Count the words before sending it. Over 80 characters the line is sent back to be
written again, and if it comes back long the player reads half of it:
"Tables bolted down. Floor plates at 60 C." "Rack for 30 dive tethers, 11 missing."), motifIds (1 to 3), enemyPool (1 to 5 registry
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
roomLines: one line under each key entrance, combat, elite, treasure, lore, rest, exit.
One sentence each, fourteen words at most, counted; a line past 140 characters is sent
back to be written again. Twelve words that finish beat sixteen that get cut.
What is visible from the door of that kind of room in this biome:
threat first with where it is, then one usable feature. Rest, lore and treasure rooms have
no threat: say what is on the table. The ids you put in enemyPool are engine words and
appear in no line: every creature is named by its former job from the bible, singular or
plural as the sentence needs ("one of the brine divers", "four Deck 4 loaders").
Seven lines, seven different openings, and at most two of them may open on a count.
Each line starts on a different thing: one on how many are in the room, one on the
machine or fixture the room was built around, one on the state of the floor, one on a
person named in the bible, one on the way out, one on a number painted or printed in the
room, one on the work that was going on when it stopped. Start on the thing itself, in
this world's nouns; these are categories, not words to reuse. Reading the seven in a row,
no two should start with the same word.
Rest and treasure rooms differ from floor to floor: name what this particular room was
used for and the one object left on its table. That object comes out of THIS world's work:
a part someone was cleaning, a half-filled form, a spare from the store, somebody's lunch
in the wrong container. A thermos, a cold mug, a single chair and a lantern are the stock
furniture of every empty room in every game and are rejected.
