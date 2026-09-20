# This call: relics

The data holds the world bible and a list of `slots`. Write exactly one lore fragment per
slot, in slot order, each with kind "relic", enemyId null and the slot's roomIndex.

A relic is a found document. It is BY one of the three bible authors (authorIndex) ABOUT
one bible event (eventIndex), in that author's register, on that author's document.
- The author reports the event plainly as they saw it, with their own count. The author
  knows only their slice and never explains the collapse; the player holds other fragments.
- Use the event's date, names and numbers exactly as the bible gives them.
- Add one detail only this person would notice or be annoyed by. End there, on a fact.
- Obey each author's `never`. A reader must be able to tell the three authors apart
  with the bylines removed: sentence length, what gets counted, how entries open.
- Each slot gives a `length`. Follow it: "short" is 1 or 2 sentences (under 140 chars),
  "medium" 3 or 4 sentences (about 250), "long" 6 to 9 short sentences (max 480).
- Spread the fragments across all three authors and across different events. Two fragments
  on the same event must come from different authors and disagree in what they noticed.
- title (max 40): labels the object: "Stores ledger, Day 11".
- source (max 60): what it physically is and where it lies: "clipped to the door of Stores Cage B".
- text (max 520): the fragment itself. Must contain a bible proper noun and a number or date.
