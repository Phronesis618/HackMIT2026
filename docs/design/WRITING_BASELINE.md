# Writing baseline, 20 Sept 2026

`src/shared/prose.ts` run over the three offline fixtures and every player-facing static string found in `src/`. This is the number to beat. Lower scores are better; a text fails on any hard issue or at score 30 and above.

## Headline numbers

| Corpus | Fields | Failing | Mean score |
| --- | --- | --- | --- |
| `crystal-tide.json`, prose fields (tagline, summary, room lines, lore, attunements) | 16 | 6 (38%) | 13.2 |
| `root-archive.json`, prose fields | 15 | 8 (53%) | 26.5 |
| `vantage-spire.json`, prose fields | 16 | 7 (44%) | 14.7 |
| All three fixtures, prose fields | 47 | 21 (45%) | 18.0 |
| Static strings outside fixtures (231 found, `registry.ts`, `skills.ts`, client UI, server messages) | 197 | 1 | about 1 |
| Exemplar bank (`prompts/exemplars`) | 75 | 0 | 1.7 |
| WRITING.md DO examples | 35 | 0 | under 5 |

Those fixture failures are measured WITHOUT a bible, because the fixtures have none. With the rule W2 will run live (`needs-bible-noun`), all 21 lore fragments and all 11 attunement descriptions fail, since:

- 0 of 21 lore fragments name a person. Every actor is a role or a collective: "the lens-keeper", "patrons", "wardens", "the last archivist".
- 3 of 21 lore fragments contain a digit. `root-archive` has none.
- 0 of 21 carry a date that can be matched to another fragment.

That is the vagueness the team lead described, in numbers. The fragments are well turned sentence by sentence; they have no facts in them, so a reader cannot join two of them together.

## Recurring faults, most frequent first

Counts are issues across the three fixtures.

| Rule | Count | Example from the fixtures |
| --- | --- | --- |
| `slop-word` | 14 | "Bioluminescent roots consume broken terminals … to the ancient archive core." · "a shard of switching core, humming" |
| `not-x-but-y` | 7 (5 hard) | "it is not filed under soil, it is filed as soil" · "the lamp stopped being a lamp and started being an argument" · "It was never a person. It was the observatory's own eye" · "is not routing passengers any more; it is routing itself" |
| `needs-specific` | 7 | "A record read and returned is a record that keeps you." · "The spire's core. The Guardian waits between the operatives and the Anchor site." |
| `personified-abstraction` | 6 | "The archive remembers what you forget to" · "a train the spire forgot to send" · "once the tower decides which world it is in" · "the roots learned to carry them" |
| `hedge` | 5 | "blinking, patient, as if it expects someone to board" · "Whatever it was showing the sea" · "the sea is still trying to show you something" |
| `aphorism` | 4 | "Every satchel recovered is a delivery the archive still owes you." · "What is planted here is read aloud, forever, to the roots." |
| `no-ominous-closer` | 3 | "…and it has been getting very good at remembering." · "…and why does my watch-partner answer in the wrong voice." |
| `trailing-ing` | 3 | "The flaps keep turning anyway, trying letters, settling on nothing, like a mouth practising a word." |
| `abstract-heavy` | 3 | "that is the whole of the arrangement, and it has never once been renegotiated" |
| `simile` | 2 | "like a mouth practising a word" · "moves like a crowd that hears its train" |
| `stock-phrase` | 1 | "The Guardian stands watch over the final crystal lens." |
| `no-player-feelings` | 1 | "You know where the Focus was blinded once." |

Pattern across all three: a fragment opens with a good concrete object (a tide gauge, a duty roster, a departures board), then its last sentence swerves into a riddle. The fix is mostly deletion plus a name and a number.

One structural fault the linter cannot see: every remains fragment in `root-archive` and `vantage-spire` opens by explaining the enemy in the narrator's voice ("The husks were patrons who…", "Lurkers were the couriers who…"). That is the game telling, in a field that should be a found object. WRITING.md 5.6 replaces it with object, owner, dated fact.

## Where the bad style comes from

