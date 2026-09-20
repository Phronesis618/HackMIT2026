# RELAY overnight — follow-up tracker
Every leftover, caveat or "not done" from a finished agent/PR lands here with an owner. Nothing closes the night until each row is ✅ done, 🙋 handed to a human in MORNING_REPORT, or ✂️ explicitly cut with a reason. Orchestrator: update at every merge; re-read before launching any wave.

## A · Floors / sim — owner: **Z1 follow-ups sweep (Opus → Fable gate), starts when T1 merges**
| # | Item | From | State |
| --- | --- | --- | --- |
| A1 | Rail tile shows "ROOM 1/1" in floors mode → show room n of biome budget / biome tier | C1, me | ✅ Z1 |
| A2 | Guest keeps the biome-choice notice after the host picks | C1 | ✅ Z1 |
| A3 | Remove the 1/2-key biome stopgap + "way on is open" notice in `GameController.ts` (choice screen replaces them) | F3 | ✅ Z1 |
| A4 | Rest room heals once per run, spec said once per visit → decide + make consistent with UI text | F2 | ✅ Z1 |
| A5 | Floors rooms carry no attributions; lore/mapping `roomIndex` still 0..2 → creation receipt can't point at floors features. Map contributions → biome/room-kind features | F1b, W2 | 🙋 known limitation: V1b verified the receipt is HONEST in floors mode (it attributes only what it can show), but contributions are still mapped to the 3 legacy room slots, not to biome/room-kind features. Not fixed tonight |
| A6 | Co-op client needs `?laws=1` itself to see derived laws/look → server must tell clients (world payload or /api/config) | M1 | ✅ Z1 |
| A7 | Briefs arriving mid-run need a sim hook (only matters if call 2 becomes background) | F2, W2 | ✂️ cut unless W2b makes call 2 async |
| A8 | Escape route may pass through uncleared rooms; escape vs T1 pits/hazards — T1 gate only REASONED it from `validateRoomSafety` (every door reachable without dashing, hazard-free route); `escape.ts` not opened, no test | B1 gate, T1 gate | ✅ Z1 |
| A9 | Corrupted floor (boss phase 2) may be hard to see in play | B1 gate | 🙋 was on U2a's list; not confirmed in a live phase-2 screenshot → look at it once during rehearsal (deep link in docs/QA_FULLRUN.md if Q2 lands) |
| A10 | `tests/generation/readiness.test.ts` only asserts phase 3 (solo-win test lives elsewhere now) | B1 gate | ✅ Z2 (phase order, ≥2 patterns, hit cap) |
| A11 | Disconnected operatives stand unmarked for 30 s, still targeted, delay collapse check | C1 | ✅ Z1 |
| A12 | Secret rooms not generated; no biome-exclusive template sets; encounter numbers untuned | F1a | ✂️ secret rooms cut tonight; tuning → 🙋 |
| A13 | `unstable_matter` law (needs T1 canister), `wallStyle`, `skylineDepth`, `grain` | M1 | ✅ unstable_matter (Z1); wallStyle/skylineDepth/grain ✂️ cut |

| A14 | T1: renderer must draw the canister blast from the new `terrain_detonated` event; `terrainCaption(..., skins)` needs `world.recipe.terrainSkins` passed in `RoomScene` | T1 | ✅ T1 gate (6e33421) |
| A15 | T1: `enemy_damaged`/`enemy_defeated.byPlayerId` is now NULLABLE (environment kills) → every consumer (chronicle reducer, hub state/records, Quartermaster cues, debrief, ult charge, B1 boss credit) must handle null | T1 | ✅ T1 gate: all consumers handle null; first-victory memory waits for a crew kill |
| A16 | T1 and W2 both define a terrain-skin schema (`TerrainSkinSchema` vs `TerrainSkinListSchema` in laws.ts) → unify like custodian | T1, W2 | ✅ T1 gate: single schema in laws.ts |
| A17 | `tests/shared/prose.test.ts` 50 ms benchmark flakes under full-suite load; one two-client timing test in `realtime.test.ts` flaked once for W2 | T1, W2 | ✅ prose benchmark = best of 7; realtime flake ✅ Z1 (server 250 ms input window) |
| A18 | T1 fixed `chaseWaypoint` reading the shot layer (enemies stalled at cover) — behaviour change for all enemies pathing; watch in Q1 playthrough | T1 | Q1 |

