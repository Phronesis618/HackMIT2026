# This call: the foundation

Write the fields in schema order, all ten of them, each at the top level of the tool input:
`premise`, `collapse`, `people`, `places`, `objects`, `events`, `authors`, `enemies`, then
`title` and `tagline`. There is no wrapper key. A list is a list and an object is an object;
never send one as a string.

The first eight fields are the world bible: everything written after this call must use its
names. The bible is never shown to players; it is a list of things that happened. Other
writers are waiting on this call, so be brief: every field has a tight character limit, and
a flat short fact is worth more than a long one.

## bible
- Take every idea literally and build it into the premise, the people, the places or the
  cast. A strange idea stays strange and is treated as routine by the people who worked
  there: if geese run quality control, the quality inspectors are geese, with names, a shift
  pattern and a line in the budget. No idea is quietly replaced by something more sensible.
- The humour here is dry and comes from a fact: a number, a job title, a delay, a rule somebody
  followed exactly. It never comes from an animal that behaves like a person, from a pun, or
  from a narrator winking at the reader. The geese are funny because of the budget line.
- premise (max 120 chars): one flat sentence, what this place was for. A working place
  with a purpose and people who turned up to it; it may be as small as a pub, a ferry or
  a school kitchen, and it does not need a head office. Build it from the players' ideas.
- collapse (max 200): one cause. A named person did one physical thing on a date: they
  moved, opened, overfilled, swapped, wedged, switched off, held back or let in a named
  object. Give the number that went wrong and how many people were caught by it. No unknown
  forces. The data carries a `collapseKind`: build the act on it unless the ideas clearly
  point elsewhere. The reason is as often private as professional: a bet, a sulk, a favour,
  a child who could not be left at home. Nobody here needs a policy to ruin a place. A signature, a countersigned order or an unread form can be the evidence
  the crew finds afterwards; the act itself is something done with hands, to a thing.
- people: 3 or 4. name, job (max 36), want (max 56). The want is small and concrete: a transfer, a count that
  balances, a letter answered. Names are ordinary, the kind found on a payroll: mix origins,
  given name plus surname; the data includes a `namePool` you may draw from when the ideas do
  not imply a culture. Include the person responsible for the collapse.
- places: 3 or 4, objects: 3 or 4 (max 28 chars each). Named, physical, reusable:
  a numbered machine, a room with a letter on the door, one person's marked tool. These are
  the nouns all later text reuses. A number in this world is something a person counted,
  measured or was issued: 40 gasket kits, 2 m of salt, bed 4. Reference codes invented to
  sound official (Shift 41-C, lot B-004, form QC-7, roll #338) are the cheapest kind of
  detail and read as filler when every noun carries one. At most ONE such code in the whole
  world, on the object the collapse turns on.
- events: 5 in date order (6 only if the chain of cause needs it). date (max 20) is in the world's own calendar: the data
  carries a `calendar` style to use, with numbers of your own. fact (max 120): one flat past-tense sentence naming a person and
  carrying a number. Events form a chain of cause: each makes the next one possible. If a
  fact could be moved to another world unchanged, make it specific.
- authors: exactly 3 of the people, the ones who wrote things down. document is the physical
  thing they write in. register (max 110) is three or four observable habits: what they
  count, how long their sentences run, a verbal habit. never (max 56) is what they would not write.
  The three must differ sharply in sentence length and in what they count: a quartermaster
  counts stock, a child counts days, an engineer counts readings. At most one of them is sad.
  At most ONE document is a log, ledger, register, form or report with dated entries, and
  a world with none at all is welcome. At least ONE author is not writing for the
  institution in any sense: a child's letters, a verse painted on a wall, a bet chalked on a
  slate, a recipe with remarks, words somebody said that somebody else took down. The data
  carries two `documentKinds`. Each is a CATEGORY, a colon, then worn examples of it: those
  two categories are the other two documents, and the examples are spent. Write a fourth
  example of each category in this world's own nouns, with whose it is and what it is kept in;
  re-using an example's words is rejected by the checker.
  Places like this one are mostly remembered through what people wrote to each other and
  on things, and hardly at all through their paperwork.
  At least one author writes to somebody: a person with a name who is expected to answer.
  At most one author opens entries with a date or a time; the others date nothing, or date
  things the way people do ("the Friday after", "12 sleeps to my birthday").
- enemies: the cast of this world: 4 or 5 registry enemy ids, guardian included, chosen so
  the way each kind fights suits its job. formerJob (max 48) says what those creatures were
  before the collapse: a group of workers in the plural with their place ("Deck 4 loaders"),
  never a named individual, because the crew meets many of each kind. The guardian is the person responsible,
  or the machine they left running. Rooms and floors written later use only this cast.

## title, tagline
- title (max 40, aim 28, four words at most): the name the inhabitants painted on the
  door. A place name, or facility type plus a number or proper noun. No "of the", no
  abstract nouns. "Halloran Deep". "Pump Station Six".
- tagline (hard max 80, aim 60): eleven words at most, counted. What it was, and the one
  number that shows the damage. Pick the SHAPE that suits this world and do not write the
  same shape every time; three clipped fragments with a count in the middle is one shape
  among several and is worn out:
    a sentence:      "Pump 6 ran at 140% for 19 days. Then Deck 4 flooded."
    a label and a count: "Seabed pump station. 260 on the roster, 48 accounted for."
    one fact only:   "Nine days of coolant for a station that needed nineteen."
    somebody's words: "Sele signed for 212 frames and kept the receipts."
  A twelfth word is a fact you should have dropped.
