# RELAY verification

This file distinguishes **verification** from **implementation**. A box is ticked only when the
result was *observed*; a box that was only proved by unit tests says so in its own words; a box
nobody got to is left open with the reason. Nothing here is ticked because the code looks right.

Three words are used precisely:

- **observed** — a person or a scripted browser did the thing and the evidence is named.
- **unit-tested only** — Vitest proves the rule; no browser has run it.
- **unverified** — nobody has done it. The reason is stated.

Last full pass: branch `qa/final-verification`, against merged `main` at `7a279d2` (onboarding).
Harnesses: `scripts/solo-e2e.mjs` (one browser, plays solo), `scripts/coop-e2e.mjs` (two to five
browsers, plays co-op), `scripts/shot.mjs` (screenshots). All three drive **real keyboard and
mouse input only** and read state read-only from the DOM and the `window.relay` handle the client
already exposes. Nothing is injected; there are no test hooks in the app. Screenshots land under
`/tmp/relay-shots/` and are never committed.

## Automated checks

- [x] `npm run check` — typecheck, full Vitest suite, production build. **1073 tests, 88 files,
      green** on this branch (was 1009 before the onboarding merge and this branch's two fixes).
- [x] Deterministic sim: combat, cooldowns, class abilities, unlocks, down/revive, Anchor
      outcomes, floors routing, laws, terrain, the Custodian's three phases, the collapse.
- [x] Two real WebSocket clients share authoritative snapshots, events and contributions.
- [x] `tests/integration/realtime.test.ts` — the flake had a cause and it is fixed: one block
      waited for the operative to walk past `x > 80` and asserted twenty lines later that a swing
      had happened, so whether it had depended on how many poll intervals the walk needed. It now
      waits for both facts. Ran 5× alone and once in the full suite, green.
- [x] `validateRoomSafety` fuzz over 1000+ generated rooms with every combat tile switched on.

## Solo, floors + laws ON, in a browser (`scripts/solo-e2e.mjs`)

Server started with `RELAY_FLOORS=1 RELAY_LAWS=1`; client on `:6973`; cold browser profile
(new context, empty `localStorage`) for every run.

- [x] **Cold boot** — hub renders, canvas mounts, headquarters directory present, `0` memories,
      **zero uncaught page errors and zero `console.error` lines** across every run in this pass.
- [x] **Server is the flag authority** — `GET /api/config` reports `floors:true, laws:true` and
      the client adopts it (`src/shared/flags.ts`).
- [x] **Weapon stand** — walked to the Shade stand with WASD, pressed `F`, class went
      `bastion → shade`, station panel read `CURRENT · Twin phase blades`.
- [x] **Idea → receipt** — one idea typed into `#contribution`, submitted with Enter, echoed in
      the contributions list; `Prepare world` produced a world in **0.2 s** (fixture) with the
      `OFFLINE FIXTURE` provenance badge and one receipt line marked
      `recorded · not used in this world`.
- [x] **The world carries what the model is supposed to write** — laws, look, Custodian title and
      three phase titles, terrain skins and four attunements, all named on screen. Example
      (Vantage Spire): laws `the_many / committed_strike / thin_air`, all three shown `active`,
      look `ink_neon`, Custodian "Osei, Winch House 40".
- [x] **Departure ritual** — pressed the real `Enter portal` button, the
      `[data-testid="hq-departure"]` overlay ran with its `F or Esc leaves now` hint, and the run
      landed in room 1 **2.6 s** later (`DEPARTURE_COUNTDOWN_MS` is 2400).
- [x] **Floors state** — `snapshot.floor` carries biome, room id, tier, path and a fog-of-war map.
- [x] **Minimap and hold-M map** — minimap on screen reading `1/10 rooms · Hold M · map`; holding
      `M` opened the full floor map headed with the biome name; releasing it closed it.
- [x] **Doors seal and unseal** — in a hostile room `doorsLocked` was true, the bot walked into
      the door with real input and stayed in the room; after the clear it went false.
- [x] **Room kinds entered** — `entrance`, `combat`, `rest`, `treasure`, `lore` observed across
      runs. Screenshots per kind in `/tmp/relay-shots/q1/12-roomkind-*.png`.
- [x] **Terrain tiles** — conduit, rubble, hazard floor and breakable wall observed in played
      rooms, read from the room's own `tiles`.
- [x] **All three shipped fixtures entered** with their authored laws on — see the table below.
- [ ] **A biome gate (gatekeeper) and a biome choice, reached by playing.** **Unverified.** The
      bot never reached a `biome_exit` room inside a 30-minute budget: biome 0's route is longer
      than the bot's patience and one run ended in a legitimate death four rooms in. Both are
      **unit-tested** (`tests/sim/floors-run.test.ts`) and the co-op script reaches them
      (`docs/QA_COOP.md` 9d). The UI, keys and host-only rule are read from source, not seen.
- [ ] **A full floors route to the Custodian, played.** **Unverified**, same reason. The route is
      five tiers (`b0 → … → b7`) with room budgets 10/15/20/25/30; a bot that fights honestly does
      not get through it in the time this pass had.

## The end of a run (`--only finale`)

Reached with the repo's own deep-link `?world=fixture&room=2&laws=1`, and again by walking rooms
1–3 on foot (`--finale-entry play`). Both with the fixture's authored laws ON.

- [x] **The Custodian** — the final room holds it, named and phased by the world. Solo **bastion**
      killed it in **28–31 s** over two independent runs, seeing **all three phases** and three
      patterns (`siege_charge`, `ring_bloom`, `gravity_well`), with lowest integrity **54–62 / 100**.
      Eight or nine dashes out of telegraphs per fight.
- [x] **Phase 3** reached both times.
- [x] **The relay ritual** — `relays#0 → relays#1 → relays#2 → core#3 → discharging#3`, in order,
      in **10 s**, anchor state `planted`.
- [ ] **The collapse escape, carry-one-relic, and the hub showing the run afterwards.**
      **Unverified in a browser — and the reason is a fact about the shipped worlds, not a bug.**
      `startCollapse` needs a route from the anchor room back to the way in. The three shipped
      **3-room fixtures give the final arena no door out** (room 2's `tiles` contain no `X`), so
      `planEscape` finds no route and the run ends at the discharge — exactly as `startCollapse`'s
      own comment says it will. The collapse is therefore reachable **only from a floors route**,
      which is the box above. It is **unit-tested**: `tests/sim/finale-escape.test.ts` (rules,
      determinism) and `tests/sim/escape-terrain.test.ts` (a three-operative bot walks it on foot
      over pits, vents, hazard floor, canisters and cover).
- [ ] **Is the escape fair for a human?** **Judged from the numbers, not observed.** The budget is
      `clamp(45 s + 15 s/hop, 60 s, 180 s) × 1.2` solo — **72 s minimum, 216 s maximum**; every
      door opens; a hazard ring closes one tile in from the walls every 25 s, capped at 3; a solo
      operative gets one free last stand at 25 HP; revives are halved to 1 s. The terrain the crew
      walks back through is **not** re-rolled — it is the same tiles it fought on, at the shipped
      `DEFAULT_TERRAIN_INTENSITY = 0.5`. The sim test that exercises this was tuned down to
      `intensity: 0.4` with the comment that five biomes at the top of the band "is not a walk
      out, it is a wipe", so **0.5 has never been walked end to end by anything**, bot or human.
      That is the honest state of it.

## Solo survivability, first five rooms, authored laws ON

`scripts/solo-e2e.mjs --only fixtures --class <id>`. Each row is one cold profile: pick the class,
take the gate, then enter five distinct rooms of biome 0, fighting whatever is in them. `hpLow` is
the lowest integrity the run ever showed out of 100.

| class | fixture (its authored laws) | rooms entered | rooms with a fight | cleared | integrity at the end | lowest seen | dashes out of a telegraph | outcome |
|---|---|---|---|---|---|---|---|---|
| bastion | vantage-spire (`the_many`, `committed_strike`, `thin_air`) | 5 | 3 | 3 | 95 | 95 | 4 | **survived** |
| bastion | root-archive (`long_dark`, `the_many`, `long_echo`) | 5 | 3 | 3 | 89 | 89 | 3 | **survived** |
| bastion | crystal-tide (`tidal_drag`, `glass_lattice`, `few_and_terrible`) | 5 | 3 | 3 | 39 | 39 | 2 | **survived** |
| shade | vantage-spire | 5 | 3 | 3 | 100 | 100 | 3 | **survived** |
| shade | root-archive | 5 | 3 | 3 | 100 | 100 | 3 | **survived** |
| shade | crystal-tide | 5 | 3 | 3 | 42 | 42 | 1 | **survived** |
| beacon | vantage-spire | 5 | 3 | 3 | 100 | 100 | 1 | **survived** |
| beacon | root-archive | 5 | 3 | 3 | 96 | 100 | 3 | **survived** |
| beacon | crystal-tide | 4 | 2 | 2 | 39 | 39 | 2 | **survived** |
| weaver | vantage-spire | 5 | 3 | 3 | 100 | 100 | 2 | **survived** |
| weaver | root-archive | 5 | 3 | 3 | 100 | 100 | 2 | **survived** |
| weaver | crystal-tide | 5 | 4 | 4 | 48 | 48 | 1 | **survived** |

**Twelve cells, twelve survivals. No class is non-viable solo through biome 0.** Notes an honest
reader needs:

- **`crystal-tide` is the hard one, for every class** — its `glass_lattice` law lowers maximum
  integrity outright, so the 39–48 figures are most of a *smaller* bar, not a third of a full
  one. It is the fixture to show a judge who wants to feel pressure, and the one that will kill
  a careless player first.
- **Biome 0 is the shallow end.** Tier 0 rooms carry 4–6 points of enemy budget and every enemy
  is scaled by `tierMultiplier(tier) = 1 + 0.18·tier`, i.e. ×1.0 here and ×1.72 in the finale
  biome. These rows say nothing about tier 3 or 4.
- **`beacon` on `crystal-tide` entered four rooms, not five** — it ran out of unvisited doors
  inside its budget, not out of health.
- One earlier run (before the bot learned to step off hazard tiles) **did die** four rooms into
  `vantage-spire`, and the debrief handled it correctly: *"Operative-400 watched the world
  collapse. Deepest point: Threshold Concourse, tier 1 of 5, 4 rooms in."* A solo death ends the
  run — there is no partner to lift you, and the free last stand only exists during the collapse.
  That is the design, and it is the sharpest edge a solo judge will meet.

**No `src/sim/tuning.ts` change is proposed.** Nothing in this table justifies one, and a tuning
edit hours before a demo, unverifiable past biome 0, would be a guess dressed as a fix.

Read it as a floor, not a ceiling: this is a scripted bot that aims with the mouse, taps `J`,
spends `Q/E/R` off cooldown, dashes out of telegraphs and steps off hazard tiles. A human plays
better than it. It is still the only end-to-end number anyone has.

## Legacy mode, flags OFF

- [ ] Hub → three rooms → Guardian → ritual → debrief, solo, one class. **Unverified this pass**
      (the browser time went to floors). Co-op covers the same path with two players and is
      observed: `docs/QA_COOP.md`, scenario 7c.

## Co-op (`scripts/coop-e2e.mjs`)

`node scripts/coop-e2e.mjs --only lobby,demo` on merged `main`, **flags off**: **24/24
checkpoints passed, 0 skipped** (`/tmp/relay-shots/coop/results.json`). That includes the new
co-op **READY gate** at the departure gate — `4c` one operative at the gate shows `1 / 2 READY`
on both screens and the host cannot enter; `4d` both at the gate shows `2 / 2 READY` and the host
may — and `6f`, a guest going offline still lets the host start the run.

Also observed in that table: 4/4 lobby with a fifth player refused cleanly, departed crew pruned,
classes and ideas agreeing on both screens, guest cannot press Prepare, both land in room 1 of the
same world, movement syncs both ways with measured latency, enemy HP and room clear agree, the E
unlock is per-player, a downed player shows as downed on both screens, hold-`F` revive, the
collapse debrief on both screens, host-only return, and memories on each device.

`--floors` (flags **on**) adds the floors group, plus a checkpoint added on this branch:

- `9e` **laws and the look are identical on both clients** — the resolved law list with its real
  numbers, whether they were derived or authored, and the look, compared string-for-string across
  both browsers. This is what server-authoritative flags exist to guarantee
  (`src/shared/flags.ts`).

<!-- COOP_FLOORS -->

Not added for lack of time, and therefore **unverified**: an attunement bought by the *guest*
specifically (the purchase path is per-player and is observed solo), and the collapse escape with
two players (unreachable for the same reason it is unreachable solo — see the finale section).

## Audio

- [ ] **Audible sound.** Hearing it is a human check and stays open.
- [ ] WebAudio graph starts after a gesture; mute persists across reload. **Unverified this pass.**
      `scripts/solo-e2e.mjs --only audio` exists and wraps `AudioContext` from an init script to
      watch its state without changing behaviour, but it was not run before the deadline.

## External verification

- [ ] **A real live-generation run end to end.** **Unverified this pass.** The server reports
      `liveConfigured:false` unless `RELAY_GENERATION_MODE=live` is set with a key; the harness
      and the flags are in place (`--env RELAY_GENERATION_MODE=live`) but no live world was
      prepared inside the deadline. Earlier live evidence: `docs/design/BLIND_READ.md`.
- [ ] **The public Pages URL and the Render service, loaded in a browser.** **Unverified this
      pass.**
- [ ] Two physical laptops on the presentation LAN. **Unverified** — needs two laptops.


## The flip decision: should floors + laws be ON by default for the demo?

**No. Do not flip.** The criteria set for this decision were: Step 1 completes without a
softlock, crash, console-error spam or desync; the first room arrives within 60 s in live mode;
legacy fixtures and the Pages build are still fine. Measured against those:

| Criterion | Result |
| --- | --- |
| No crash, no console errors, no desync | **Met.** Zero uncaught page errors and zero `console.error` lines across every solo run; co-op 24/24 with flags off. |
| No softlock | **Met as far as anyone got.** Nothing ever hung; the one run that ended early ended in a legitimate death with a correct debrief. |
| Step 1 *completes* | **Not met.** Nobody — bot or human — has played a floors route to the Custodian. The last two minutes of that path (collapse escape, carry-one-relic, the hub showing the run) have never run in a browser at all. |
| First room within 60 s live | **Not measured.** No live world was generated this pass. |
| Legacy and Pages still fine | **Not measured this pass.** Legacy solo was not re-run; the Pages artifact and the Render service were not loaded. |

The argument for flipping is real: everything observed of floors is good. The hub, the receipt,
the departure ritual, sealing doors, the minimap and hold-`M` map, five room kinds, terrain tiles,
the three-phase Custodian, the relay ritual and twelve of twelve solo survivability cells are all
green, with laws visibly active and honestly labelled.

The argument against is decisive: **flipping makes the demo's default path one whose ending
nobody has seen.** A judge who plays to the end of a floors run reaches code — the collapse, the
extraction, the relic choice — that is unit-tested and has never been rendered. Legacy mode's
ending *has* been played, by two people, on two screens (`docs/QA_COOP.md` 7c). Defaulting to the
path with the observed ending is the smaller risk, and it costs one environment variable to
change your mind.

**Nothing is being hidden by this.** Floors and laws are one flag away and the demo script says
so; `RELAY_FLOORS=1 RELAY_LAWS=1` on the server, or `?floors=1&laws=1` in one browser.

**What would flip it:** one floors run played to the Custodian with the collapse and the relic
choice observed on screen, plus one live generation reaching the first room inside 60 s. Both are
a single unattended `scripts/solo-e2e.mjs --only fullrun --minutes 45` and one live run away —
they were a time budget short, not a blocker.

## Known limits of the harness itself

- `scripts/coop-e2e.mjs`'s `headquartersRoom()` is a hand-written replica of the hub's tile grid.
  It is still geometrically correct, but it is **missing the props added since**: the five
  `monolith_shard` relic brackets on the north wall (blocking, 1×2 each) and the `records`
  station at (24,8). Its BFS will happily path through those. `scripts/solo-e2e.mjs` reads the
  real room from `session.sim.getRoom()` instead and has no replica to drift.
- The solo bot's `?hints=off` silences the onboarding prompts — so a run launched that way cannot
  also verify that the first-encounter notes appear. `--only onboarding` runs `?hints=reset` for
  exactly that, and the room-kind note check reports SKIP (not FAIL) when hints are off.
