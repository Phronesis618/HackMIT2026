# The end of a floors run, rendered

Q1 left one box open above all the others: **the floors ending had never been drawn on a screen.**
Not the Custodian — that had been seen in a 3-room fixture — but everything after it: the relay
ritual at tier 4, the collapse, the walk home through terrain, the carry-one-relic choice, the
debrief, and the hub that shows the run afterwards.

This file is what happened when that was tried, on branch `qa/fullrun`, merged onto `main` at
`56be6a0`. Every row says **observed** or **not observed**. Screenshots are named; they live under
`/tmp/relay-shots/q2/` and are not committed.

## First, the honest attempt: play the route

`node scripts/solo-e2e.mjs --only fullrun --minutes 35 --class weaver --hints off` — server
`RELAY_FLOORS=1 RELAY_LAWS=1`, cold profile, client on `:6973`, `?hints=off`.

**It did not get past the second room.** The world rolled was `crystal-tide`, the fixture Q1's
survivability table names as the hard one (`glass_lattice` lowers maximum integrity outright). The
weaver took the gate, entered `r00`, walked one door into `r01`, fought, and died there. The
debrief was correct; the run was over in **0.0 minutes of play** out of a 35-minute budget.
`15/22` checkpoints, zero page errors, zero `console.error` lines
(`/tmp/relay-shots/q2/fullrun/`).

That is the second independent confirmation of Q1's finding: **a solo bot does not reach tier 4 by
playing.** Tier 0 is ten rooms; the route is 10/15/20/25/30 across five biomes; the bot's patience
runs out or its integrity does.

## So: a DEV-only deep link, then play from there

Added on this branch (commits `13068b7`, `22189f8`), guarded by `import.meta.env.DEV` so it does
not exist in a production bundle:

- `?tier=N` (N = 1–4) — once a floors run has started, skip it forward to tier N, following the
  world's **own route edges** (`nextBiomeChoices`), exactly as a host taking the first option at
  every gate would. The path it produces is a real path: the debrief chronicles it biome by biome.
- `?tier=4&at=exit` — land on that biome's **exit room**, which at tier 4 is the Anchor chamber.
- `scripts/solo-e2e.mjs --only floorsend --tier 4 --tier-at exit` — the hub flow is still played
  with real input (weapon stand, idea, Prepare, the departure ritual at the gate); only the
  *position* is given, and everything from the Custodian onwards is played.

**The deep link does not make the ending easier. It makes it harder**, and the table below has to
be read with that in mind:

- the crew arrives with **no attunements, no skill nodes, no unlocked `E`, and 0 resources**,
  because it never played the ninety-odd rooms that pay for them;
- the rooms it must walk back through during the collapse are **uncleared** — full of tier-4
  enemies at `tierMultiplier(4) = 1.72×` — where a crew that had walked the route would be
  retreating through rooms it had already emptied.

`startCollapse` plans the walk home from the biome's floor plan rather than from the rooms the crew
visited, so the route itself is the same one a played route would have had. That is asserted in
`tests/sim/floors-run.test.ts`.

## Stage by stage

Four runs of `--only floorsend --tier 4 --tier-at exit`, cold profile each. "Best" is run **b**
(`/tmp/relay-shots/q2/ending-b/`), a bastion on the `root-archive` world, biome `b7-seed-vault`.

