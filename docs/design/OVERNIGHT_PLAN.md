# RELAY overnight plan — final (v4)

**Status: approved and running.** Started Sun 03:15 ET · hard stop 10:00 ET · orchestrated from a Claude Code session (curious-droid).

> **PR #16 and how we work with it.** jonapplehe's Devin opened **PR #16** (40 files, +2 800): 4 terrain features (breakable walls, bridge+ramp crossings, slowing rubble, speed conduits), a 3-HP-phase Custodian ("charges, denser rings, recovery windows"), a three-relay Anchor ritual, and a 4-station walkable hub. It edits every hot file and is red on 6 stale tests.
> **Your call (v4): we still build tiles, boss, finale and hub ourselves, with the research behind them.** The way to do that without breaking Devin is **land #16 as the base, then build our versions on top of it** — extend its registries and sim hooks rather than fork them. Devin's PR bot **acts on comments from users with write access** (I have it), so that's the channel: I tell it which tests it may fix, what we're taking over afterwards, and which files are ours tonight.

---

## 1 · Priorities
1. 🔴 **Floors** — 5 biomes deep, 10→30 rooms, Isaac-style graphs, Dead-Cells-style biome choice, themed by the players' ideas.
2. 🔴 **Writing** — researched house style, linter, rewritten generation pipeline; text that reads as human.
3. 🟠 **UI** — right rail + bottom bar, audited from real screenshots.
4. 🟠 **"Now" list** — land PR #16 as the base, then **our researched second pass** on tiles, boss, finale, hub (§3c). Items: design doc + reserved hooks. Currency/shops: reserved hooks only (you tune in the morning).

## 2 · Ground truth from the repo
| Finding | Consequence |
| --- | --- |
| "3 rooms" is in the contracts (`index ≤ 2`, `rooms.max(3)`, `roomIndex ≤ 2`…): **39 files / 195 refs**, 19 of them tests. | Floors is a re-foundation; it owns shared files alone, and lands in stages behind a legacy adapter. |
| 100 rooms can't be model-authored (25 s timeout). | Model writes **biome briefs**; trusted seeded code builds graphs + geometry. |
| PR #16 rewrites the same hot files and is red on 6 stale tests. | Land it first (Wave 0). Split floors into **F1a (new files only — starts immediately)** and **F1b (contract integration — after #16 is on main)**. |
| Runtime prompt *asks* for the style you dislike ("shown, never told… prayers, last words"). Fixtures show it: "water does not look back", "the sea was learning", every fragment ends on an ominous turn. | Fix = prompt + exemplars + validator. Copy-editing alone won't change live output. |
| Chrome-extension screenshots time out on the game tab (Phaser rAF stalls when unfocused). Playwright 1.61 resolves via npx. | Agents see the game through a headless screenshot script; several can look at once. |

## 3 · Research → design

