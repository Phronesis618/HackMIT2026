# This call: the foundation

Write the fields in schema order. The bible comes first because everything after it must
use its names. The bible is never shown to players; it is a list of things that happened.
Other writers are waiting on this call, so be brief: every field has a tight character
limit, and a flat short fact is worth more than a long one. `bible` is a JSON object
with nested lists, never a string.

## bible
- Take every idea literally and build it into the premise, the people, the places or the
  cast. A strange idea stays strange and is treated as routine by the people who worked
  there: if geese run quality control, the quality inspectors are geese, with names, a shift
  pattern and a line in the budget. No idea is quietly replaced by something more sensible.
- premise (max 120 chars): one flat sentence, what this place was for. A working place
  with a purpose, staff and a budget. Build it from the players' ideas.
- collapse (max 200): one cause. A named person did something on a date; give the number
  that went wrong and how many people were caught by it. No unknown forces. The data
  carries a `collapseKind`: build the cause on it unless the ideas clearly point elsewhere.
  Paperwork (a form nobody signed, an order countersigned unread) is the cause only if the
  collapseKind says so.
- people: 3 or 4. name, job (max 36), want (max 56). The want is small and concrete: a transfer, a count that
  balances, a letter answered. Names are ordinary, the kind found on a payroll: mix origins,
  given name plus surname; the data includes a `namePool` you may draw from when the ideas do
  not imply a culture. Include the person responsible for the collapse.
- places: 3 or 4, objects: 3 or 4 (max 28 chars each). Named, physical, reusable:
  a numbered machine, a room with a letter on the door, one person's marked tool. These are the nouns all later text reuses.
- events: 5 in date order (6 only if the chain of cause needs it). date (max 20) is in the world's own calendar: the data
  carries a `calendar` style to use, with numbers of your own. fact (max 120): one flat past-tense sentence naming a person and
  carrying a number. Events form a chain of cause: each makes the next one possible. If a
  fact could be moved to another world unchanged, make it specific.
- authors: exactly 3 of the people, the ones who wrote things down. document is the physical
  thing they write in. register (max 110) is three or four observable habits: what they
  count, how long their sentences run, a verbal habit. never (max 56) is what they would not write.
  The three must differ sharply in sentence length and in what they count: a quartermaster
  counts stock, a child counts days, an engineer counts readings. At most one of them is sad.
  At most ONE document is a log, ledger or register with dated entries. The data carries
  two `documentKinds`: those are the other two documents (adapt them to the place), so the
  world is read through letters, labels, notes to a colleague, a menu board, not three logs.
  At least one author writes to somebody: a person with a name who is expected to answer.
- enemies: the cast of this world: 4 or 5 registry enemy ids, guardian included, chosen so
  the way each kind fights suits its job. formerJob (max 48) says what those creatures were
  before the collapse: a group of workers in the plural with their place ("Deck 4 loaders"),
  never a named individual, because the crew meets many of each kind. The guardian is the person responsible,
  or the machine they left running. Rooms and floors written later use only this cast.

## title, tagline
- title (max 40, aim 28): the name the inhabitants painted on the door. A place name, or
  facility type plus a number or proper noun. No "of the", no abstract nouns.
- tagline (max 80, aim 60): what it was, then one number that shows the damage.
