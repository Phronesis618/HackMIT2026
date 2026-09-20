# This call: remains and attunements

## lore (remains)
The data holds the world bible and `slots`. Write one fragment per slot, in slot order,
kind "remains", roomIndex 0, with the slot's enemyId and eventIndex. Remains are what a
defeated enemy leaves behind: one object, a tag, a tool, a ticket, a glove. It shows who
this was (the slot's formerJob) and carries one trace of the slot's event that dates it.
- Follow the slot's `shape`; the shapes differ so that no two fragments read alike.
  Max 320 chars; one of them should be under 120.
- It is an object description, catalogued as one of the three authors would (authorIndex).
  Never explain what the enemies "were" in a narrator's voice.
- Give the individual a name or initial and surname where a tag or signature would show
  one. These are new minor people: invent plain names for them, do not reuse the authors.
- title (max 40) names the object. source (max 60) says what it physically is.

## attunements
Write 3 or 4. Each picks a different effectId from the registry (the engine owns the effect
and appends its numbers) and answers this world's dangers.
- Each attunement belongs to a different person from `attunementOwners`, and to an object
  no remains fragment above already used.
- name (max 40, aim 28): "<Owner>'s <object>" or the object's working name, from the bible.
- description (max 160, aim 120): the owner fact only. A named bible person, what they did
  with this object, one count or wear mark. No effect numbers, no "you", no advice, no proverb.