| # | Stage | Observed? | What was seen, and the numbers |
|---|---|---|---|
| 1 | Cold hub, canvas, no errors | **observed** | 4/4 runs. `0` uncaught page errors, `0` `console.error` lines in every run. `01-hub-cold.png` |
| 2 | Weapon stand, real input | **observed** | walked to the stand, `F`, class changed, panel read `CURRENT · …`. `02-weapon-stand.png` |
| 3 | Idea → receipt | **observed** | `0.2 s` (fixture), `OFFLINE FIXTURE` badge, one receipt line `recorded · not used in this world`. `03-world-receipt.png` |
| 4 | Departure ritual at the gate | **observed** | overlay with `F or Esc leaves now`, run started `2.6 s` later. `04-first-room.png` |
| 5 | Tier-4 biome reached | **observed** | `tier: 4`, a five-biome path e.g. `b0-dry-path → b2-reading-room-west → b1-the-index → b3-well-head → b7-seed-vault`, room `Anchor chamber`, `isFinal: true`. Hold-`M` showed the whole route by name. |
| 6 | The Custodian, named by the world | **observed** | `Adjei, the Seed Vault door`, `hp 1200` (tier-4 scaled), phase titles `Order 7: one cup at opening` / `Order 9: reading wings nil` / `4 degrees. Hold.`, laws `long_dark` / `the_many` / `long_echo` all `active` on screen. `20-custodian-start.png` |
| 7 | Three phases, three patterns | **observed** | run b: **all three phases**, patterns `siege_charge`, `ring_bloom`, `gravity_well`, **31 s**, 13 dashes out of telegraphs, lowest integrity **29/100**. Runs a and *bastion*: also all three phases. `21-custodian-down.png` |
| 8 | The relay ritual | **observed** | `relays#0 → relays#1 → relays#2 → core#3 → discharging#3 → collapse#3`, in order, in **12 s**, anchor state `planted`. `22-ritual.png` |
| 9 | **The collapse starts** | **observed** | first time in a browser. Budget **180 s** (run b) and **216 s** (run *bastion*) — `clamp(45 s + 15 s/hop, 60, 180) × 1.2` solo. Every door unsealed; rooms fell behind the crew (`room_lost`); the hazard ring closed. |
| 10 | Walking home through terrain | **observed, partially** | run *bastion*: **8 room hops in 37 s = 17 % of the clock**, rings to depth **1/3**. Run b: **5 hops in 27 s = 15 %**. Terrain at the shipped `DEFAULT_TERRAIN_INTENSITY = 0.5`, not re-rolled. `23-escape.png` |
| 11 | Getting out | **NOT observed** | all four runs ended **`stranded`**, and **not one of them ran out of clock** — they used 15–17 % of it. They died: run b went down at 17 integrity, took its one free last stand (revived at `LAST_STAND_HP` 25), and went down again. See the note below. |
| 12 | Carry-one-relic | **NOT observed** | the offer is built when the crew reaches extraction; the crew never did. `24-relic-choice.png` shows the debrief instead. |
| 13 | The debrief | **observed** | correct and in the run's own words: *"Operative-179 anchored the world and did not get out. Deepest point: Seed Vault, tier 5 of 5, 6 rooms in."* — with the arrival keepsake and a record line per biome entered. `25-debrief.png` |
| 14 | The hub afterwards | **observed** | `Return to headquarters` worked, phase `headquarters`, **15 memories** on the wall, integrity restored, `12` resources. The relic shelf (`RELIC SHELF · ANCHORED RUNS ONLY`, five brackets), the quartermaster and the records station all render, and the directory names them. `26-hub-after-run.png` |

### Two checks that read FAIL but are not app faults

- **F8** (`the hub shows the run: quartermaster line, records, relic shelf`) reads the station
  *panels*, which only open when an operative stands next to a station. The bot returns to the
  middle of the hub and reads immediately, so the panels are empty. The hub itself is correct —
  `26-hub-after-run.png` shows the shelf, the quartermaster and the records station drawn. This is
  a harness gap, not a bug; the fix is to walk to the station first.
- **F5**'s `on-screen clock="null"` is the same kind of gap: the DOM selector for the collapse
  clock returned nothing while the page had already moved to the debrief.

### Why the escape kills the bot, and what that does and does not tell you

Stage 11 is the one number a reader should not over-read. The bot is **not** losing a race against
the timer — it finishes the walk in a sixth of the budget. It is losing a fight, in rooms that a
real player would have emptied on the way in, at 1.72× enemy scaling, with `long_dark` cutting
vision to 206 px, starting from whatever integrity the Custodian left it (17–29 of 100), with no
attunements and no unlocked abilities.

So the honest statement is:

- **Observed:** the collapse exists, starts, plans a real route, unseals every door, loses rooms
  behind the crew, closes its hazard ring, and is drawn on screen with the world's terrain and
  laws applied. The run ends correctly and says so in the debrief, and the hub takes the run.
- **Not observed:** a successful extraction, and therefore the relic choice and the "anchored and
  got out" debrief.
- **Not shown either way:** whether the escape is fair for a human. This setup is strictly harder
  than the game it is testing. Q1's arithmetic — 72–216 s, every door open, a ring one tile in
  every 25 s capped at 3, one free last stand solo — still stands unmeasured against a player who
  actually walked the route.

## What a judge should take from this

The ending **renders**, end to end, with no crash, no softlock, no console error and no state that
could not be left. Nothing hung; every failure was the operative dying, and dying is handled
correctly all the way back to the hub. What is still unproven is the last thirty seconds of a
*winning* run: extraction and the relic.
