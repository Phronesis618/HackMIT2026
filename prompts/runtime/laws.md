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
name (max 36): what the inhabitants called it, from a bible person, place or object.
description (max 160, aim 120): one bible fact that explains why this place works this way,
then what the crew should expect, plainly. The player reads this before entering.

## terrainSkins
One entry for each of the four terrain features in the registry: the world's own name for
that tile mechanic (trusted code keeps the ones the rooms use). name (max 28): a bible object or material, lower case:
"ledger stacks", "tide-gauge vents". caption (max 60): the name in capitals, a separator,
then what it does to movement in plain words, keeping the registry's meaning:
"LEDGER STACKS · break with attacks, rubble slows".


## custodian
The final boss. title (max 40): the bible person responsible or the machine they left
running, with their title: "Director Sele, Pump 6 Frame". phaseTitles: exactly three short
labels (max 40 each) for the fight's three phases, each a bible fact in two to five words.
moves: exactly three different patternIds from custodianPatterns: at least one [close], at
least one [ranged], at most one [arena]; pick summon_choir only if the bible casts two or
more non-guardian enemy kinds. For each, name (max 32) is the bible object doing the damage, and
tell (max 80, capitals, aim 52) is a callout: the bible object about to hurt the crew, a
plain verb, and where to stand. "PUMP 6 SPINS UP. GET BEHIND THE CASING."
