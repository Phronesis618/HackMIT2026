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

## Result, first read (run `v1-before`)

| | Ours (10) | Shipped games (10) |
| --- | --- | --- |
| Called AI | **1** | 5 |
| Called HUMAN | 9 | 5 |

**Detection rate against our text: 1 of 10.** The detector was worse than a coin on the real
text, calling half of the DCSS and Magic lines machine-written, so the honest reading of this
table is not "we passed": it is that this detector sorts on register rather than on origin,
and liked the flat industrial voice of both our text and the two real log-shaped lines it saw.
The number that matters is the single correct catch and its reason.

### The one correct reason, and what it cost us

> 19. AI — Ungrammatical compression ("left on Week 31 Monday") suggests template variables
> stitched together rather than natural phrasing.

It was right. The sample was a law description: *"The Cold Store's backup lighting failed
after the holiday staff left on Week 31 Monday."* The bible stores a world's dates in a seeded
calendar style, and writers were reusing the stored form inside running sentences, where a
person would say "on the Monday the holiday staff left". As a heading on a form the stored
form is correct, which is why nothing had caught it.

Fixed at two layers: `stitched-date` in `src/server/generation/stages.ts` rejects the pattern
after a preposition, where it can only be inside a sentence; `prompts/runtime/common.md` rule 3
now separates the heading date from the spoken date.

The detector's five recurring "patterns" all describe lines from the shipped games, not ours:
the "despite being X" bestiary frame, the quotable epigram, the triad ending in abstract
virtues, Latinate false authority. That is a useful negative result: the tells the catalogues
warn about are the ones our linter already hard-fails, and the remaining risk is elsewhere.

## What the same run found by ordinary reading, which the detector did not

Reading the four worlds side by side before the blind read found three faults worth more than
the detector's score, all of them the prompt's own words coming back as the world's:

1. **The example sentence in `laws.md` was copied almost verbatim in three of four worlds**
   ("Fewer of them per room, and each one takes much more killing"). An example of a law
   description written for a specific registry law will be copied whenever that law is picked.
   The prompt now describes what the sentence must do and says to use the world's own nouns.
2. **`brief-rules.md` listed "what is underfoot" as one of the seven room-line openings**, and
   two worlds opened a room line on the literal word "Underfoot". The list is now categories.
3. **Three of four bosses shouted the pattern registry's own counter line** ("DASH THROUGH THE
   GAP", "STEP OFF THE MARK"), which is correct advice in identical words across every world.
   `stock-callout` now rejects it. The rule failed all three authored fixture worlds on its
   first run, which is the evidence for it.
