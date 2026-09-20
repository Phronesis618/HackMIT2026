# Vision audit, 20 Sept 2026 (agent V1)

Every claim RELAY makes to a player, checked against `docs/PRODUCT.md`. The question is not
"is this good", it is "is this true": does the thing on screen exist, did it happen, and is the
player told where it came from. Each row carries file and line so the next person can re-check
it rather than take this file's word for it.

Verdict key: **honest** (claim matches the code), **violation** (the UI claims something that
is not true or not built), **stale** (code or comment promises a disclosure that does not exist).

## 1. Provenance: fixture, live and fallback

PRODUCT.md: *"A bounded live attempt resolves to a clearly labelled playable fallback. Fixtures
or cached content are never presented as fresh generation."*

| Where | Evidence | Verdict |
| --- | --- | --- |
| The source enum itself | `src/shared/contracts.ts:110-116` — "This is shown to players; it must never lie." | honest |
| Fixture and fallback labels | `src/server/generation/fixtureService.ts:54` — `'OFFLINE FIXTURE'` / `'FALLBACK FIXTURE (live attempt failed)'` | honest |
| Live label | `src/server/generation/liveService.ts:137` — `` `LIVE · ${options.model}` `` | honest |
| Fallback status line | `src/server/generation/liveService.ts:77` — "Live generation failed; a labelled offline fixture is ready." | honest |
| The badge is always on screen | `src/client/ui/ProvenanceBadge.tsx:3`, mounted in the persistent topbar at `src/client/ui/App.tsx:63`, outside the `inRun` branch | honest |
| World dossier disclosure | `src/client/ui/WorldPanel.tsx:98` — "Offline fixture." / "Live generation failed; using an offline fixture." followed by "Your ideas are recorded, but did not shape this world." | honest |
| Per-memory disclosure | `src/client/ui/HeadquartersStations.tsx:108`, `src/client/ui/MemoryWall.tsx:134` | honest |

**Fixed here:** `src/server/generation/receipt.ts:40` opened the fallback headline with an em
dash ("Live generation failed — fallback fixture"), which `docs/WRITING.md` does not allow in
player text. It now reads "Live generation failed. Offline fixture “X” instead."

## 2. Content chosen by trusted code, not written by anyone

Three things can be produced by the engine when the model did not write them: world laws
(`deriveWorldLaws`, `src/sim/laws.ts:251`), biome briefs (`deriveBiomeBriefs`,
`src/shared/floorgen/briefs.ts:98`) and the Custodian's move set
(`DEFAULT_CUSTODIAN_MOVES`, `src/shared/custodian.ts:202`).

| Where | Evidence | Verdict |
| --- | --- | --- |
| Laws panel | `src/client/ui/WorldPanel.tsx:51` — "Laws of this world · N" and no authorship claim anywhere near it | honest by omission (agent Z1 is adding the explicit derived label) |
| Biome doors | `src/client/ui/BiomeChoice.tsx:61-67` — name, tagline and "Built from:" motifs, no authorship claim | honest by omission |
| Boss callouts | `src/sim/boss.ts:275` emits `name` and `tell` with no authorship claim | honest by omission |
| Derivation is disclosed in provenance | `src/server/generation/pipeline.ts` — "Biome brief(s) N of 8 were derived by trusted code, not written by the model"; `src/server/generation/stages.ts` `parseCustodian` — "Replaced N Custodian move(s) … with defaults" | honest, but only inside **World dossier › generation details › Provenance notes** |

**Left for a human, with the case for it:** derived content is disclosed in a collapsed
`<details>` and never at the point of use. A player choosing between two doors cannot tell that
one floor's name and tagline were assembled by `fallbackBrief` rather than written for their
world. The fix is small but crosses two owners: thread a `derived` boolean from
`ParsedBrief` into `UiBiomeOption` and mark the door. Not done here because
`src/client/ui/floorsModel.ts` and `BiomeChoice.tsx` belong to the floors agent and this pass
was string-only in other people's files.

**Stale:** `src/shared/custodian.ts:208` — `/** Where the identity came from; the HUD may say
so, and tests assert it. */` on `source: 'recipe' | 'derived'`. No client code reads it. The
comment describes a disclosure that was never built. Either build it or correct the comment.

Also stale: `worldLawsView` returns `derived` (`src/sim/laws.ts:278-292`) and the only caller
drops it (`src/client/game/GameController.ts:356-358`). Agent Z1 is working in that file.

## 3. The creation receipt

PRODUCT.md: *"Attribute actual player contributions to observable world features."*

| Where | Evidence | Verdict |
| --- | --- | --- |
| A line is `used` only with a real mapping | `src/server/generation/receipt.ts:19` — `source === 'live' ? byContribution.get(c.id) : undefined` | honest |
| Fixture worlds claim nothing | `src/server/generation/receipt.ts:37` — "Your N ideas were recorded but did not shape this world." | honest |
| A mapping needs a real tile | `src/server/generation/compiler.ts:588-594` — `buildAttributions` returns `[]` unless a prop, encounter, hazard or structure tile was actually placed | honest |
| Progressive worlds | `src/server/generation/liveService.ts:120-127` — each committed world's mappings come only from rooms already compiled | honest |
| **Floors mode** | `src/server/generation/index.ts:70-78` takes the first single-room world and upgrades it; mappings only ever come from the rooms call (`src/server/generation/stages.ts:663`), so the seven later floors carry none | honest: the receipt never points at a room the player will not enter |

