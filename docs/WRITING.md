# RELAY house style

Every string a player reads follows this document: static strings typed by us, and world text written by the model at runtime. `src/shared/prose.ts` enforces it. `prompts/exemplars/` shows it.

The complaint this answers: the generated text was vague and metaphorical, many words with little behind them. The cure is the same one good game writers already use. Put a fact in every sentence, and know the world before writing about it.

Contents: [1 Core rules](#1-core-rules) · [2 World bible](#2-the-world-bible) · [3 Three authors](#3-three-in-world-authors) · [4 Worked example](#4-worked-example-halloran-deep) · [5 Text types](#5-text-types) · [6 What the research says](#6-what-the-research-says) · [7 Getting a model to comply](#7-getting-a-model-to-comply) · [8 Checks the linter cannot do](#8-checks-the-linter-cannot-do) · [9 Sources](#9-sources)

Example blocks in this file are machine-read by `tests/shared/prose.test.ts`. Keep the header line format `DO · kind=…` and `DON'T · kind=… · rule=…` followed by one `>` line.

## 1 Core rules

1. **Name the thing.** Each sentence has a physical noun doing a physical thing. "Steam from a split pipe crosses the floor", never "danger fills the air".
2. **Give a fact the player can use or check.** A count, a location, a weakness, who owned it, what it did. If the player cannot act on the sentence or verify it against another fragment, cut it.
3. **Reach for numbers, names, dates, materials and jobs.** "212 frames issued on Day 20" does more than any adjective. Names come from the world bible, never from the top of the model's head.
4. **Effect first, then one owner fact.** Items, boons and skills say what they do in game terms, then one flat fact about who had it. One fact. The Souls games work this way: the description tells you the use, then a line such as "The Undead treasure these dull green flasks" (Dark Souls, Estus Flask).
5. **Rooms: what is visible from the door, threat first.** Third person, present tense, under 100 characters. Stop where the player can act.
6. **Never state the player's feelings, thoughts or actions.** No "you feel", "you sense", "as you enter". The Alexandrian calls this remote-control text. Describe the object and let the player react.
7. **One idea per line, said once.** No setting a thing up to deny it ("it was never a lamp, it was an argument"). No restating the sentence in a trailing "-ing" clause.
8. **Plain verbs.** "Is" is a good word. Things are, hold, leak, cost, weigh. They do not "stand as", "serve as", whisper, hum, thrum, echo or dance.
9. **End on a fact.** No closing moral, no short abstract last line ("The sea remembers."). If the last sentence would fit any other world, delete it.
10. **Only people have minds.** The sea does not remember and the tower does not decide. A named person decided; say who. (A literal machine intelligence in the bible counts as a person. Name it.)
11. **One author, one event.** Every lore fragment is written by one of the world's three authors about one event in the bible. The author's job decides the vocabulary.
12. **Humour is allowed and it is dry.** It comes from a working person's irritation or understatement, as in DCSS: "A prank scroll that creates a loud noise when read." Never from winking at the player.

Words that carry no information here and are banned by the linter's lists: ancient, forgotten, mysterious, eerie, ethereal, whispers, echoes, shadows used as mood, anything "of the deep / of sorrow / of ages". Lists live in `src/shared/prose-data.ts`. Do not paste them into prompts (see section 7).

## 2 The world bible

Structured data, written first, never shown to players. All player-facing text is derived from it. This follows Caves of Qud's history generator: events are resolved as state first and narrated afterwards, and each text snippet reports a single event (Grinblat and Bucklew 2017). Players find the snippets in any order and assemble the story themselves.

A bible holds exactly this:

| Part | Count | Form |
| --- | --- | --- |
| `premise` | 1 | One flat sentence: what this place was for. |
| `collapse` | 1 | One cause, with a person, a decision and a date. No mystery forces. |
| `people` | 3 to 4 | `name`, `job`, `want` (a concrete want: a transfer, a balanced count, a letter back). |
| `places` and `objects` | 4 to 6 | Named, physical, reusable: "Pump 6", "Stores Cage B", "Tarn's red wrench". |
| `events` | 5 to 7 | `id`, `date`, one flat declarative sentence with a number in it. |
| `authors` | 3 | See section 3. |
| `enemies` | one per enemy kind used | What job that creature did before the collapse. |

Rules for the bible itself: flat declaratives, past tense, no adjectives of mood, every event has a date and at least one name. If an event could be moved to another world without edits, it is too generic.

## 3 Three in-world authors

Each world has three people who wrote things down, each in a fixed register tied to their job. Every relic is BY one author ABOUT one event. Remains are written by whichever author would have handled that body or that equipment. This is what makes eight biomes read as one story, and it is how Magic kept character voices apart: on the Weatherlight set "each crew member was assigned to a different writer" (Rosewater 2002).

An author entry has: `name`, `job`, `document` (the physical thing they write in), `register` (three or four observable habits), `never` (what this person would not write).

Choose registers that differ in sentence length and in what they count. A quartermaster counts stock. A child counts days until something. An engineer counts readings. Avoid three melancholy diarists.

## 4 Worked example: Halloran Deep

```json bible
{
  "title": "Halloran Deep",
  "premise": "A seabed pump station that sent coolant up to the relay at Port Anselm.",
  "collapse": "Director Marguerite Sele ran Pump 6 at 140% for 19 days to meet the coolant quota. The casing split on Day 19 at 03:40. The bulkheads sealed Deck 4 and Deck 5 with 212 crew below.",
  "people": [
    { "name": "Oda Brandt", "job": "quartermaster", "want": "a stores count that balances before the audit" },
    { "name": "Yusuf Tarn", "job": "pump engineer", "want": "Pump 6 shut down for a bearing change" },
    { "name": "Pim Okafor", "job": "cook's son, age 9", "want": "his Aunt Dessa in Port Anselm to send for him" },
    { "name": "Marguerite Sele", "job": "station director", "want": "the quota met so the station stays open" }
  ],
  "places": ["Pump 6", "Deck 4 Mess", "Brine Lock", "Stores Cage B", "Port Anselm"],
  "objects": ["quota board", "Tarn's red wrench", "maintenance frame", "gasket kit"],
  "events": [
    { "id": "E1", "date": "Day 1", "fact": "Sele posted the order to run Pump 6 at 140%." },
    { "id": "E2", "date": "Day 6", "fact": "Tarn filed fault 6-117, bearing temperature 96 C. Sele countersigned it 'noted'." },
    { "id": "E3", "date": "Day 11", "fact": "Brandt issued the last 40 gasket kits from Stores Cage B to Pump 6." },
    { "id": "E4", "date": "Day 14", "fact": "The cook moved the Deck 4 Mess kitchen up to Deck 2 because the floor was too hot to stand on." },
    { "id": "E5", "date": "Day 19, 03:40", "fact": "The Pump 6 casing split. Bulkheads sealed Deck 4 and Deck 5 with 212 crew below." },
    { "id": "E6", "date": "Day 20", "fact": "Sele ordered maintenance frames fitted to the sealed crew so pumping could continue. 212 frames were issued." },
    { "id": "E7", "date": "Day 31", "fact": "Brandt found all 212 frame receipts signed in Sele's handwriting." }
  ],
  "authors": [
    { "name": "Oda Brandt", "document": "stores ledger", "register": "Item, quantity, who signed. Short asides about people who sign badly. Counts everything.", "never": "describes a feeling, hers or anyone's" },
    { "name": "Pim Okafor", "document": "letters to Aunt Dessa", "register": "Dear Aunt Dessa. What he saw today, measured against things he knows: the soup pot, his own height. Asks for a reply by a date.", "never": "understands what is happening" },
    { "name": "Yusuf Tarn", "document": "Pump 6 fault log", "register": "Timestamp, reading, action taken. Fragments. Swears once per entry at most.", "never": "writes a sentence longer than 12 words" }
  ],
  "enemies": {
    "husk": "Deck 4 loaders in cargo frames",
    "sentinel": "bulkhead watch, posted at the sealed doors",
    "lurker": "Brine Lock divers",
    "guardian": "Director Sele, wired into the Pump 6 control frame"
  }
}
```

Notice what the bible does not contain: no adjectives of mood, no theme statement, no sentence the player will read. It is a list of things that happened. The three authors then each see a different slice. Brandt sees E3, E6, E7. Pim sees E4 and the boat that does not come. Tarn sees E2 and E5. Nobody narrates the whole, and no fragment explains the collapse outright. A player who reads Brandt's Day 31 entry after Tarn's fault 6-117 works it out unaided.

The examples in section 5 all draw on this bible.

## 5 Text types

Lengths are characters. "Limit" is the schema maximum in `src/shared/contracts.ts`; "target" is the house length, enforced as a warning.

### 5.1 World title

Purpose: a name the inhabitants would have painted on the door. Target 28, limit 40. Template: `<Place name>` or `<Facility type> <number or proper noun>`. No "of the", no abstract nouns.

DON'T · kind=worldTitle · rule=slop-word
> Echoes of the Forgotten Deep

Fault: two mood words and no place. It could title any world.

DON'T · kind=worldTitle · rule=slop-word
> The Whispering Abyss

Fault: a personified abstraction as a name. Nobody paints this on a door.

DO · kind=worldTitle
> Halloran Deep

DO · kind=worldTitle
> Pump Station Six

### 5.2 World tagline

Purpose: on the world card, tell a player what kind of place this is and what went wrong, in facts. Target 70, limit 80. Template: `<what it was>. <one number that shows the damage>.`

DON'T · kind=tagline · rule=personified-abstraction
> A relay tower that forgot which world it was built for.

Fault (current `vantage-spire` fixture): towers do not forget. Pleasant sound, zero information.

DON'T · kind=tagline · rule=slop-word
> A living archive grows through the remains of a silent machine.

Fault (current `root-archive` fixture): "living", "silent", "remains" are mood. Which machine, how big, what did it do?

DO · kind=tagline
> Seabed pump station. 260 crew on the roster, 48 accounted for.

DO · kind=tagline
> Pump 6 ran at 140% for 19 days. Then Deck 4 flooded.

`themeSummary` follows the same rule at up to 160 characters: what the place was, what it is built from, what is dangerous underfoot.

### 5.3 Biome name and tagline

Purpose: on the door-choice screen, let the crew pick between two doors on information. Name: a place from the bible, target 28. Tagline: what is in there that matters to a fight or to the story, target 70.

DON'T · kind=biomeTagline · rule=stock-phrase
> Where the deep keeps its secrets.

Fault: stock phrase, and no reason to choose this door over the other.

DON'T · kind=biomeName · rule=slop-word
> Halls of Echoing Sorrow

Fault: an emotion as architecture.

DO · kind=biomeName
> Deck 4 Mess

DO · kind=biomeTagline
> Tables bolted down. Floor plates at 60 C. Loaders eat here.

DO · kind=biomeName
> Brine Lock

DO · kind=biomeTagline
> Two airlock doors and a rack for 30 dive tethers, 11 missing.

### 5.4 Room line

Purpose: the one line shown on entering a room. It is boxed text, so boxed-text rules apply: only what is perceived on entry, most important thing first, third person, stop where the player can act. Target 100 (the prompt may ask for 90), limit 300. Template: `<threat and where it is>. <one usable feature of the room>.`

DON'T · kind=roomLine · rule=stock-phrase
> The Guardian stands watch over the final crystal lens.

Fault (current `crystal-tide` fixture): "stands watch" is filler for "is here". Where is it standing? What is between it and the door?

DON'T · kind=roomLine · rule=no-player-feelings
> As you enter, you feel the weight of centuries pressing down on you.

Fault: moves the player, tells them their feelings, and describes nothing in the room.

DO · kind=roomLine
> Two loaders in cargo frames by the far hatch. Steam from a split pipe crosses the floor.

DO · kind=roomLine
> Watch frame on the gantry, facing the door. Crates on the left give cover.

### 5.5 Relic fragment

Purpose: a found document. BY one author, ABOUT one bible event, in that author's register. Target 120 to 400, limit 520. Must contain a bible proper noun and a number, date or object (the linter hard-fails otherwise). `title` (limit 40) labels the object: "Stores ledger, Day 11". `source` (limit 60) says what it physically is and where: "clipped to the door of Stores Cage B".

Template: `<date or heading in the author's format>. <the event as this author saw it, with their count>. <one aside only this author would make>.` End there.

DON'T · kind=relic · rule=no-ominous-closer
> Please return all records to the roots when finished. Do not water the terminals. Do not answer the terminals. The archive remembers what you forget to, and it has been getting very good at remembering.

Fault (current `root-archive` fixture): opens well, a notice with rules on it, then turns to the camera for a spooky last line. Archives do not remember. Cut the last sentence and put a date and a librarian's name on the notice.

DON'T · kind=relic · rule=not-x-but-y
> Wardens kept the crowds in line with these, one flash to hold, two to board. They kept doing it after the crowds were gone, and somewhere along the way the lamp stopped being a lamp and started being an argument.

Fault (current `vantage-spire` fixture): the first sentence is good, a real procedure with a real count. The last clause is a riddle with no answer. What did the warden do with the lamp? Say that.

DO · kind=relic
> Stores Cage B, Day 11. Issued to Pump 6: gasket kits, 40. Remaining: 0. Tarn signed with grease on the pen again. I asked the Director where the next 40 come from. She asked me to stop writing questions in the ledger.

DO · kind=relic
> Dear Aunt Dessa, Mum moved the kitchen up to Deck 2 because the mess floor burns your feet now. Mr Tarn let me hold his red wrench. It is heavier than the soup pot. Please write back before Day 20, that is when the boat comes.

### 5.6 Remains fragment

Purpose: what a defeated enemy leaves. States the creature's former job, flat, through an object. Target 80 to 320, limit 520. Hunter's Journal entries in Hollow Knight work the same way: one line of plain identification, then one remark from a person with a job (the Hunter). Template: `<the object, with a serial, size or wear mark>. <whose it was and what their job was>. <one bible fact that dates it>.`

DON'T · kind=remains · rule=no-ominous-closer
> Once a proud worker of the deep, now only a hollow shell. Its purpose is gone. Only the hunger endures.

Fault: no job, no name, no object. Three sentences that fit any enemy in any game.

DON'T · kind=remains · rule=not-x-but-y
> It was never a person. It was the observatory's own eye, the great lens given something to stand with, and it did not want to be blinded a second time.

Fault (current `crystal-tide` fixture): the denial opener, then a metaphor doing the work a fact should do. Who built it, when, from what?

DO · kind=remains
> Cargo frame 088. The collar tag reads H. Marsh, Deck 4, night shift. The right glove is worn through at the thumb from the pallet jack. Marsh signed for the frame on Day 20. The signature is in Sele's handwriting.

DO · kind=remains
> A dive tether, 30 metres, cut at 12. Brine Lock divers clipped on before every descent and called their depth back every 5 metres. This one stopped calling at 10.

### 5.7 Attunement or boon: name and description

Purpose: the world's own branch of the skill tree. The engine appends the mechanical summary in brackets (`skills.ts`), so the description must not restate or invent numbers for the effect. It supplies the owner fact that explains why this object gives this effect. Name: target 28, limit 40, form `<Owner>'s <object>` or the object's working name. Description: target 120, limit 160, must name a bible noun.

Hades boons are the model for the mechanical half: one sentence, game terms, such as "Your Attack emits chain-lightning when you damage a foe" (Lightning Strike). Ours splits that sentence off to the engine and keeps the owner fact.

DON'T · kind=boonDescription · rule=aphorism
> A record read and returned is a record that keeps you.

Fault (current `root-archive` fixture): a proverb. Whose record? Read where?

DON'T · kind=boonDescription · rule=no-player-feelings
> You know where the Focus was blinded once. Strike there.

Fault (current `crystal-tide` fixture): tells the player what they know. Say where the weak point is.

DON'T · kind=boonName · rule=slop-word
> Whisper of the Deep

DO · kind=boonName
> Tarn's Red Wrench

DO · kind=boonDescription
> Yusuf Tarn closed hot valves with it for 19 days. The jaws are scorched blue.

DO · kind=boonDescription
> Oda Brandt counted Stores Cage B twice a shift. Her count was never out by more than one gasket kit.

### 5.8 Item or consumable blurb

Purpose: tell the player what it does, then one owner fact. Target 140, limit 160. Template: `<effect with its number>. <where it came from, flat>.` Slay the Spire relics are the pattern: a rules line, then a single dry line of flavour.

DON'T · kind=itemBlurb · rule=stock-phrase
> A mysterious vial that pulses with ancient power, its purpose lost to time.

Fault: what does it do?

DON'T · kind=itemBlurb · rule=not-x-but-y
> This is not just a tool, but a promise of survival.

DO · kind=itemBlurb
> Restores 30 Integrity. Deck 2 kitchen issue. The label says onion; the contents disagree.

DO · kind=itemBlurb
> Your next dash leaves a 2 s steam trail. Tarn's spare valve, still holding pressure from Day 19.

### 5.9 Enemy name and blurb

Purpose: identify the threat and how it behaves. Name: a job plus a place, target 24. Blurb: what it was, how it attacks, in that order, target 120. Roguelike monster text is the model: short identification, one behaviour, sometimes a joke (DCSS on the yak: "covered in shaggy yak hair").

DON'T · kind=enemyBlurb · rule=slop-word
> A twisted remnant of humanity, forever wandering the endless dark.

DON'T · kind=enemyBlurb · rule=copula-avoidance
> The frame stands as the last monument to the crew's sacrifice.

Fault: "stands as" plus an abstraction. Nothing about what it does to the player.

DO · kind=enemyName
> Deck 4 Loader

DO · kind=enemyBlurb
> Cargo frame, one of 212. Slow to turn. The lifting arm does the damage.

DO · kind=enemyBlurb
> Brine Lock diver. Comes up through floor grates behind the last operative in line.

### 5.10 Boss name and phase callouts

Purpose: the name is a person or machine from the bible with their title. Callouts are telegraphs: they name the bible object that is about to hurt the crew and use a plain verb, in capitals, target 52, limit 60. FTL and Into the Breach event text is the model: state what is happening and what it threatens, then stop.

DON'T · kind=bossCallout · rule=personified-abstraction
> THE ABYSS HUNGERS

Fault: tells the crew nothing about where to stand.

DON'T · kind=bossCallout · rule=no-player-feelings
> YOU FEEL THE END APPROACHING

DO · kind=bossName
> Director Sele, Pump 6 Frame

DO · kind=bossCallout
> PUMP 6 SPINS UP. GET BEHIND THE CASING.

DO · kind=bossCallout
> BULKHEADS CLOSING IN 5

### 5.11 Skill-tree node

Purpose: the number that changes. Target 110. Template: `<ability> <stat> <old> → <new>` or `<trigger>: <effect with number>`. Names are two plain words. The existing tree already does this well; keep it that way.

DON'T · kind=skillNode · rule=slop-word
> Harness the ancient power of the relay to enhance your resilience.

DON'T · kind=skillNode · rule=stock-phrase
> Your strikes become a symphony of destruction.

DO · kind=skillNode
> Dash cooldown −25%; invulnerability window +50 ms.

DO · kind=skillNode
> Shockwave radius 135 → 180; stun +0.5 s.

### 5.12 UI label and tooltip

Purpose: say what the control does or what the game is waiting for. Verb first. Sentence case. No exclamation marks. Target 60.

DON'T · kind=uiLabel · rule=slop-word
> Embark on your journey into the unknown depths!

DON'T · kind=uiLabel · rule=no-player-feelings
> You feel ready. Step through when your heart tells you.

DO · kind=uiLabel
> Hold F to plant the Anchor.

DO · kind=uiLabel
> Waiting for the host to pick a door.

### 5.13 Receipt line

Purpose: show each contributor exactly what their idea became. Honest and literal: name the person, quote the idea, name the feature. Never claim a feature that was not built. Target 140.

DON'T · kind=receiptLine · rule=stock-phrase
> Your imagination has been woven into the very fabric of this world.

DON'T · kind=receiptLine · rule=slop-word
> Jon's vision echoes through every corridor of this realm.

DO · kind=receiptLine
> Jon's idea "flooded kitchen" became the Deck 4 Mess: hot floor plates and two loaders.

DO · kind=receiptLine
> Priya's idea "a kid's letters" became 3 relics signed Pim Okafor.

### 5.14 Debrief and memory line

Purpose: record what happened in the run, from real events only. Counts and names. No consolation and no moral. Target 120.

DON'T · kind=debriefLine · rule=slop-word
> Though you fell, your story echoes on.

DON'T · kind=debriefLine · rule=not-x-but-y
> It was not a defeat, but a lesson.

DO · kind=debriefLine
> Reached Deck 4 Mess. Downed twice, both times by loaders. Read 5 of 7 relics.

DO · kind=debriefLine
> Carried out: Tarn's red wrench. Jon revived Priya 3 times on Deck 4.

### 5.15 Hub NPC line

Purpose: the quartermaster reacts to the last run. One speaker with one register: counts things, gives one usable tip, is mildly put out. Keyed to real run events only. Target 110. Second person is fine here because a person is talking to the player; feelings are still off limits.

DON'T · kind=npcLine · rule=aphorism
> Every ending is a new beginning, operative.

DON'T · kind=npcLine · rule=hedge
> Something about this place seems to remember you.

DO · kind=npcLine
> Loaders got you twice on Deck 4. They turn slowly. Stand behind the arm.

DO · kind=npcLine
> You brought back Tarn's wrench. It's hung by the door. Don't touch it, it's inventory.

## 6 What the research says

**What reads as machine-written.** Wikipedia's field guide lists the stock vocabulary (tapestry, testament, intricate, enduring, vibrant), negative parallelism ("not X, but Y"), the rule of three, trailing "-ing" clauses that assert significance, and avoidance of plain "is" in favour of "serves as" or "stands as". The EQ-Bench slop score weights 60% slop words, 25% not-x-but-y patterns and 15% slop trigrams, with lists built by comparing model output against human baselines; the Antislop paper measures "Elara" at 85,513 times its human frequency. The fiction lists are dominated by body-language filler (nodded, gaze, whispered), light effects (flickered, shimmering, glow) and sound effects (echoed, hummed). Nous Research's ANTI-SLOP adds structural tells: symmetry, lists of exactly three, hedging, and the test "could this sentence be about any other topic?"

**How the good human text is built.**

- *Souls item descriptions*: use first, then one fact about an owner or a place. The lore is spread over many objects and none of them explains the whole.
- *Boxed text* (The Alexandrian; Shawn Merwin on D&D Beyond; Bryce Lynch): only what "anyone walking into the room would immediately perceive"; never the characters' "feels, movements, actions, or reactions"; third person; Merwin's model opening is "four sentences, and less than 100 words"; Lynch wants "terse but evocative" and read-aloud kept very short because attention goes after two or three sentences.
- *Magic flavour text* (Rosewater): "a big idea conveyed in as few words as possible", and one writer per character so voices stay apart. Rosewater also recommends the rule of three and alliteration. We do not follow him there: in model output the triad is the default rhythm, so it reads as a tell.
- *Caves of Qud* (Grinblat and Bucklew): events resolved as state, then one snippet per event, encountered "in any order"; the player's pattern-finding supplies the causality. Their sample gospels are full of numbers, place names and odd specifics: a sultan crowned at 6 years old over a stained-glass ordinance.
- *Roguelike descriptions* (DCSS, NetHack, Brogue): one or two sentences, identification then behaviour, jokes through flat statement.
- *Hades, Slay the Spire, Dead Cells*: the rules sentence uses game terms and numbers only; flavour is a separate single line and is often a joke.
- *Emily Short on procedural text*: generated text feels empty when it is not tied to world state. The work is "selecting and ordering information", which requires having information.

The common factor: each of these writers knew a fact and wrote it down briefly. None of them tried to sound atmospheric. Atmosphere comes from the facts chosen.

## 7 Getting a model to comply

Findings, and what W2 should do with them:

1. **Ban lists belong in the validator.** The Antislop authors note that telling a model to avoid a vocabulary "has limited efficacy and may induce a backfire effect" (the pink elephant problem). One production write-up puts prompt-only compliance near 80% and fixes the rest with a validator and a bounded retry. So the prompt carries positive rules and examples; `prose.ts` carries the lists; the repair loop passes back only the specific `advice` lines for what failed.
2. **Exemplars help, more exemplars do not.** Wang et al. (arXiv 2509.14543) found that writing samples beat zero-shot by a wide margin, that going from 2 to 10 samples changed the metrics "very little", and that outputs were still usually detectable as machine text. This corrects the plan's assumption that volume of seed text is the main lever. Inject 3 to 4 exemplars of the type being written, rotate them per request so no single rhythm is copied, and prefer exemplars from a world unlike the one being generated. The exemplar bank is large so that rotation is possible, and for no other reason.
3. **Most of the gain is structural.** The bible-first, author-per-fragment pipeline removes the cause of vagueness: a model asked for "a mysterious log" has nothing to say, so it produces mood. A model asked for "Brandt's ledger entry for E3, Day 11, 40 gasket kits" has facts to transcribe. Generate the bible in call one, lint nothing there except names. Generate text in call two, one brief per fragment: author, event id, object it is written on, target length.
4. **Remove the instructions that ask for the bad style.** The current prompt asks for "prayers, last words", fragments "in the voice of whoever left it" with no named author, and says lore should let players reconstruct events "without any fragment stating it outright". The model reads that as a request for riddles. Replace with: each fragment reports one event plainly; the mystery comes from the player holding only some of the fragments.
5. **Keep repair feedback short.** `formatRepairFeedback` returns at most four lines, hard failures first. Ship the lower-scoring attempt if the retry also fails.

## 8 Checks the linter cannot do

Read the text once and ask:

- Could this sentence appear unchanged in a different world? Then it is filler.
- What can the player do, or work out, after reading it that they could not before?
- Can you tell which of the three authors wrote it without the byline?
- Do two fragments contradict each other on a count or a date? (Check against the bible.)
- Read six fragments in a row. Do they share an opening move or a closing move? Vary them.

## 9 Sources

- Wikipedia, "Signs of AI writing": https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- EQ-Bench slop score: https://eqbench.com/slop-score.html
- Paech et al., "Antislop", arXiv 2510.15061: https://arxiv.org/abs/2510.15061 and lists (Apache-2.0): https://github.com/sam-paech/antislop-sampler
- Nous Research, ANTI-SLOP.md: https://github.com/NousResearch/autonovel/blob/master/ANTI-SLOP.md
- Wang et al., "Catch Me If You Can? Not Yet", arXiv 2509.14543: https://arxiv.org/abs/2509.14543
- Ozigi, banned-lexicon validator write-up: https://ozigi.app/blog/stopping-ai-slop-in-production-banned-lexicon-validator
- Justin Alexander, "GM Don't List #13: Boxed Text Pitfalls": https://thealexandrian.net/wordpress/48312/roleplaying-games/gm-dont-list-13-boxed-text-pitfalls
- Justin Alexander, "The Art of the Key, Part 2": https://thealexandrian.net/wordpress/35206/roleplaying-games/the-art-of-the-key-part-2-the-essential-key
- Shawn Merwin, "Let's Design an Adventure: Boxed Text": https://www.dndbeyond.com/posts/625-lets-design-an-adventure-boxed-text
- Bryce Lynch, review standards: https://tenfootpole.org/ironspike/?page_id=1201
- Mark Rosewater, "The Write Stuff": https://magic.wizards.com/en/news/making-magic/write-stuff-2002-03-18
- Grinblat and Bucklew, "Subverting Historical Cause and Effect: Generation of Mythic Biographies in Caves of Qud", FDG 2017: https://www.freeholdgames.com/papers/Generation_of_mythic_biographies_in_Cavesofqud.pdf
- Emily Short, "Procedural Text Generation in IF": https://emshort.blog/2014/11/18/procedural-text-generation-in-if/
- DCSS description files (quoted lines): https://github.com/crawl/crawl/tree/master/crawl-ref/source/dat/descript
- Dark Souls storytelling notes: https://mrpuddins.wixsite.com/koboldstew/post/inspirations-v-dark-souls-and-story-telling and https://lokeysouls.com/2020/11/16/environmental-storytelling/

Game lines quoted above are under 15 words each and attributed in place. The Estus Flask and Lightning Strike lines are quoted from memory of the games; the fan wikis refused automated fetches during research, so check them before reusing the quotes elsewhere.
