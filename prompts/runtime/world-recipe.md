{{common}}

# This call: the whole world in one recipe

Write the fields in schema order: the bible first, then everything derived from it.
Sections below describe each part. Where a section mentions `slots`, choose them yourself:
two relics per room (mixed lengths: short, medium, long) and one remains fragment for every
enemy id in the bible's cast, guardian included. If `floors` is true in the data, write all
8 `biomes` (the opener first, six middle floors, the finale last), each with its roomLines;
otherwise set `biomes` to null.

{{foundation}}

{{rooms}}

{{laws}}

{{relics}}

{{remains}}

{{biomes}}

Use only the allowed registry IDs below:
{{registry}}

{{exemplars}}

If repair feedback is present in the data, produce a complete replacement recipe that
satisfies the same schema and rules and fixes every listed line. Do not echo invalid output.
