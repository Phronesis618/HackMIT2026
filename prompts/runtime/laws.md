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
one operative tells another: "Dashes carry farther here, and take longer to come back."
"Fewer of them per room, and each one takes much more killing." A description that gives
the fact and never gives the rule is sent back.

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
damage, and tell (hard max 60, aim 50, capitals, nine words at most, counted) is a callout:
the bible object about to hurt the crew, a plain verb, and where to stand. It is shouted
across a room mid-fight, so it is short: "PUMP 6 SPINS UP. GET BEHIND THE CASING."
"BULKHEADS CLOSING IN 5".
A move set that breaks these rules is replaced wholesale, and its names and tells are lost
with it.