| A19 | Low cover now blocks line of sight for revive / relay / lore interactions (should only block shots) | T1 gate | ✅ Z1 |
| A20 | A burn tick takes an enemy off full health and so consumes the crew's `first_light` opening-strike bonus | T1 gate | ✅ Z1 |
| A21 | Canister blast has no sound; departure ritual has no audio cue | T1 gate, Devin #35 | ✅ Z1 |

| A22 | S1 gate: `first_strike` attunement ×2 STACKS with `first_light` law ×2–3 (opener up to ×6); attunement `first_strike` still keys on "enemy at full health", so a burn/vent/dash_echo tick consumes it (Z1 re-keyed only the LAW to first player hit) → align both, cap the product | S1 gate | ✅ Z2 |
| A23 | S1 gate: owned attunement ids stay active in a LATER world that has the same slot+effect (purchases should be per-world/run) | S1 gate | ✅ Z2 |
| A24 | S1 gate: haste (`clear_surge`) is not in the snapshot → no HUD cue on clients; dash trail (`dash_echo`) has no renderer representation | S1 gate, Devin | ✅ Z2 |

| A25 | Z1: top bar still says "room N" and the world brief "1/1 rooms" in floors mode | Z1 | ✅ Z2 |
| A26 | Z1: `beacon.e.rally` still needs line of FIRE to an ally (cover blocks a support ability) | Z1 | ✅ Z2 |
| A27 | Z1: floorgen does not check enemy body radius against corridor width — a wide enemy can spawn where only Z1's radius fallback reaches it | Z1 | ✅ Z2 |
| A28 | Z1 fixed two real stalls while testing escape (wide bodies froze in 2-tile corridors → softlock behind sealed doors; big enemy in cover untouchable) — behaviour change to `chaseWaypoint`/`canStrike`; watch in Q1 playthrough | Z1 | Q1 |

