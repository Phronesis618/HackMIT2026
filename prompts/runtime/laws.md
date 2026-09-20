# This call: look, laws, terrain names, the Custodian

The data holds the world bible and the world's title and tagline.

## look
look: from the registry pick paletteFamily, floorMaterial, wallStyle, lighting and atmosphere
to match what the place is physically built from, how it is lit now and what hangs in its
air, and set atmosphereDensity, skylineDepth (0 interior, 1 open skyline) and grain from 0 to 1.
Material and motif need not match: a crystal cave with a timber floor is a place someone built.

## laws
Pick 2 or 3 laws from the registry that follow from the collapse: the law is the mechanical
consequence of what went wrong here (a flooded station drags; a ward on backup power is dark).
Respect lawConflicts, at most one combat law and one vision law, and keep the summed
difficulty between -1 and 3. intensity 0 to 1 (0.5 is normal).
name (max 36, four words at most): what the inhabitants called it, from a bible person,
place or object.
description (hard max 160, aim 110, twenty words at most, counted): exactly two short
sentences, and both are needed.
  1. One bible fact naming a bible person, place or object: why this place works this way.
  2. The rule itself, in plain words, as advice to the crew.
The game prints the engine's own exact effect beside this name, so your second sentence
carries NO numbers of its own: no percentages, no multipliers, no seconds, no Integrity
totals. They would only argue with the number printed next to them. Write the rule the way
one operative tells another on the way in, in the nouns of this world: what the crew will
notice in the first fight, and what to do about it. It is an instruction, not an image, so
it carries a verb the player can act on: stand, wait, spread out, keep moving, hit the
group, plant your feet. "One deliberate stroke per frame" is an image and tells nobody
anything. Use your own words; a sentence that would fit any world with this law is the
wrong sentence. A description that gives the fact and never gives the rule is sent back.

## terrainSkins
One entry for each of the four terrain features in the registry: the world's own name for
that tile mechanic (trusted code keeps the ones the rooms use). name (max 28, three words at most): a bible object or material, lower case:
e.g. the stacks or vents of this world. caption (hard max 60, aim 45): the name in capitals,
a separator, then what it does in five or six plain words that keep the registry's meaning.
Nine words in the whole caption, counted: "LEDGER STACKS · break with attacks, rubble slows".


## custodian
The final boss. title (hard max 40): the bible person responsible or the machine they left
running, with their title: a name, a comma, the machine or room they hold. phaseTitles:
exactly three labels, hard max 40 characters each, for the fight's three phases, each a
bible fact in two to five words.
moves: exactly three patternIds from custodianPatterns, all three different, in this order:
one marked [close], one marked [ranged], then one marked [control] or [arena]. At most one
of the three may be marked [arena]. Pick summon_choir only if the bible casts two or more
non-guardian enemy kinds. For each move, name (hard max 32, four words at most) is the bible object doing the
damage, and tell (hard max 60, aim 50, capitals, nine words at most, counted) is a callout
shouted across a room mid-fight. It names the bible object about to hurt the crew and
leaves no doubt where safety is, in a thing of this world. The three tells in a fight have
three DIFFERENT sentence shapes. Some shapes that work:
  what it is doing, then where to go:  "PUMP 6 SPINS UP. STAND ON THE GRATING."
  a countdown:                          "BULKHEADS CLOSING IN 5"
  the boss's own words:                 "TARN: I SAID CLEAR MY DECK. SHE MEANS THE RED PLATES."
  where safety is, and nothing else:    "DRY FLOOR BY THE LOCKERS. NOWHERE ELSE."
Whatever the shape, a crew member who hears only this line knows where to stand: a tell
that is all attitude ("KADER: JUST LET IT RUN.") is no use in a fight.
A callout is shouted by somebody standing in this room, in the words the people here use for
each other and for their own machines. Briefing-room vocabulary belongs to another game and
is rejected: hostile, sightline, engage, perimeter, radius, rearmost, sitrep, ETA. The crew
are called what the people here call each other, and these creatures are their former job
("the loaders", "the night porters") and never "operatives", which is the engine's word and
not this world's. The thing about to hurt them has this world's name, and where to stand is a
place in this room.
"GET BEHIND THE <something>" has been used by every world so far: it is marked down
by the checker, so say it another way. Rejected outright are the registry's own words for the counter ("dash the gap", "step off the
mark", "sidestep one tile", "walk off it"): those are engine phrasing.
A move set that breaks these rules is replaced wholesale, and its names and tells are lost
with it.
