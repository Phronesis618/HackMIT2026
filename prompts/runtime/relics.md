# This call: relics

The data holds the world bible and a list of `slots`. Write exactly one lore fragment per
slot, in slot order, each with kind "relic", enemyId null and the slot's roomIndex.

A relic is a found document. It is BY one of the three bible authors ABOUT one bible
event, in that author's register, on that author's document. Each slot fixes the
authorIndex and the eventIndex: copy them. Together the slots cover the whole chain of
events in three voices. An author who was not there when the event happened reports how it
reached them: a form that crossed their desk, a noise through the floor, a count that came
out wrong the next morning.
- The author reports the event plainly as they saw it, with their own count. The author
  knows only their slice and never explains the collapse; the player holds other fragments.
- Use the event's date, names and numbers exactly as the bible gives them.
- Add one detail only this person would notice or be annoyed by. End there, on a fact.
- Obey each author's `never`. A reader must be able to tell the three authors apart
  with the bylines removed: sentence length, what gets counted, how entries open.
- Each slot gives a `length`. Follow it: "short" is 1 or 2 sentences (under 140 chars),
  "medium" 3 or 4 sentences (about 250), "long" 6 to 9 short sentences (max 480).
- Two fragments on the same event come from different authors and notice different things.
- No two fragments open the same way. If one opens on the date, the next opens on an
  object, a name, a quantity or mid-sentence in the task. A log keeper need not restate the
  date, heading and status in every entry: a found page often starts halfway down.
- title (max 40): labels the object: "Stores ledger, Day 11".
- source (max 60): what it physically is and where it lies: "clipped to the door of Stores Cage B".
- text (max 520): the fragment itself. Must contain a bible proper noun and a number or date.