## 4. Memories, Quartermaster lines and records

PRODUCT.md: *"Subsequent memories only from real gameplay events … Never invent friends,
rescues, completed runs or past experiences."*

| Where | Evidence | Verdict |
| --- | --- | --- |
| Every memory is keyed to one event id | `src/chronicle/reducer.ts:1-17`, each event processed once at `reducer.ts:90-93` | honest |
| No invented participants | `src/chronicle/reducer.ts:470-473` — participants resolved from the event's own `playerIds` | honest |
| Quartermaster lines | `src/client/chronicle/hubCues.ts:2-7` — cues fire only on `HubCueContext`, reduced from recorded events; each line's whitelist of variables is enforced by test | honest |
| The line shows its own evidence | `src/client/chronicle/hubCues.ts:172-195` `cueEvidence`, rendered at `src/client/ui/HeadquartersStations.tsx:174`, e.g. "run_ended (collapsed)" | honest, and unusually so |
| Records are not lifetime totals | `src/client/ui/HeadquartersStations.tsx:94` — "They are not lifetime totals or win counts." | honest |
| Sample data | `src/shared/samples.ts:1-9` — every id prefixed `sample-` / `test-`; imported by no client or server module, only tests | honest |

## 5. Unlocks introduce new behaviour, not stat percentages

PRODUCT.md, "Full target": *"Unlocks introduce **new behaviour**, not stat percentages."*

Twelve of the authored nodes are a number and nothing else. **Violation of the stated design
rule**, flagged here for the agent making the tree real rather than fixed in this pass, because
changing a node's text without changing what it does would only move the dishonesty:

- `src/shared/skills.ts:50` `core.plating` — "+20 max Integrity."
- `src/shared/skills.ts:51` `core.wind` — "Dash cooldown −25%; invulnerability window +50 ms."
- `src/shared/skills.ts:52` `core.salvage` — "Cleared rooms yield +1 resource."
- `src/shared/skills.ts:58` `bastion.plate` — "Bulwark lasts 3.2 s and blocks 90% of melee instead of 80%."
- `src/shared/skills.ts:61` `bastion.radius` — "Shockwave radius 135 → 180; stun +0.5 s."
- `src/shared/skills.ts:68` `shade.edge` — "Phase blades +4 damage; attack cadence +10%."
- `src/shared/skills.ts:79` `beacon.reach` — "Lantern staff range 240 → 300."
- `src/shared/skills.ts:80` `beacon.flare` — "Flare radius +25%; marked enemies take 40% more instead of 30%."
- `src/shared/skills.ts:83` `beacon.rally` — "Rally range 200 → 280 and heals 45."
- `src/shared/skills.ts:85` `beacon.lance` — "Solar Lance width doubles and marks for 6 s." (the base ability already marks: `src/shared/registry.ts:119`)
- `src/shared/skills.ts:90` `weaver.loom` — "Plasma loom strikes slow for 1.5 s instead of 1 s."
- `src/shared/skills.ts:96` `weaver.collapse` — "Collapse pull 200 → 260 and it holds enemies 0.6 s longer."

The nodes that do obey the rule are the interesting ones and show what the others should become:
`bastion.reflect` "Bolts blocked by Bulwark are thrown back along their line",
`shade.afterimage` "Phase Step leaves a decoy that draws melee attacks for 1 s",
`weaver.knot` "Enemies you slow also attack 30% slower".

## 6. Nothing claims a feature that does nothing

| Claim | Evidence | Verdict |
| --- | --- | --- |
| Skill tree | every node is `status: 'planned'` (`src/shared/skills.ts:46,116`), and the page says so: `src/client/ui/GameMenu.tsx:325` "Design preview: effects are not wired to the simulation yet", plus per-node `GameMenu.tsx:373` "Locked · not yet active" | honest |
| Attunement effects | all ten are `status: 'planned'` (`src/shared/registry.ts:271-281`); their only surface is the skill page above | honest |
| World laws | nine of eighteen are not applied by the engine (`src/sim/laws.ts:55-59`). Fixed in this branch: fixtures and the live prompt now offer only implemented laws, the pipeline drops an unimplemented pick with a provenance note, and `src/client/ui/WorldPanel.tsx:47` filters the panel and the world rail to laws that are in force. A dead law can no longer reach a player at all. | honest (was a violation) |
| Proving chamber | `src/shared/headquarters.ts:39` — "Practice range with every enemy attack pattern"; `src/sim/training.ts:59-67` has a pen for all eight enemy ids | honest |
| Abilities and enemies | `src/shared/registry.ts:45-60,136+` — every entry is `'implemented'` | honest |

## What this audit did not cover

Audio, the escape sequence, the onboarding flow (agent O1's, not landed at the time of
writing) and the LAN co-op joining path. The honesty rules apply there too and nobody has
checked them line by line.
