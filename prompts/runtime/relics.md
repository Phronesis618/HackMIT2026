# This call: relics

The data holds the world bible and a list of `slots`. Write exactly one lore fragment per
slot, in slot order, each with kind "relic", enemyId null and the slot's roomIndex.

A relic is something a person wrote and left: a letter, a verse, a chalked bet, a label,
a note on a machine, and only sometimes an entry in a log. It is BY one of the three bible authors ABOUT one bible
event, in that author's register, on that author's document. Each slot fixes the
authorIndex and the eventIndex: copy them. Together the slots cover the whole chain of
events in three voices. An author who was not there when the event happened reports how it
reached them: a form that crossed their desk, a noise through the floor, a count that came
out wrong the next morning. If the event is something this author would never write about
(see their `never`), they write what they themselves did that day, and the event shows only
as a trace in it: a name missing from the list, a delivery that did not come.
- The author reports the event plainly as they saw it, with their own count. The author
  knows only their slice and never explains the collapse; the player holds other fragments.
- Use the event's date, names and numbers exactly as the bible gives them.
- Add one detail only this person would notice or be annoyed by. End there, on a fact.
- Obey each author's `never`. A reader must be able to tell the three authors apart
  with the bylines removed: sentence length, what gets counted, how entries open.
- Each slot gives a `length`. Follow it: "short" is 1 or 2 sentences (under 140 characters,
  about 22 words), "medium" 3 or 4 sentences (about 250 characters, 40 words), "long" 6 to
  9 short sentences (480 characters at the very most, about 80 words). A fragment written
  past its length is cut by trusted code and ends mid-sentence, so stop early instead.
- Two fragments on the same event come from different authors and notice different things.
- No two fragments open the same way. If one opens on the date, the next opens on an
  object, a name, a quantity or mid-sentence in the task. A log keeper need not restate the
  date, heading and status in every entry: a found page often starts halfway down.
- What a fragment IS varies with who wrote it. A letter has somebody it is to and
  something it asks for. A verse rhymes and scans, roughly. A slate has names and what is
  owed. Graffiti is answered by a second hand. Only a log has a timestamp and quantities in
  a row, and at most a third of the fragments in this call may be shaped like that. The
  number a fragment must carry can be a child's count of sleeps as well as a reading.
- title (max 40): labels the object as the finder would: what it is and where it starts
  ("Letter to Mum, 12 sleeps", "The slate, bets"). Do not give every title a date.
- source (max 60, aim 45): what it physically is and where it lies, e.g. clipped to a named door.
- text (max 520): the fragment itself. Must contain a bible proper noun and a number or date.
