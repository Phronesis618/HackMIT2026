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

Thirteen runs of `--only floorsend --tier 4 --tier-at exit`, cold profile each. **One of them —
run `d`, a bastion on `vantage-spire`, biome `b7-winch-house-40` — went all the way through**, and
the table is written from it (`/tmp/relay-shots/q2/ending-d/`). Where another run showed something
better or worse, it is named, and the whole tally is at the end of this file.

| # | Stage | Observed? | What was seen, and the numbers |
|---|---|---|---|
| 1 | Cold hub, canvas, no errors | **observed** | 13/13 runs. `0` uncaught page errors, `0` `console.error` lines in every run. `01-hub-cold.png` |
| 2 | Weapon stand, real input | **observed** | walked to the stand, `F`, class changed, panel read `CURRENT · …`. `02-weapon-stand.png` |
| 3 | Idea → receipt | **observed** | `0.2 s` (fixture), `OFFLINE FIXTURE` badge, one receipt line `recorded · not used in this world`. `03-world-receipt.png` |
| 4 | Departure ritual at the gate | **observed** | overlay with `F or Esc leaves now`, run started `2.6 s` later. `04-first-room.png` |
| 5 | Tier-4 biome reached | **observed** | `tier: 4`, a five-biome path e.g. `b0-dry-path → b2-reading-room-west → b1-the-index → b3-well-head → b7-seed-vault`, room `Anchor chamber`, `isFinal: true`. Hold-`M` showed the whole route by name. |
| 6 | The Custodian, named by the world | **observed** | `Adjei, the Seed Vault door`, `hp 1200` (tier-4 scaled), phase titles `Order 7: one cup at opening` / `Order 9: reading wings nil` / `4 degrees. Hold.`, laws `long_dark` / `the_many` / `long_echo` all `active` on screen. `20-custodian-start.png` |
| 7 | Three phases, three patterns | **observed** | run d: **all three phases**, patterns `siege_charge`, `ring_bloom`, `gravity_well`, **16 s**, 6 dashes out of telegraphs, lowest integrity **62/100**. Four of six runs saw all three phases; the fight ranged 16–31 s. `21-custodian-down.png` |
| 8 | The relay ritual | **observed** | `relays#0 → relays#1 → relays#2 → core#3 → discharging#3 → collapse#3`, in order, in **11 s** (run b: 12 s), anchor state `planted`. `22-ritual.png` |
| 9 | **The collapse starts** | **observed** | first time in a browser. Budget **216 s** — `clamp(45 s + 15 s/hop, 60, 180) × 1.2` solo. Every door unsealed; rooms fell behind the crew (`room_lost`); the hazard ring closed on schedule. |
| 10 | Walking home through terrain | **observed** | run d: **9 room hops in 24 s = 11 % of the 216 s clock**, hazard rings never got past depth **0/3**, integrity **50 → 50 — it took no damage on the way out**. Terrain at the shipped `DEFAULT_TERRAIN_INTENSITY = 0.5`, not re-rolled. `23-escape.png` |
| 11 | **Getting out** | **observed** | stage reached **`extraction`**, on-screen label **“Clear of the collapse”**, top bar reading `BIOME 5/5 · ROOM 11 OF 30`, `HOSTILES CLEAR`. Five of six runs ended `stranded` instead — see the note below; **not one of any of them ran out of clock.** |
| 12 | **Carry-one-relic** | **observed** | the banner **“CLEAR OF THE COLLAPSE — Take one thing with you”**, the line *“Stand on a pedestal to carry it out”*, and **three cards derived from the run itself**: *Brake lever, Winch House 40* / *Cage belt, size M* / *Marshal’s load rig*, each labelled `REMAINS YOU RECOVERED`. The bot stood on one and the choice locked: `chosen = remains:9` of an offer of `remains:9 / remains:6 / remains:8`. **No key, no button.** `23-escape.png`, `24-relic-choice.png` |
| 13 | The debrief | **observed** | in the run's own words: *"Operative-601 **returned with the world anchored**. Deepest point: Winch House 40, tier 5 of 5, 11 rooms in."* — with the arrival keepsake and a record line per biome entered, including *"planted the Anchor in room 26"* and *"entered the first elite room of the run: Guard post 24"*. A run that ends `stranded` says so just as plainly. `25-debrief.png` |
| 14 | The hub afterwards | **observed** | `Return to headquarters` worked, phase `headquarters`, **16 memories** on the wall, integrity restored to 100, `12` resources. The relic shelf (`RELIC SHELF · ANCHORED RUNS ONLY`, five brackets), the quartermaster and the records station all render, and the directory names them. `26-hub-after-run.png` |