| A29 | Z2: the floors ESCAPE smoke test is chaotic — any sim change flips it; Z2 made the bot lead the healthiest operative and LOWERED that test's terrain intensity 0.7→0.4. A fragile test usually means a fragile mechanic: check in the real playthrough whether the escape through terrain at normal intensity is fair for a human | Z2 | Q1 could not reach it → Q2 full-run bot |
| A30 | `validateRoomSafety` has no body-clearance rule (generator now places wide bodies safely, validator doesn't assert it) | Z2 | ✂️ cut: generator + both 1000-room fuzzes already enforce it; validator rule is belt-and-braces |

## B · Balance — owner: 🙋 humans decide, Z1 prepares the knobs
| B1 | Solo boss win rate with a naive bot: Shade 6/6, Beacon 3/6, Weaver 3/6, **Bastion 2/6**; deaths mostly from standing in corrupted floor. Boss HP 1200+400/player is arithmetic, not playtested | B1 gate, D1a | ✅ Z1: `src/sim/tuning.ts` + `docs/TUNING.md`, no value changed; 🙋 tune |
| B2 | Hazard numbers (ramp 3→15 /450 ms, enemies ×1.6, env kill credit 0.5) untested in play | D1a | 🙋 after T1 |
| B3 | Three laws impose tempo (`committed_strike` etc.) — M1's bots pass for all classes, human feel unverified | D1a, M1 | 🙋 |

## C · Writing / generation — owner: **W2b (running)**, then X1 (Devin #31), then Fable blind-read
| C1 | First room ~70 s (target < 60); zero-hard-fail worlds 5/8 (target ≥ 7/8); `parseLooseJson` unverified live | W2 | ✅ W2b: 8/8 zero hard fails, wall p50 47.3 s (8/8 under 60), call-1 repairs 0/8, mean lint 2.4 |
| C2 | Collapse causes lean on paperwork; two engine-word lines | W2 | ✅ W2b |
| C2b | **Biggest remaining tell: truncation.** Model ignores `maxLength` (56/64 taglines, 407/448 room lines over) so trusted code cuts them — a cut line is unfinished writing. Fix: ask for a hard word budget well under the limit + show short exemplars + regenerate-the-line instead of cutting when over | W2b | ✅ V1b |
| C2c | Some law descriptions state the fact but omit the rule; one remains fragment reused an author's name (forbidden by `remains.md`, nothing checks it → add a validator rule); room-line openings repeat within a floor (add a per-floor opener-variety check) | W2b | ✅ V1b |
| C3 | Custodian limits tightened to `custodian.ts` (phase titles ≤ 40) → prompt must say so | me | ✅ W2b |
| C4 | `biomeRoomLines` slot written by the model but read by nothing → floors room names/descriptions should use it | W2 | ✅ Z1 |
| C5 | Fixture prose fails linter 45% | W1 | ✅ Devin PR #37 rebased + merged 05:42 (899 tests); prose now concrete/named/dated (sampled); `biomeRoomLines` left empty; worlds never played in a browser → Q1 |
| C6 | Blind read: our text vs real game excerpts, by a fresh Fable reviewer; reasons → linter rules/exemplars | plan | queued after X1 + W2b |
| C7 | Dark Souls quotes in WRITING.md are from memory (flagged in doc) | W1 | 🙋 verify or delete before publishing |

## D · Hub — owner: **Devin #28**, then Q1
| D1 | Departure ritual, lamp tiers, operatives carry class weapon, "quick controls" label | H1, U1 | ✅ Devin PR #35 merged 05:25 |
| D1b | Ritual has no audio cue; ritual overlay is per-client in co-op (not synced); return fade never eyeballed | Devin #35 | audio → Q1/✂️; eyeball → U2 |
| D2 | Co-op ready-up at the gate | HUB.md §7 | ✅ merged after OPUS GATE. As submitted it could DEADLOCK (an AFK guest blocked the host forever) → reviewer added a 12 s host force-start + stopped a snapshot-per-message broadcast; coop-e2e 28/28 incl. new READY + guest-offline checkpoints. Residual: 4 operatives crowding the 58 px gate radius can flip one out of range (override covers it) → 🙋 note; crew strip wraps at 4 players → U2a |
| D3 | Real run → hub update never seen in a browser; records panel never screenshotted | Devin #22 | Q1 |
| D4 | Skill tree + 10 attunement effects display-only | gaps | Devin PR #40 arrived 06:15 (CI green). ✅ merged after FABLE GATE (fixed hazard_ward missing boss floor damage; added two-socket buy test). Devin's own leftovers: no live two-socket buy test (gate adds it); dash trail has no renderer representation; `core.plating` + all class nodes still honestly `planned` → 🙋/stretch |

## E · UI — owner: **U2 final audit (Opus sweep → Fable sign-off)**
| E0 | ✅ U2a (Opus): 36 defects found, 32 fixed, 3 full rounds, 76-shot before/after montage `/tmp/relay-shots/u2/montage.html`; E1–E4 below are covered by it unless listed in E5 | U2a | ✅ |
| E1 | In-canvas room description overlaps the operative name label; floor-stencilled title box overlaps props/text clips | me | ✅ U2a + U2b (see E0/E5/E7 for what is left) |
| E2 | Never looked at: debrief (victory/collapse/abort/stranded), hub station panels, world receipt after Prepare, training range, biome choice as guest, escape timer + relic choice, boss telegraphs, long_dark, all 6 palettes for contrast | U1, B1, M1 | ✅ U2a + U2b (see E0/E5/E7 for what is left) |
| E3 | ~100 px dead space under command bar on 16:10; `app.css` per-round override blocks need consolidating; rest/treasure rooms thin on prop art; spire light shafts brush the void | U1, F3 | ✅ U2a + U2b (see E0/E5/E7 for what is left) |
| E4 | Memory-seed composer + archive (Devin #20/#24) styling vs U1's system; hub panels (Devin #22/#30) vs rail | me | ✅ U2a + U2b (see E0/E5/E7 for what is left) |

| E5 | U2a left 4: #32 a warm light band in the void off the finale room's left wall (source not found; not changed blind); #33 a 5-lane skill tree would scroll; #7 800 px layout; #11 debrief repeats the title (by design) | U2a | ✅ #32 fixed by sign-off (enemy telegraph drawn past the walls → telegraph layer clipped to the room); rest 🙋/✂️ |
| E6 | U2a used a harness (`scripts/ui-matrix.mjs` driving the existing `window.relay.store` debug handle) for states it couldn't reach by play — check that debug handle is dev-only / harmless in production | U2a | ✅ sign-off: `window.relay` exposed live session/controller/store in PRODUCTION → now DEV or `?debug` only (e2e scripts need `?debug` against a built site) |

| E7 | Fable sign-off verdict SHIP WITH NOTES. Not looked at: biome choice screen, a live Custodian telegraph, escape timer, co-op crew strip (Opus audit covered them). For a human designer, 15 min before the demo: Codex rows reading "???"; debrief eyebrow wraps to two lines; Memory Wall rail panel clipped by the Tab button at 720p; room narration caption covers the top wall; law names now wrap to 3 lines (not re-shot) | U2b | ✅ all five closed by the nits pass (Codex locked rows, one-line debrief header, rail clears the menu key, room caption below the wall cap, 3-line law names verified) |

## F · Verification / release — owner: **Q1 (Opus) + Devin #29**
| F1 | Flip decision: floors + laws ON by default? Needs one full solo browser run (5 biomes → boss → escape → relic → hub) + one co-op floors run on merged main | plan | after T1 + Z1 |
| F2 | 4 players inside a run; live generation in co-op; audio audible + mute persists; non-Chromium | C1, QA.md | Q1 what's scriptable; rest 🙋 |
| F3 | Public deployments verified (Pages, Render) | QA.md | Devin PR #34 merged (docs) — Devin's network was blocked from both hosts. I curl-checked 05:27: Pages 200; Render `/api/health` ok, **live generation configured (anthropic)**, cold start ~10 s. Still unverified in a BROWSER on those hosts: boot, provenance labels, wss co-op → Q1 |
| F4 | Two physical laptops on venue Wi-Fi (checklist in `docs/QA_COOP.md`); restart server before demo | C1 | 🙋 |
| F5 | Docs stale: README, QA.md counts, handoffs, evidence for Claude Code work, issue #4 checklist | gaps | Devin next task / Q1 |
| F6 | PR #9 (Devin testing-skill doc) open since yesterday; issues #1–3; ~25 stale branches; repo visibility; rotate the API key pasted in chat | gaps | 🙋 |

## H · Vision + writing consistency (user, 05:20: "make sure EVERYTHING — finished AND planned tasks — is consistent with our vision, and the writing contains NO AI quirks; draw on the research") — owner: **V1 (Fable), after X1 + W2b + Z1 land; and a standing clause in every new agent prompt**
| H1 | Audit ALL player-facing text now on main, not just generated text: strings added tonight by U1 (HUD/menu), F3 (minimap, biome choice, door/room-kind labels), B1 (boss titles, pattern names, tells, escape/relic UI), M1 (law summaries), T1 (terrain captions), Devin (hub Quartermaster cues, record plinths, memory seeds, floors memories, departure ritual), C1 notices, floorgen's derived room names/descriptions + derived biome briefs, `LAW_INFO`/`CUSTODIAN_PATTERN_INFO`/registry summaries — against `docs/WRITING.md` + the research behind it; rewrite offenders | user | ✅ V1/V1b |
| H2 | Permanent test: extract every player-facing static string (registries + UI literals via a small collector) and run `lintProse`; zero hard fails | W1 baseline | ✅ V1/V1b (Opus finished it) |
| H3 | Blind read: 20 unlabelled samples, half ours (live Sonnet output from W2b's last run + fixtures after X1), half short real excerpts from the studied games; reviewer picks the AI ones and says why → new linter rules / exemplars / prompt edits; repeat once | plan | ✅ V1/V1b (Opus finished it) |
| H4 | Vision check against `docs/PRODUCT.md`: honest provenance labels everywhere (fixture vs live vs fallback, derived laws/briefs must not be presented as model-written), memories/NPC lines only from real events, contributions attributed to observable features (ties to A5), no invented runs in seeded screenshots, first-room-within-60 s (ties to C1), co-op is real, unlocks change behaviour not stats; list every violation with file:line and fix or hand to human | user | ✅ V1/V1b (Opus finished it) |
| H6 | **Honesty bug found 05:45:** rewritten fixtures use world laws the sim does not implement (`restless`, `held_breath`, …) → shown to the player, do nothing. Fixtures + `deriveWorldLaws` + the prompt's registry injection must only offer implemented laws; `LAW_INFO` needs an `implemented` flag | me (reading X1) | ✅ V1b: `LAW_INFO.implemented` enforced end to end + test |
| H5 | Planned tasks must carry the same clause: Z1, S1, U2, Q1, P1 prompts each include "player-facing text follows docs/WRITING.md and passes lintProse in a test; nothing may contradict docs/PRODUCT.md's honesty rules" | user | standing |

## I · Onboarding + teaching mechanics as they appear (user, 05:40) — owner: **O1 (Opus: research → design doc → build → screenshot verification), then Fable review gate, then Q1 plays it cold**
| I1 | Think deeply + research how the intro/onboarding should work and how new mechanics get taught as they come up (tiles, sealed doors, room kinds, laws, biome choice, boss tells, escape, relic choice, hub stations, co-op) → `docs/design/ONBOARDING.md` | user | ✅ O1: `docs/design/ONBOARDING.md` (Fan's PvZ principles, CHI 2012 tutorial study, Hodent, progressive disclosure) |
| I2 | ✅ O1 (53 lessons, Field Notes page, `?hints=off|reset`, 62 tests; first room 17 s fast path / ≈35 s human): Implement: first-run hub guidance, just-in-time control prompts that disappear once performed, first-encounter notes shown once per device + a Field Notes menu page, world-entry law briefing; client-side only (no sim changes) | user | O1 |
| I3 | Verify: scripted cold-start playthrough screenshots (solo + co-op guest), prompts never cover the fight, all text passes `lintProse`, can be switched off; Fable review gate; Q1 plays from a wiped profile | user | O1 → gate → Q1 |

| H7 | V1b residual tells: every generated world is still "an institution with forms"; "GET BEHIND THE X" is the new boss-callout formula; two authors in three keep something dated; round-2 blind-read fixes (three-beat tagline template, invented reference codes, stock prop in every rest room, law sentences that give an image not an instruction) are UNVERIFIED live (budget spent) | V1b | ✅ E1 (Fable): 4th exemplar world with no paperwork, ≤1 log-style author, non-institutional author required, 4 callout shapes, fixtures re-textured; verified on 4 live worlds (0/12 callouts "GET BEHIND", 3/4 taglines off the three-beat shape) |
| H8 | Vision audit leftovers: 12 stat-only skill nodes vs PRODUCT.md "new behaviour, not stat %"; derived briefs/boss moves disclosed only in a collapsed provenance note; stale comment `custodian.ts:208` | V1b | skill nodes 🙋 (they stay honestly `planned`); disclosure → E1/U2; comment → Z2 |
| H9 | V1b stripped fixture laws in 23 sim tests (fixtures now really run `the_many`/`committed_strike`) — fine, but means fixture worlds are HARDER than before: re-check solo boss winnability on the three fixtures with their laws ON | V1b | Q1: partially (see J) → Q2 |

| H10 | E1 residual tells (honest list): the seeded document kind gets copied word for word; remains still list pocket contents ("one pen, one key") even after the prompt forbade it; "in a different hand" 3× in 4 worlds; humour drifts to whimsy; boss callouts use briefing-room words ("operative", "sightline"); quoted signage still carries em dashes; `docs/WRITING.md` itself still uses "GET BEHIND…" as an example (E1 could not edit it) so `callout-formula` is only a warning | E1 | ✅ W3 (Opus): all 7 fixed with tests; 4 live worlds → 0 of 7 tells recur (0 em dashes, 0/12 "GET BEHIND"); root cause of pocket lists was OUR prompt shape asking for them |

| H11 | W3 residuals: "<Name>'s handwriting" used 4× in one world (same reflex as "a different hand", now with a bible name → generalise the world-scope rule to handwriting remarks); the engine registry strings in `src/shared/{custodian,laws}.ts` still hand the word "operative" to the laws/callout prompt (it is RELAY's own term, so allowed in UI, but callouts shouted in-world should not use it) | W3 | ✅ handwriting rule generalised by Q1; "operative" in the engine's callout registry strings ✂️ cut (it is the game's own term; callout-vocabulary rule already blocks the briefing-room words) |

| I4 | O1 leftovers: room-kind notes (rest/treasure/lore/elite/exit) unit-tested but never seen in a browser (bot couldn't reach a floors exit); hub rail paragraph now duplicates what the hub prompts say (trim the rail); `tests/integration/realtime.test.ts` flaked once more under load (A17 not fully cured); O1 touched `keyboardFocus.ts` (Digit7–9 for the 7th menu page) | O1 | room-kind notes + flake → Q1 (told); rail duplication + prompt placement/legibility → U2 (incl. the Fable sign-off) |

## J · Q1 final verification results (08:25) — what is STILL unverified
| J1 | **FLIP = NO (Q1's call, I agree):** floors+laws stay OFF by default. Everything observed of floors is good (hub→biome 1, 5 room kinds, tiles, minimap, sealing doors, co-op floors 5/5, Custodian killed solo in 28–31 s via deep link, ritual planted, zero console errors) but **no bot has finished a floors route**, so the floors ENDING (collapse escape → relic choice → hub afterwards) has never rendered in a browser | Q1 | ✅ Q2: the floors ENDING has now been played in a browser (DEV deep link `?tier=4&at=exit`, real input): Custodian 3 phases → ritual → collapse escape 9 hops in 24 s of 216 s → extraction → relic choice → debrief → hub with 16 memories/relic shelf/quartermaster. 13 tier-4 runs: 0 crashes, 0 softlocks, 0 console errors. Flip stays a HUMAN decision 🙋 |
| J2 | Legacy 3-room fixtures: the final arena has no door out, so the collapse escape/relic choice never happen there (falls back to the old ending by design) | Q1 | 🙋 know this for the demo: the new finale is floors-only |
| J3 | **Render deployment serves a STALE pre-flags build** (`/api/config` lacks floors/laws; old hub art) → redeploy from main or don't show it | Q1 | 🙋 (needs Render access) |
| J4 | NOT RUN by Q1: live generation end-to-end in the browser (LIVE label, latency, model laws/look/custodian reaching the game), audio harness (`--only audio` exists), legacy solo run, local production bundle boot | Q1 | ✅ Q2: live gen in browser 49.2 s + 51.2 s to portal-ready, LIVE label honest, model laws/look/biomes/custodian reach the game; audio 4/4; prod bundle 9/9 solo + 5/5 co-op; legacy solo 4/4 |
| J5 | `scripts/coop-e2e.mjs` `headquartersRoom()` replica lacks the relic brackets + records station, so its BFS walks through solid tiles (script-only issue) | Q1 | ✅ Q2 fixed the hub replica + added a drift tripwire test |
| J6 | Survivability 12/12 (4 classes × 3 fixtures, first 5 rooms, authored laws on); crystal-tide hardest (ended 39–48 HP). No tuning change proposed | Q1 | ✅ info → 🙋 |
| J7 | ✅ fixed by Q1: realtime flake root cause; `<Name>'s handwriting` world-scope rule (H11 first half); docs: QA.md rewritten, README, DEMO.md, `docs/evidence/claude-code.md`, issue #4 body ticked | Q1 | ✅ |

| J8 | **Difficulty, not stability, is the floors risk:** at tier 4 (final biome, +18 %/tier scaling stacked on the boss) 7 of 13 bot runs died to the Custodian — every non-Bastion attempt; 4 more were stranded on the escape by dying, none by the timer (14–23 % of the clock used). A by-play full run died in room 2 of crystal-tide. Knobs: `src/sim/tuning.ts` tier scaling, boss HP/hit cap, corrupted-floor tick | Q2 | 🙋 tune before showing a floors finale; or show the finale with Bastion via `?tier=4&at=exit` on a dev server |
| J9 | Q2: three solo-e2e DOM selectors (F5/F6/F8) read stale values (game correct, harness wrong) | Q2 | ✂️ harness-only |

## K · Stretch v2 (draft PR #46, branch `next/v2`, NOT merged)
| K1 | Built on the branch (client render/audio/UI only; zero diff under `src/sim`, `src/shared`, `src/server`; 1108 tests): hit-stop / hit flash / flinch / damage-scaled impact / contact shake; `prefers-reduced-motion` honoured on the canvas + a menu toggle; pitch scatter on repeating audio cues | V2 | 🙋 play it, then merge or not |
| K2 | **Accessibility bug on main today:** the canvas ignores `prefers-reduced-motion` entirely (fixed only on `next/v2`); `drawImpact` is passed a literal `1` at every hit on main | V2 | 🙋 cherry-pick from PR #46 if wanted |
| K3 | Proposed, not built (`docs/design/V2_PROPOSAL.md` on the branch): R4 first-biome ramp + a Death-Defiance-style mercy; R5 treasure rooms offer 1-of-2 attunements; R6 elite/treasure/rest revealed ahead on the minimap; **R7 contributions become in-run artefacts the contributor can trigger once + carried relics seed the next world's prompt** (the agent's pick for "the only uncopyable mechanic"); R8 co-op revive drama; R9 hub filling up. Suggested cuts: 9 unimplemented world laws, 7 menu pages, the long biomes nobody will walk in a demo | V2 | 🙋 |
| K4 | **Contradiction to resolve before turning floors on:** V2's solo-e2e full-run bot on floors died almost immediately (0 door traversals), reproducing Q2's "died in room 2 of Crystal Tide", while Q1 measured 12/12 survival over the first 5 rooms with a different bot. Either biome 1 is too hard or the full-run bot is weak | V2, Q1, Q2 | ✅ D2 resolved it: biome 1 is NOT lethal — the SIM test bot was broken for melee (it retreats below 130 px, Bastion reaches ~50, Shade 42, so they never hit). With a class-aware bot, biome 1 survival with laws on is 99 % across all 12 class×fixture cells (worst 90 %). The real problem is the ENDING: solo Custodian win rate 53 %. Demo preset (branch `tuning/demo-preset`, constants only, 1080 tests green) lifts it to 78 %; crystal-tide stays 20–60 % because `glass_lattice` caps Integrity at 48 (lives in `laws.ts`, not tunable from `tuning.ts`) → **demo on vantage-spire or root-archive** 🙋 |

## L · Release candidate (09:15) — for HUMANS to merge, not the orchestrator
| L1 | Agent R1 is building `release/floors-default`: demo tuning preset merged in, Crystal Tide made viable, floors + laws ON by default with `=0` off switches, full e2e verification incl. one live co-op generation, `docs/RELEASE_FLOORS_DEFAULT.md`. **I will not merge it** - the default flip and the preset were left to you | me | R1 running → 🙋 |
| L2 | Render is still stale although `render.yaml` auto-deploys `main`: R1 is emulating the Dockerfile to find out whether the image fails to build/start; any fix lands on a separate `fix/docker-context` branch, which I may merge as an ordinary bug fix after a green check. Redeploying still needs a human with Render access | me | R1 running |

## M · Judge-facing pass (Sep 20, 11:00 ET) — README rewrite + committed screenshot gallery
| # | Item | From | State |
| --- | --- | --- | --- |
| M1 | **Render is no longer stale (contradicts J3 / L2).** `/api/health` → `ok: true`, `provider: anthropic`, `effectiveMode: live`; through the hosted UI a live Claude world was prepared in **46.4 s** with an honest `LIVE · claude-sonnet-4-6` badge, its first room entered and played, **zero** console errors. `/api/config` → `floors:false, laws:false`, so the hosted game is the legacy three-room shape. Screenshots of that run are the README's beats 3–5 | me | ✅ info |
| M2 | **Co-op finding, not a harness gap:** in today's `coop-e2e --only demo` (18/19) the gate read `1 / 2 READY` on both screens while the **host's `Enter portal` button stayed enabled** — a host can take the crew out before it is ready. Check the gate condition in `HeadquartersPanel` / the readiness flag it reads | me | 🙋 fix or accept |
| M3 | **Harness fixes.** `scripts/solo-e2e.mjs` and `scripts/coop-e2e.mjs` now dismiss the start screen with a real click on its own button; every hub checkpoint after `H3` had been failing since `StartScreen` landed (the overlay intercepts pointer events, so `#contribution` was unclickable). `solo-e2e` also runs the debrief + hub checks (F7/F8) on the **legacy** path, which used to return early because there is no collapse to escape | me | ✅ |
| M4 | `docs/media/` is now the one place screenshots are committed (the README gallery, 15 PNGs, ~4.8 MB). Everything else still goes to `/tmp/relay-shots/`. Provenance of each image and how to regenerate it: `docs/SCREENSHOTS.md` | me | ✅ |

## G · Last
✅ P1 presentation guide merged 08:00 (Devin PR #44: `docs/PRESENTATION.md` — judging research with UNCONFIRMED marks, 5–7 min / 90 s / 20 s pitches, demo runbook + pre-demo checklist + fallback ladder, 15–20 judge Q&A, don't-miss checklist). Needs a final fact-refresh after Q1's flip decision (flags default, test counts) → me at report time.
P1 presentation advice doc → MORNING_REPORT → stretch (tag `overnight-v1`, V2 proposal, `next/v2` draft PR).
