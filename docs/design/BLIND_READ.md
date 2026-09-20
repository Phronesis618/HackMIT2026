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

## Result, second read (run `v1-after`, after those fixes)

Four more worlds from the same four idea sets, ten new samples of ours, the same ten shipped
lines, a new shuffle, a new sub-agent with no context.

| | Ours (10) | Shipped games (10) |
| --- | --- | --- |
| Called AI | **7** | 1 |
| Called HUMAN | 3 | 9 |

**Detection against our text went from 1 of 10 to 7 of 10, and the honest reading is that the
instrument changed, not that the text got worse.** The first detector called five of ten
shipped lines machine-written; the second called one. A reader that can tell DCSS from a model
is a harder reader, and it found things in our text that the first one missed. Reporting the
two numbers as a before-and-after would be dishonest: they are two different readers, on two
different sets of our samples, at n=10 each.

What matters is that the second reader's reasons are specific, repeatable, and about things we
really do. Four of them are now fixed:

1. **Every world tagline is the same three beats.** Sample 3, *"Palliative orbit ship. 240
   patients. Every crate held saline."* — "templated three-beat build (setting, count, ironic
   detail)". All four taglines in the run are exactly that: "Four districts of arrears. 44 forms
   jammed. 11 staff lost to one open valve." / "Queen-cell supplier. One stolen canister. 31 of
   34 handlers unaccounted for." / "Bouncy castle plant. Dalgaard vented 14 chambers. 23 workers
   trapped inside." `prompts/runtime/foundation.md` now offers four different shapes and says
   the three-fragment one is worn out.
2. **Invented reference codes standing in for detail.** Samples 10 and 11, *"vinyl roll #338 on
   Shift 40-A"* and *"serial B-004, stamped Day 391"* — "fabricated hyper-specific numbers and
   codes standing in for real detail rather than growing out of it". True: the run produced
   Shift 41-C, manifest 88-C, lot 44, form QC-7, roll #338, tag B-004. `foundation.md` now
   allows one such code per world, on the object the collapse turns on, and says a number is
   something a person counted, measured or was issued.
3. **The thermos.** Sample 17, *"The loading crew's break room. A thermos and one undamaged
   headset remain on the bench."* — "the tidy show-don't-tell move deployed a beat too cleanly".
   Three of the four worlds left a thermos in their rest room and the fourth left a cold mug.
   `stock-prop` in `src/server/generation/stages.ts` rejects the stock furniture of an empty
   room, and `brief-rules.md` asks for an object the work in that room would have left.
4. **A law's second sentence that is an image, not an instruction.** Sample 19, *"Abara ran
   every stamp with full weight: one deliberate stroke per frame."* — "imagery that doesn't
   quite parse, assembled for tone over sense". `laws.md` now requires a verb the player can
   act on in that sentence and quotes this line as the failure case.

Not fixed, and argued with: sample 5, *"44 forms in the drum. The service request has no
technician assigned"*, was called "register-mixing that doesn't cohere". It is a tax office
whose photocopier caught fire; a service request with no technician assigned is exactly what
that world contains. Sample 2's "counter rig" is a fair hit on a compound noun the world
shortened past the point of sense, and is not separately fixed: the `cut-short` and word-budget
work is what pushes writers toward shortening, so this one is watched rather than ruled on.

**These four fixes are unverified against the model.** The brief allowed eight live world
generations and all eight are spent (four in `v1-before`, four in `v1-after`, about $2.70 at
Sonnet list price). They cannot make the score worse — three of them only remove options — but
whether they work is the first thing the next live run should look at.

## Truncation, measured

The fault `docs/design/WORLDGEN_EVAL.md` called "the biggest tell, and it is ours": the model
wrote past a limit and trusted code cut the sentence.

| | Previous run (W2b, 8 worlds) | `v1-before` (4) | `v1-after` (4) |
| --- | --- | --- | --- |
| Biome taglines written over 80 characters | 56 of 64 | **0 of 32** | **0 of 32** |
| Biome room lines written over their limit | 407 of 448 | **0 of 221** | 1 of 218 |
| All other fields over their limit | not measured | 1 of 75 | 4 of 76 |
| **Lines cut by trusted code that reached the player** | 56+ | **0** | **0** |

Measured from the eval script's raw captures with
`scripts`-adjacent analysis over `/tmp/relay-eval/<run>/raw-*.jsonl`: a shipped line counts as
cut when it is a strict prefix of something the model wrote. The earlier run's numbers were
taken against the limits the schema advertised at the time, so the columns are not exactly
comparable; the last row is, and it is the one that matters. Mean biome tagline length is now
52 characters against a limit of 80, and mean room line 89 against 140.

Two mechanisms, both needed: the prompts now give a counted word budget per text type rather
than a character limit the model was measured ignoring, and every cut trusted code does make is
recorded and sent back to the writer as a `cut-short` failure instead of being shipped.

## Residual tells, honestly

- **Ours are all one voice underneath.** Every world is an institution with staff, shifts,
  forms and a count that went wrong. That is the house style working exactly as `WRITING.md`
  designed it, and it is also why four worlds from four very different idea sets read as
  siblings. A world with no paperwork in it at all has not been generated yet.
- **"GET BEHIND THE X."** The boss tells no longer repeat the engine's words, but four of
  twelve in `v1-after` are "GET BEHIND THE <world noun>". The formula moved; it did not go.
- **Rest rooms are still quiet rooms with one object in them**, even with the thermos gone.
  The shape of the observation is the tell, not the object.
- **Two authors in three still keep something dated.** `foundation.md` allows one log; letters,
  stickers, quizzes and to-do lists do appear, but a form or a tally is the default reach.
- **The detector is a model.** None of this says a person would be fooled, and the one thing
  every human reader of this project has said about the text — that it is relentlessly
  specific — is not something either detector commented on.
