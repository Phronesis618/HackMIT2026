# Blind read, 20 Sept 2026 (agent V1)

Can a reader who knows nothing about this project tell our generated world text from text a
professional game writer shipped? This file records the test, the result, what it found, what
was changed, and what still gives us away. It is the companion to
`docs/design/WORLDGEN_EVAL.md`, which measures the pipeline; this one measures the prose.

## Method

1. Four live worlds generated with `scripts/eval-worldgen.ts` against `claude-sonnet-4-6`,
   floors on, idea sets 0, 1, 2 and 4 (silly, dark, mundane, one word). Run `v1-before`.
2. Twenty unlabelled samples of 15 words or fewer were assembled: ten taken from those four
   worlds across the text types a player actually reads (world tagline, biome tagline, room
   line, law description, attunement description, remains fragment, boss callout), and ten
   real excerpts from shipped games, fetched verbatim from the sources listed below.
3. A fresh sub-agent with **no** access to this repository, this brief or any of these docs
   was given the twenty in one shuffled list and asked to label each HUMAN or AI with a
   one-line reason, then to name any pattern it saw recurring in the ones it called AI.
4. Every reason that was both correct and specific counts as a defect, and was fixed at the
   layer that caused it (prompt, exemplar, validator, pipeline).
5. Four more worlds were generated after the fixes and the read was repeated.

The real excerpts are for comparison only. They are quoted here under 15 words each, with
attribution, and no line of them is or ever becomes RELAY content.

**Honest limits of this test.** Twenty samples is a small sample. Our text is sci-fi
industrial and the comparison text is mostly fantasy, so a detector could sort on subject
matter rather than on writing; the detector's stated reasons, not its score, are what the
fixes were drawn from. And one model is judging another model's output, which is not the same
as a person doing it.

## Sources of the human excerpts

- Dungeon Crawl Stone Soup, `crawl-ref/source/dat/descript/{monsters,items,features}.txt`
  (https://github.com/crawl/crawl), monster, item and dungeon-feature descriptions.
- Magic: The Gathering, *The Brothers' War*, card flavour text via the Scryfall API
  (https://api.scryfall.com).

Dark Souls and Slay the Spire were in the study but their wikis refuse automated fetches
(HTTP 402), which `docs/WRITING.md` section 9 already records.