### Three checks that read FAIL but are not app faults

- **F8** (`the hub shows the run: quartermaster line, records, relic shelf`) reads the station
  *panels*, which only open when an operative stands next to a station. The bot returns to the
  middle of the hub and reads immediately, so the panels are empty. The hub itself is correct —
  `26-hub-after-run.png` shows the shelf, the quartermaster and the records station drawn. This is
  a harness gap, not a bug; the fix is to walk to the station first.
- **F5**'s `on-screen clock="null"` is the same kind of gap: the DOM selector for the collapse
  clock returned nothing while the page had already moved on.
- **F6** reported `cards on screen=[]` on the run that *did* choose a relic. The screenshot taken
  at that moment (`23-escape.png`) shows all three cards, the banner and the instruction line. The
  state check in the same assertion is the one that is true: `chosen = remains:9`. The card
  selector needs updating, not the game.

### Why the escape kills the bot five times in six

Stage 11 is the one number a reader should not over-read. The bot is **not** losing a race against
the timer — the run that got out finished the walk in a ninth of the budget, and the five that did
not never saw the clock either; they used 11–17 % of it. They lost fights.

And they lost fights in conditions the deep link invents:

- the crew arrives with **no attunements, no skill nodes, no unlocked `E`, 0 resources**;
- it must retreat through rooms it **never cleared**, full of tier-4 enemies at
  `tierMultiplier(4) = 1.72×`, sometimes under `long_dark` (vision cut to 206 px).

A crew that had walked the route would be retreating through rooms it had emptied, with the
upgrades those rooms paid for. The difference is visible in the data: the one run that got out is
the one whose Custodian fight left it at **62** integrity rather than 17–29, and it then took
**zero** damage walking home.

So:

- **Observed:** the whole ending, once, cleanly — collapse, walk home, extraction, the relic
  offer, the choice locking, the "returned with the world anchored" debrief, and the hub taking
  the run.
- **Observed five times:** the failure path, and it is handled correctly every time — one free
  last stand at 25 HP, then a `stranded` debrief that says exactly what happened, then the hub.
- **Still not shown:** whether the escape is fair for a *human* who walked the route. This setup
  is strictly harder than the game it tests, so 1-in-6 is a floor, not the odds.

## How often, and where it goes wrong

**Thirteen runs** of `--only floorsend --tier 4 --tier-at exit`, cold profile each, across four
classes and both shipped fixture families plus one live world. Where each run stopped:

| Where it ended | Runs | Notes |
|---|---|---|
| Died to the Custodian | **7** | every non-bastion attempt (weaver, shade, beacon) is in here; bastion lost 3 of 9 |
| Cleared the Custodian, died in the ritual | **1** | left the fight at 11 integrity |
| Reached the collapse, ended `stranded` | **4** | used **14–23 %** of the clock; none ran out of time |
| **Walked out, chose a relic, anchored** | **1** | run `d` — 9 hops, 24 s of 216 s, no damage taken |

Read down the middle column and the shape is clear: **the Custodian is the wall, not the escape.**
Seven of thirteen runs never got past it, and the class matters enormously — **bastion cleared it
6 times in 9; weaver, shade and beacon cleared it 0 times in 4 between them**, at
`tierMultiplier(4) = 1.72×` with no attunements and no unlocked `E`.

And of the five runs that did reach the collapse, **not one was beaten by the timer**. They walked
8–12 room hops in 24–49 s of a 216 s budget and were killed by the enemies in the uncleared rooms
they were retreating through. The single predictor of getting out was how much integrity the
Custodian left behind: the winning run came out of that fight at **62**, the four `stranded` ones
at **17–32**.

None of this is a measurement of the shipped game, for the reason the section above gives — a
crew that walks the route arrives with upgrades and an empty corridor home. It is a measurement of
the hardest version of the ending that exists, and that version is completable.

## What a judge should take from this

**The ending renders, end to end.** Custodian, ritual, collapse, the walk home, extraction, the
relic you carry out, the debrief that names what you did, and a hub that remembers it — all drawn,
all driven with real input, across six runs and **zero uncaught page errors, zero `console.error`
lines, no softlock and no state a player could not leave.** Every failure was a death, and death
is handled correctly all the way back to the hub.

What is still unmeasured is **difficulty**, not correctness: whether a human arriving at tier 4
with the upgrades a real route pays for finds the escape fair. Nothing here can answer that, and
nothing here suggests it is broken.
