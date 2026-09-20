# RELAY — morning report (overnight run, Sun 20 Sep, 03:15 → 09:15 ET)

**main is green and pushed.** 1,080 tests (was 233), typecheck + build pass, CI + Pages deploy passing. ~310 commits since 03:00, 21 PRs merged (14 of them Devin's, each reviewed before merge), +51k lines across 268 files. Nothing was force-pushed; nothing of a teammate's was overwritten.

## 0 · Actions that were denied by the permission system (you asked for these first)
| Time | Action | Why blocked | Outcome |
| --- | --- | --- | --- |
| 03:43 | `gh pr merge 18 --merge` (+ chained `sleep`, `git pull`, `git log`, `ls`) — Devin comment-trigger workflow | "merge without review" of a teammate's PR | You merged it by hand at 03:46. You later had me add the allow rule `Bash(gh pr merge:*)` to the launch folder's `settings.local.json`; I never needed it — every later merge was done locally with a full check first. |

No other denials, from me or from any agent (every agent was asked to report them). Log on the remote: `docs/handoffs/BLOCKED.md`.

## 1 · Read these three things before anything else
1. **Check the real schedule.** Devin's research (`docs/PRESENTATION.md` §1, all marked UNCONFIRMED for 2026) says past HackMITs ended hacking ~**11:45 Sunday**, judged science-fair style (a few minutes per table, top teams then pitch), and submitted on **Plume**, not Devpost. Confirm on the day-of site.
2. **Floors and world laws are OFF by default — on purpose.** Turn them on with `RELAY_FLOORS=1 RELAY_LAWS=1` on the server (clients follow the server) or `?floors=1&laws=1` in the URL. Reason: the floors *ending* (collapse escape → carry one relic → hub afterwards) had not been seen in a browser when I had to decide. See §4 for what the last evidence run found — **decide after reading it.**
3. **The Render deployment is stale** (pre-flags build, old hub). Redeploy from main or don't show it. GitHub Pages is current.

## 2 · What got built (all on main)
| Your ask | State |
| --- | --- |
| **Floors**: 5 biomes deep, 10/15/20/25/30 rooms, Isaac-style graphs, pick 1 of 2 next biomes, themed by the crew's ideas | ✅ behind the flag. Seeded generator (1000-seed fuzz clean), sim + co-op netcode, doors seal in combat, 7 room kinds, minimap + hold-M map, biome choice screen, per-biome art. A sim bot plays 5 biomes → Custodian → ritual → win. Co-op floors verified with two browsers. |
| **Writing with no AI quirks**, researched | ✅ `docs/WRITING.md` (house style from Souls/Hades/Dead Cells/Qud/NetHack/D&D boxed-text/MTG + the Wikipedia/EQ-Bench/antislop catalogues), a prose linter in tests AND in the live repair loop, bible-first staged prompts, 4 exemplar worlds, fixtures rewritten, every static UI string linted by a permanent test. **Live Sonnet numbers:** 8/8 worlds zero hard fails, first room p50 **47 s**, mean lint 2.4 (old fixtures 18.0), **0 truncated lines** (was 56+), blind read run twice, 7 residual tells fixed and re-verified live (0/7 recur). API spend ≈ **$20**. |
| **UI right + bottom** | ✅ Redesigned HUD, rail, command bar; memory wall + controls moved into the menu; then a 36-defect final audit (32 fixed) and a Fable sign-off (**SHIP WITH NOTES**; its 5 notes are fixed). |
| Tiles | ✅ ramping hazard floor (hurts enemies ×1.6), canisters, pits, timed vents, low cover; world-named skins. Built on Devin's PR #16. |
| Boss + finale | ✅ 11-pattern Custodian (world picks 3, names them), gatekeepers preview a move per biome, relics read shorten the ritual, timed collapse escape, carry-one-relic → memory. Floors-only (legacy arenas have no door out). |
| Hub | ✅ (Devin) weapon stands, Quartermaster with event-keyed lines + evidence footer, records, relic shelf, departure ritual, operatives carry weapons, co-op ready-up with a 12 s host override. |
| **AI custom worlds** (your teammate's commit never appeared, so we built it) | ✅ model picks 2–3 **world laws** from a closed registry (9 implemented in the sim; unimplemented ones can never be offered or shown), a **look** (6 palettes, 6 lighting modes, 12 materials, 12 atmospheres), terrain skins, boss moves, 8 biome briefs with layout personality. Offline worlds derive them deterministically, labelled engine-chosen. |
| Skill tree / boons real | ✅ (Devin + Fable gate) 10 attunements live, bought per player per world, server-validated. Class nodes stay honestly "planned". |
| Onboarding | ✅ 53 just-in-time lessons, once-per-device notes, Field Notes menu page, `?hints=off|reset`. First combat ≈17 s fast path / ≈35 s for a human. |
| Co-op "does it actually work?" | ✅ **Yes.** 28/28 scripted two-browser checkpoints incl. reconnect, host succession, revive, full boss, floors, ready gate. 3 real bugs found by playing, fixed with tests. `docs/QA_COOP.md`. |
| Items / currency / shops | 📄 design docs only, as you asked: `docs/design/{ITEMS,ECONOMY}.md`. |
| Presentation advice | ✅ `docs/PRESENTATION.md` (Devin): judging research, 5–7 min / 90 s / 20 s pitches, click-by-click demo runbook, pre-demo checklist, fallback ladder, 15–20 judge Q&As, don't-miss list. |

## 3 · Your to-do list (things no agent could do)
- [ ] Confirm deadline + submission platform (§1.1). Submit.
- [ ] **Decide floors on/off for the demo** (§4). If on: set the two env vars, restart the server.
- [ ] **Two physical laptops on venue Wi-Fi** — 5-minute checklist at the end of `docs/QA_COOP.md`. **Restart the server right before the demo** (a run outlives its players).
- [ ] Redeploy Render from main (or skip it). 
- [ ] **Listen** to the game once (audio was rewritten tonight; only graph/cue assertions were possible).
- [ ] Balance, 10 minutes with `docs/TUNING.md` (one file: `src/sim/tuning.ts`): naive-bot solo boss wins were Shade 6/6, Beacon 3/6, Weaver 3/6, **Bastion 2/6** (deaths from standing in corrupted floor; the fight itself is ~30 s). Hazard ramp 3→15 per 450 ms, env-kill credit 0.5, opening strike capped ×3.
- [ ] **Rotate the Anthropic API key** — it was pasted into chat in plain text. It lives only in gitignored `.env` files (main repo + 4 worktrees under `wt/`).
- [ ] Housekeeping I left for humans: PR #9 (Devin doc, open since yesterday), issues #1–3, ~40 stale branches, repo visibility, the Dark Souls quotes in `docs/WRITING.md` are from memory (flagged there).
- [ ] Known, not fixed: the creation receipt is honest in floors mode but still maps ideas to the 3 legacy room slots, not to biome features. 12 class skill nodes are stat-only and stay "planned". Four operatives crowding the 58 px gate can flip one out of "ready" (host override covers it). `window.relay` debug handle is now DEV/`?debug` only — e2e scripts against a built site need `&debug`.

## 4 · Floors ending — last evidence run
**The floors ending has now been played in a browser** (`docs/QA_FULLRUN.md`), from the final biome's Anchor room via a DEV-only deep link `?tier=4&at=exit` and real input: Custodian through 3 phases (16 s) → relay ritual (11 s) → collapse escape, 9 rooms in 24 s of a 216 s budget → extraction → three relic cards drawn from that run → *"returned with the world anchored"* → hub with 16 memories, relic shelf, Quartermaster line. **13 tier-4 runs: 0 crashes, 0 softlocks, 0 console errors.** Also observed: live generation in the browser (49 s and 51 s to portal-ready, `LIVE · claude-sonnet-4-6`, ideas attributed, the model's laws/look/biomes/boss titles all reached the game), audio cues 4/4, production bundle 9/9 solo + 5/5 co-op, legacy solo 4/4.

**My recommendation: turn floors + laws ON for the demo, and tune difficulty first.** Stability is not the risk; difficulty is. At tier 4, 7 of 13 bot runs died to the Custodian (every non-Bastion attempt), 4 more died during the escape, none ran out of clock (14–23 % used), and a bot playing from room 1 died in room 2 of Crystal Tide. A judge will not reach biome 5 in five minutes anyway — they will see biome 1, the minimap, a gatekeeper and the biome choice, all verified. If you want to *show* the finale, use a dev server with `?world=fixture&floors=1&laws=1&tier=4&at=exit` and play Bastion. Knobs are all in `src/sim/tuning.ts` (tier scaling +18 %/tier, boss HP 1200+400/player, 12 % hit cap, corrupted-floor tick).

## 5 · How the night ran
~25 Claude Code agents (Fable for judgement-heavy work and 5 review gates, Opus for spec-driven builds, Sonnet for tooling) + 14 Devin sessions triggered by issue comments, one orchestrator. Every leftover from every agent went into `FOLLOWUPS.md` (`docs/handoffs/FOLLOWUPS.md`) with an owner; it ends the night with no unowned row. One 5-hour usage limit hit at 05:38 killed two agents; both were resumed with no work lost. Four of the five Fable passes found real bugs (a 3× terrain-damage multiplier, a lost first-victory memory, an escape-route trap, ward misclassification on the boss floor, a production debug handle); the Opus gate on Devin's ready-up found an AFK deadlock. Tracker: `docs/handoffs/FOLLOWUPS.md`. Plan: `HackMIT2026/docs/design/OVERNIGHT_PLAN.md`.

## 6 · For consideration (stretch)
_(filled in at the end if time allowed)_