`prompts/runtime/world-recipe.md` asks for it:

| Prompt text | Effect | Replace with |
| --- | --- | --- |
| "inscriptions, logs, graffiti, prayers, last words" | Prayers and last words have no facts in them by genre. | Three named authors with working documents (WRITING.md 3). |
| "in the voice of whoever left it" | No author is defined, so the voice defaults to wistful narrator. | `author` id per fragment, register from the bible. |
| "without any fragment stating it outright" | Read as a request for riddles. | Each fragment reports one event plainly; the puzzle is that the player holds only some fragments. |
| "a boon the place itself confers" | Invites personified places. | Owner fact: a named person and their object. |
| "make it reveal what that creature was before this world ended" | Produces narrator exposition. | The object, the owner's name and job, one dated bible fact. |
| No bible step at all | Nothing to be specific about. | Call 1 writes the bible. Call 2 writes text from briefs. |

## Static strings

Clean on the whole. The mechanical copy in `registry.ts` and `skills.ts` already follows the house style (numbers, plain verbs) and should be left alone apart from names. Items for W3:

| Priority | Where | Text | Problem | Suggested direction |
| --- | --- | --- | --- | --- |
| 1 | `client/ui/HeadquartersPanel.tsx` | "The sanctuary between worlds" | hard fail, `stock-phrase` | Say what the hub is for: "Headquarters. Pick a class, prepare a world, walk through the portal." |
| 2 | `client/ui/HeadquartersPanel.tsx` | "Bring an idea. Step through together. Keep what happened." | `triad`, three-beat slogan | Two beats or one sentence with a verb the player can do. |
| 3 | `client/ui/GameMenu.tsx` | "How each hostile fights is field knowledge. What it was before this world ended is only known from what it leaves behind." | `abstract-heavy`, mirrored pair | "Combat notes unlock on first kill. Defeat one and read its remains for the rest." |
| 4 | `client/ui/DebriefPanel.tsx` | "No memories from this world are stored on this device." | mild | "Nothing saved from this world yet." |
| 5 | `skills.ts` | "The operative's link to the relay. Everything grows from here." | second sentence is filler | "Root node. Costs nothing." |
| 6 | `skills.ts` names | "Bastion of Last Light", "Dawn Protocol", "Knotted Time", "Never Seen" | pass the linter, but are mood names beside plain ones like "Wider Sweep" | Optional: name by effect ("Last-Ditch Bulwark"). |
| 7 | `package.json`, README | "Worlds end. Your stories don't." | a "not X but Y" in spirit | Team call; it is the pitch line, so leave unless the lead wants it changed. |

25 strings run past the 60-character UI target; most are server diagnostics that players rarely see. Not a priority.

## Rewrite order for W2 and the fixture agent

1. Add the bible to the recipe schema and write it in a first call. Without it nothing below can work.
2. Rewrite the lore section of the prompt around author, event id and object. Drop "prayers, last words".
3. Attunement descriptions: owner fact only, must name a bible person. All 11 current ones fail this.
4. Room lines: threat first, then one feature. Current lines describe scenery ("Crystal shelves interrupt the violet shallows") and never mention what is in the room to fight.
5. Taglines and `themeSummary`: facility, number, what broke.
6. Fixtures: `root-archive` first (worst score, 53% failing), then `vantage-spire`, then `crystal-tide`. Keep the objects they already have, which are good (tide gauge, index card, left-luggage tag, departures board). Give each world three named authors and re-cut every fragment as author plus event.

## Reproducing

```ts
import { lintRecipeText } from '../src/shared/prose';
const r = lintRecipeText(JSON.parse(readFileSync('fixtures/worlds/root-archive.json', 'utf8')));
// r.score, r.failedFields, r.fields[i].result.issues, r.feedback
```

Static strings were pulled with a throwaway script: every string literal and JSX text node of three or more words starting with a capital, minus code-looking matches and internal error messages, linted as `skillNode` (shared registries) or `uiLabel` (client). The fixture text embedded in `src/server/generation/buildFixtures.ts` was excluded from the static count because the fixtures already cover it.
