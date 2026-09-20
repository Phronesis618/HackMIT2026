# This call: remains and attunements

## lore (remains)
The data holds the world bible and `slots`. Write one fragment per slot, in slot order,
kind "remains", roomIndex 0, with the slot's enemyId and eventIndex. Remains are what a
defeated enemy leaves behind: one object: a tool, a glove, a mug with a name scratched in, a lunch tin, a dart, a
hymn sheet. Fewer than half are tags, tickets, badges or anything else that was issued. It shows who
this was (the slot's formerJob) and carries one trace of the slot's event that dates it.
- Follow the slot's `shape`; the shapes differ so that no two fragments read alike.
  Max 320 chars; one of them should be under 120.
- It is an object description, catalogued as one of the three authors would (authorIndex).
  Never explain what the enemies "were" in a narrator's voice.
- Give the individual a name or initial and surname where a tag or signature would show
  one. These are new minor people: invent plain names for them. The name on the tag is
  NEVER one of the three authors, who are alive enough to be writing; use an author's name
  only for a note they wrote on the object, later in the fragment. Whatever name the title
  carries, the text carries the same one.
- title (max 40) names the object. source (max 60) says what it physically is.

## attunements
Write 3 or 4. Each picks a different effectId from the registry (the engine owns the effect
and appends its numbers) and answers this world's dangers.
- Each attunement belongs to a different person from `attunementOwners`, and to an object
  no remains fragment above already used.
- name (max 40, aim 28, four words at most): "<Owner>'s <object>" or the object's working
  name, from the bible.
- description (hard max 160, aim 110, twenty-two words at most, counted): the owner fact
  only, in one or two short sentences. A named bible person, what they did with this
  object, one count or wear mark. No effect numbers, no "you", no advice, no proverb.
