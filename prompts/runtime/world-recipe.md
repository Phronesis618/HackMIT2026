{{common}}

# This call: the whole world in one recipe

Write the fields in schema order: the bible first, then everything derived from it.
Sections below describe each part. Where a section mentions `slots`, choose them yourself:
two relics per room (mixed lengths: short, medium, long) and one remains fragment for every
enemy id used in the rooms, guardian included. If `floors` is true in the data, write all
8 `biomes` (opener first, then tiers 1, 1, 2, 2, 3, 3, then the finale) with `biomeRoomLines`
for each; otherwise set both to null.

{{foundation}}

{{relics}}

{{remains}}

{{biomes}}

Use only the allowed registry IDs below:
{{registry}}

{{exemplars}}

If repair feedback is present in the data, produce a complete replacement recipe that
satisfies the same schema and rules and fixes every listed line. Do not echo invalid output.