### 3a · Floors
**Isaac** ([Boris the Brave](https://www.boristhebrave.com/2020/09/12/dungeon-generation-in-binding-of-isaac/)) — BFS from grid centre; reject a neighbour if *occupied · already has >1 filled neighbour · budget reached · 50 % coin-flip*. Non-expanding cells are **dead ends**; **boss = farthest dead end**, other specials = random dead ends; **regenerate if validation fails**; maps >16 rooms re-seed from start periodically. No loops.
**Dead Cells** ([Bénard, "a hybrid approach"](https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/)) — fixed biome map → handcrafted tiles **tagged by purpose + door count, never shared across biomes** → per-biome **concept graph** (length, special count, how labyrinthine, entrance→exit distance) → constraint-checked assembly → enemies by **density ratio + compatibility**.

**Design**
- Run = **5 biomes deep**: 10 / 15 / 20 / 25 / 30 rooms. After each exit: **pick 1 of 2** next biomes → model writes **8 briefs** (1 opener + 2·2·2 + 1 finale); you play 5.
- Generator = Isaac BFS nearly verbatim (the ">1 filled neighbour" rule is what clones get wrong), grid scales 9×8 → 13×11, generate-validate-retry with a cap.
- **Layout personality** in each brief (bounded numbers the model picks): `linearity`, `branchiness`, special-room counts. *The crew's ideas change the floor's shape, not just its paint* — "flooded archive" → maze, many lore rooms; "siege wall" → long spine of elites.
- Room **kinds**: `entrance · combat · elite · treasure · lore · rest · exit`, reserved `shop`. Templates tagged `{kind, doorMask, sizeClass, motifAffinity[]}`; biomes draw from affinity-filtered pools so no two feel re-tinted.
- **PR #16's terrain becomes the template mutation layer** (its `RoomTerrain {features, layout, density}` is already per-room and model-selectable — it slots straight in). Its **Custodian + relay ritual** lives in biome 5's exit room; biomes 1–4 exits get a scaled single-phase Custodian variant as gatekeeper.
- **Encounter director**: budget = f(depth, kind), spent on the biome's enemy pool under compatibility rules.
- **Lazy deterministic compile** per biome from `(worldSeed, biomeId)`; only visited rooms ride in snapshots. **Minimap** with fog-of-war.
- **Two model calls**: bible + opener brief gates the portal (first room < 60 s holds); the other 7 briefs + lore generate during biome 1.
- Contracts **additive + legacy adapter**: main keeps playing 3-room worlds until sim *and* renderer are green, then one flag flips.

### 3b · Writing
**What reads as AI** — [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing): stock vocabulary (tapestry, testament, intricate, enduring…), **"not X, but Y"**, **rule of three**, trailing **-ing clauses asserting significance**, **copula avoidance** ("serves as"), em-dash drama. [EQ-Bench Slop Score](https://eqbench.com/slop-score.html) = **60 % slop words + 25 % not-x-but-y + 15 % slop trigrams**, lists from [antislop](https://github.com/sam-paech/antislop-sampler) ([paper](https://arxiv.org/pdf/2510.15061)). [Nous ANTI-SLOP](https://github.com/NousResearch/autonovel/blob/master/ANTI-SLOP.md): symmetry addiction, exactly-3 lists, the "could this sentence be about any other topic?" test.
**What fixes it** — prompt rules alone hold ~**80 %**; you need [a validator on top](https://ozigi.app/blog/stopping-ai-slop-in-production-banned-lexicon-validator). Strongest style lever is **seeding with human text**, long and unlike the model's default ([arXiv 2509.14543](https://arxiv.org/pdf/2509.14543)). ⇒ **ban-lists live in the validator** (in a prompt they prime the words); **the prompt carries positive rules + exemplars**.
**How the good human text is built**
- *Souls items*: [effect first, then one fact about the owner](https://mrpuddins.wixsite.com/koboldstew/post/inspirations-v-dark-souls-and-story-telling); [placement is part of the meaning](https://lokeysouls.com/2020/11/16/environmental-storytelling/).
- *The Alexandrian* ([boxed text](https://thealexandrian.net/wordpress/48312/roleplaying-games/gm-dont-list-13-boxed-text-pitfalls), [the key](https://thealexandrian.net/wordpress/35206/roleplaying-games/the-art-of-the-key-part-2-the-essential-key)): only what's perceived on entry; most important thing first; **never state the player's feelings or actions**; stop where the player can act.
- *MTG flavor text* ([Rosewater](https://magic.wizards.com/en/news/making-magic/write-stuff-2002-03-18)): one idea, fewest words; **one writer per character** so voices stay distinct.
- *Caves of Qud* ([Grinblat & Bucklew](https://www.freeholdgames.com/papers/Generation_of_mythic_biographies_in_Cavesofqud.pdf)): **events as structured state first, narration second**; found in any order, assembled by the player.

**Pipeline**
1. **Bible = structured data, never shown**: 5–7 dated events, 3–4 named people (job + want), 4–6 named places/objects, one cause of collapse. Flat declaratives.
2. **Three in-world authors** per world with distinct registers (a quartermaster's ledger, a child's letters, an engineer's fault log). Every fragment is *by* one author *about* one event. This is what makes 8 biomes one story.
3. **Per-type templates**: item/boon = effect → one owner fact. Room line = first-glance perceivables, threat first, ≤ 90 chars, no feelings. Remains = the creature's former *job*, stated flat.
4. **Linter** (`src/shared/prose.ts`): slop score + structural patterns + **specificity rules** — each fragment needs ≥1 bible proper noun **and** ≥1 number/date/physical object; no 2nd-person feelings; ≤1 em dash; no "as if / seemed to / something / somehow"; no short abstract last sentence (the "ominous turn"). Runs in tests over all static text + fixtures, and server-side on live output.
5. Failures re-enter the **existing repair loop** with the specific rule broken. Linter *scores*; it hard-fails only unambiguous patterns, so it can't sand the text into stiffness.
6. **Blind read** closes the loop (§4, Q1).

### 3c · Tiles, boss, finale, hub — what #16 has, what research says is missing
Sources: [boss structure](https://www.gamedeveloper.com/design/boss-battle-design-and-structure) · [3 elements of a great boss](https://www.gamedeveloper.com/design/3-elements-that-every-great-boss-fight-needs) · [a boss that teaches its own pattern](https://bugnet.io/blog/how-to-design-a-boss-that-teaches-its-own-pattern) · [Gungeon's reactive rooms](https://en.wikipedia.org/wiki/Enter_the_Gungeon) · [House of Hades](https://hades.fandom.com/wiki/House_of_Hades) / [why the hub matters](https://gamerant.com/hades-2-underworld-house-hub-area-relaxation-character-relationships-customization/)

| Area | PR #16 gives us | Gap the research points at | Our second pass |
| --- | --- | --- | --- |
| **Tiles** | 4 features, all **movement modifiers** (block / cross / slow / speed). | Gungeon/Hades rooms are *reactive to combat*: the environment is something you **use on enemies** and that enemies use on you. Isaac's rocks, pits and secret walls shape routes. | Add **combat-facing** tiles to #16's registry: **pit** (dash across; knock enemies in) · **vent/spike trap on a timer that hurts enemies too** · **volatile canister** (chain blast, opens breakable walls) · **low cover** (stops projectiles, not movement) · **sealing door** (locks during combat — needed by floors anyway) · **secret wall** (pairs with Isaac-style secret rooms) · **pressure plate + gate** (co-op: one holds, one passes). And your "let the LLM be creative": the model **skins and names** each mechanic per biome from the closed set ("tide-gauge vents", "ledger stacks" as cover) — mechanics fixed by the engine, identity by the world. |
| **Boss** | 3 HP phases that escalate: charges, *denser* rings, recovery windows. | "Each phase should be **different, not just harder**"; a boss **tests what the run taught**, teaches its pattern through telegraphs, has a tension curve with a twist. | **World-built Custodian**: the model picks a moveset of 3 patterns from a closed registry of ~10 (sweep, summon, arena-flood, wall-break charge, tether pull, mirror-clone…) and names them from the bible. Phase 2 = **twist that uses the biome's own tiles** (floods the conduits, shatters cover). Phase 3 = **co-op split** mechanic (two relays must be held at once; solo gets a decoy). Gatekeepers at biome 1–4 exits are one-pattern previews of it — the run literally teaches the final fight. |
| **Finale** | 3 relays charged under pulses → Anchor discharge. Good base, keeps. | Your note: more than "hold F". Our own tagline: *worlds end, your stories don't.* | After the discharge the world **starts collapsing**: a timed **escape back through the floor graph** to the portal, rooms breaking behind you (the minimap earns its keep). At the portal the crew **chooses one relic to carry out**; that choice — real, event-derived — becomes the memory on the hub wall. Relics actually read during the run shorten the ritual, so exploring lore has a mechanical payoff. |
| **Hub** | 4 stations: class shrines, records archive, training, observatory. | Hades' hub works because it **reacts to your last run** and makes failure feel like progress; Dead Cells' is tiny. Keep it small, make it responsive. | **Reactive Stillpoint**: carried-out relics appear as physical objects; a quartermaster NPC with short lines keyed to **real run events only** (what downed you, which biome you reached, who revived whom — never invented, per the repo's honesty rule; text through the W1 linter); records room gets per-class stats; the departure walk through the portal stays. Cosmetic "contractor" upgrades wait for currency. |

### 3d · UI
Screenshot audit (HQ / combat / menu / debrief × 1280, 1440, 1920) → written problem list → fix → before/after PNGs. Right rail and bottom bar only. Reserves a minimap slot. Runs **after PR #16 lands** because #16 touches `Hud.tsx`, `GameMenu.tsx`, `App.tsx`.

## 4 · Schedule
Every agent: Fable · own **worktree + branch** · exclusive file list · acceptance criteria below · I review the diff and merge on green.

### Wave 0 — land the foundation (≈ 45 min) — *two things in parallel*
| # | Who | Work | Done when |
| --- | --- | --- | --- |
| 🔴 **P16** | Devin first, agent as fallback | **First I comment on PR #16**: approval to fix the six stale tests without weakening assertions, plus our plan and tonight's file ownership. If it isn't green in ~25 min, my agent does it: branch `integrate/pr16` off Devin's head. Fix the 6 stale tests **without weakening assertions** (HQ pillar coords; `compactWorld` must drop fixture relay sites; add `strokeEllipse`/`fillTriangle` to the Phaser mock). Screenshot the hub, a terrain room, the finale. | `npm run check` green → I merge to main, comment on PR #16 with what changed so Devin rebases onto main rather than diverging. |
| 🔴 **F1a** | agent | **New files only**: `src/shared/floors.ts` (types), `src/server/generation/floorgen/**` — Isaac BFS, validate-retry, kind assignment, template library, director. Pure functions, no edits to existing files → cannot conflict with #16. | Property tests: exact counts 10/15/20/25/30 · connected · every door twinned · boss ≥ N steps from start · **byte-identical for equal seed** · 1 000-seed fuzz with zero retry-cap hits. |
| — | me | Issue #4 comment (what's coming, file ownership tonight) · `scripts/shot.ts` (Playwright URL → key script → PNG, `--coop` for two contexts) · `docs/design/FLOORS.md` one-page spec with schema sketch. | Pushed. |

### Wave 1 — four in parallel (starts as P16 merges; W1 and F1a are already running)
| # | Agent | Owns exclusively | Done when |
| --- | --- | --- | --- |
| 🔴 **F1b** | Floors contracts | `contracts.ts`, `registry.ts`, `compiler.ts`, legacy adapter, fixtures schema | `PreparedWorld` carries `bible?`, `biomes[]`, `biomeGraph`; rooms addressed `{biomeId, roomId}`; old 3-room worlds + HQ room still validate through the adapter; all existing tests green **unmodified** except index-limit assertions. Merged within ~1 h — *schemas first, polish later*. |
| 🔴 **W1** | Writing research | new `docs/WRITING.md`, `shared/prose.ts`, `tests/shared/prose.test.ts`, `prompts/exemplars/**` | Guide with sourced do/don't pairs per text type · linter with licence-checked lists · ≥ 8 exemplars per text type written in imitation of the studied sources and passing its own linter · a report scoring **today's** fixtures (the baseline we must beat). Touches no existing file. |
| 🟠 **U1** | UI audit + fix | `Hud.tsx`, `AbilityBar`, `AbilityIcon`, `WorldPanel`, `GameMenu`, `app.css` | Problem list + before/after PNGs at 3 widths; no overflow/clipping at 1280; menu + HUD tests green. |
| 🟠 **D1** | Design specs (2 agents: **D1a** tiles + boss/finale · **D1b** hub + items) | `docs/design/{TILES,BOSS_FINALE,HUB,ITEMS}.md` only | Each plays PR #16 via screenshots first, then turns §3c into a buildable spec: registry additions, sim hooks, exact numbers, a one-night cut, and a "needs a human call" list. Deeper web research on its own area is part of the job. ITEMS stays a doc (your call in the morning). |

### Wave 2 — once F1b is on main
| # | Agent | Owns | Done when |
| --- | --- | --- | --- |
| 🔴 **F2** | Sim + netcode | `sim/simulation.ts`, `collision.ts`, `LocalSession`, `RemoteSession`, `network/realtime.ts`, `protocol.ts` (not `sim/headquarters.ts`, not `sim/terrain.ts`) | Graph traversal; doors lock during combat; biome choice (host decides in co-op); lazy compile on both ends; two-client integration test walks biome 1 → choice → biome 2 in sync. |
| 🔴 **F3** | Renderer + floor UI | `RoomScene.ts`, `dressing.ts`, `environment.ts`, new `Minimap.tsx`, `BiomeChoice.tsx`, new `floors.css` | Doors + room-kind dressing render; minimap fog-of-war; two-door choice screen; screenshots of 5 room kinds in 2 biomes look distinct. |
| 🔴 **W2** | Prompt + pipeline | `prompts/runtime/**`, `provider.ts`, `liveService.ts`, `operator/provider.ts`, `receipt.ts` | Bible → authors → briefs → fragments; two-call flow; exemplars injected; linter in repair loop with rule-specific feedback; mocked tests for both calls + repair. Jeffrey's area — his commits merge first, W2 rebases. |
| 🟠 **T1** | Tiles second pass | tile additions in `registry.ts` (hand-off from F1b), `sim/terrain.ts`, `shared/terrain.ts`, `render/terrain.ts`, templates | 5 combat-facing tiles from TILES.md live in sim + renderer; enemies take trap damage; model-facing skin/name fields validated + linted; sim tests per tile. |
| 🟠 **H1** | Reactive hub | `shared/headquarters.ts`, `sim/headquarters.ts`, `render/headquarters.ts`, `HeadquartersStations.tsx`, `headquarters.css`, chronicle read-side | Carried relics render in the hub; quartermaster lines keyed to real chronicle events; per-class records. Starts only after #16 is on main **and** Devin has been told (PR comment) these files are ours. |
| 🟠 **W3** | Static text pass | string literals in `registry.ts`, `skills.ts`, UI copy, PR #16's new strings | String-only diffs; linter test green over every static string. |

### Wave 3 — integrate + verify
- **X1 Fixtures** — rebuild the 3 offline worlds as 8-biome worlds with hand-polished text: the demo safety net *and* the best exemplars.
- **B1 Boss + finale** — from BOSS_FINALE.md, extending #16's `finale.ts` and boss phases: pattern registry + model-picked moveset, tile-using twist, co-op split phase, gatekeeper previews at biome 1–4 exits, collapse-escape through the floor graph, carry-one-relic choice → memory wall. Needs F2 (graph traversal), so it's Wave 3 by dependency, not by priority.
- **Q1 Verification** — solo run 5 biomes → boss · two-context co-op run · **blind read**: a fresh agent gets 20 unlabelled samples, half ours, half real excerpts from the studied games, picks the AI ones and says why; its reasons become linter rules / exemplars; repeat until near chance. Then QA.md, handoffs, evidence docs.
- **Flip the flag** to floors on main only when F2 + F3 + X1 are green.

### Timeline (assumes we stop changing code at ~09:00 — tell me the real submission deadline)
`03:20` Wave 0 → `04:00` #16 on main, Wave 1 → `05:00` F1b schemas on main, Wave 2 → `07:00` Wave 3 → `08:00` flip decision → `08:30` rehearsal build. **Hard rule: if floors isn't green by the flip decision, main ships PR #16 + writing + UI + whichever of T1/H1 are green, on 3-room worlds, and floors stays behind the flag.** T1 and H1 are deliberately built so they work on 3-room worlds too; only B1's escape sequence needs floors (its boss half doesn't). Nothing demo-critical ever depends on an unfinished wave.

## 5 · Working beside three live teammates
- `git fetch` + rebase on `origin/main` **every 30 min and before every merge**; their commits land before ours; never force-push; never push to a `devin/*` branch.
- **Canary merge each cycle**: scratch worktree, `git merge --no-commit` each live `devin/*` head onto our tip + `npm run check`. Red canary → fixed on *our* side that cycle.
- **Talking to Devin**: PR comments from a write-access account are instructions to it (prefix `(aside)` for notes it should ignore). I use that to (1) approve the test fixes, (2) announce after the merge that tiles/boss/finale/hub second passes are ours tonight and list the files, (3) ask it to rebase onto main. You should still tell jonapplehe in person — a human redirecting their own agent beats my comment.
- Small green merges, often. One owner per hot file per wave. ≤ 6 agents at once, ~15 total.
- I stay orchestrator: merge queue, conflict resolution, diff review. No Workflow tool needed.

## 6 · Risks
| Risk | Mitigation |
| --- | --- |
| Floors doesn't converge by freeze | Legacy adapter + flag; §4 hard rule. |
| Co-op desync from lazy compile | Byte-identical determinism test in F1a, before F2 exists. |
| Devin and our agents build the same thing twice | PR comment + jonapplehe told directly; canary merge each cycle; our passes *extend* #16's registries/hooks, so even overlapping work merges as additions, not rewrites. |
| Scope: 15 agents, ~5 h | Strict priority order (§1). T1/H1/B1 never block floors or writing; each is independently shippable or droppable at the flip decision. |
| Text still reads as AI | Exemplars + linter-in-repair-loop + blind-read iteration; fixtures hand-polished regardless. |
| 8 briefs too slow / costly | Two-call split, measured in Q1; fallback = 5 linear biomes, no choice. |
| Linter makes prose stilted | Scores by default, hard-fails only unambiguous patterns; blind read is the judge. |

## 7 · The API key (your Q4)
It's for the **game**, not for me. RELAY's server calls Claude (`claude-sonnet-4-6`) to write each world; checking that the new prompt yields human-sounding text means running it on that model and reading the result. ~3–6 k tokens per world → 40 test worlds ≈ $1–3. **Without it** I iterate through the repo's *operator mode* (an agent answers the server's requests with the same prompt + validators) — but that tests Fable's prose, not Sonnet's, so "indistinguishable from human on production output" stays **unverified**. `.env` is gitignored; any time before Wave 3 is fine.

## 8 · Two things I need
1. **The real freeze/judging time** (I've assumed 09:00 EDT).
2. **A word to jonapplehe**: PR #16 lands as the base tonight; after that, the tiles / boss / finale / hub second passes are ours, and their Devin is most useful rebased onto main and pointed at something else (items? currency/shops prototypes? co-op verification on two laptops?).
