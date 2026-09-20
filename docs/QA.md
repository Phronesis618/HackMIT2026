# RELAY verification

This file distinguishes **verification** from **implementation**. A box is ticked only when the
result was *observed*; a box that was only proved by unit tests says so in its own words; a box
nobody got to is left open with the reason. Nothing here is ticked because the code looks right.

Three words are used precisely:

- **observed** — a person or a scripted browser did the thing and the evidence is named.
- **unit-tested only** — Vitest proves the rule; no browser has run it.
- **unverified** — nobody has done it. The reason is stated.

Last full pass: branch `qa/final-verification`, against merged `main` at `7a279d2` (onboarding).
**Second pass (Q2): branch `qa/fullrun`, against merged `main` at `56be6a0`.** It went after the
boxes the first pass could not reach: the floors ending in a browser, live generation, audio, the
production bundle and legacy solo. Its stage-by-stage record is `docs/QA_FULLRUN.md`; screenshots
under `/tmp/relay-shots/q2/`.
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
- [x] **A biome gate (gatekeeper) and a biome choice, reached by playing — but in CO-OP, not
      solo.** Observed: after 6 door traversals over 7 rooms of `b0-threshold-concourse`, two
      players cleared the exit room and the choice screen offered `b3-kiosk-row` and
      `b5-rope-store`. The guest pressed `1` and was correctly ignored; the host pressed `1` and
      **both screens moved into `b3-kiosk-row`** (`--floors`, checkpoint 9d). The **solo** bot
      never got there inside a 30-minute budget — biome 0's route is longer than its patience,
      and one run ended in a legitimate death four rooms in.
- [x] **A full floors route to the Custodian — reached, and the ending played.** Two things,
      kept apart. **By play: still no.** A second unattended attempt
      (`--only fullrun --minutes 35 --class weaver`) died in the *second* room of `crystal-tide`
      and spent 0.0 minutes of a 35-minute budget; the route is 10/15/20/25/30 rooms over five
      biomes and no solo bot has walked it. **By deep link, then played: yes.** This branch adds a
      DEV-only `?tier=N[&at=exit]` (`import.meta.env.DEV` only; absent from a production bundle)
      that skips a run forward along the world's **own route edges** and can land it on the tier-4
      Anchor room. From there everything was played with real input. Tier 4 was confirmed on
      screen: `tier: 4`, a five-biome path, `Anchor chamber`, `isFinal: true`, the hold-`M` map
      naming all five biomes. See `docs/QA_FULLRUN.md`.

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
- [x] **The collapse escape, the carry-one-relic choice and the hub afterwards — all observed.**
      At tier 4 (`--only floorsend --tier 4 --tier-at exit`, four cold runs) the whole chain
      rendered for the first time: the world's own Custodian (`Adjei, the Seed Vault door`, 1200
      HP, all three phase titles, patterns `siege_charge` / `ring_bloom` / `gravity_well`, down in
      **31 s** with lowest integrity 29/100), the ritual
      `relays#0 → relays#1 → relays#2 → core#3 → discharging#3 → collapse#3` in **12 s**, and then
      **the collapse: it starts, plans a route, unseals every door, loses rooms behind the crew,
      closes its hazard ring, and is drawn with the world's terrain and laws.** The walk was
      **8 room hops in 37 s of a 216 s budget** in the best run. The debrief was correct and in the
      run's own words, `Return to headquarters` worked, and the hub came back with 15 memories, the
      relic shelf, the quartermaster and the records station drawn
      (`/tmp/relay-shots/q2/ending-b/26-hub-after-run.png`).
      **And one run of six went all the way out.** Run `d` (bastion, `vantage-spire`,
      `b7-winch-house-40`): Custodian down in **16 s** at lowest integrity 62/100, ritual in
      **11 s**, then the collapse walked in **9 room hops in 24 s of a 216 s budget — 11 % of the
      clock, hazard rings never past 0/3, integrity 50 → 50, no damage taken on the way out**. It
      reached **`extraction`** (`Clear of the collapse`), was offered **three relic cards derived
      from its own run** — *Brake lever, Winch House 40* / *Cage belt, size M* / *Marshal's load
      rig*, each `REMAINS YOU RECOVERED` — stood on a pedestal with no key and no button, and the
      choice locked (`chosen = remains:9`). The debrief read *"Operative-601 **returned with the
      world anchored**. Deepest point: Winch House 40, tier 5 of 5, 11 rooms in."*
      (`/tmp/relay-shots/q2/ending-d/23-escape.png`, `24-relic-choice.png`, `25-debrief.png`).
      The other five runs ended `stranded` — and *not one of any of them ran out of clock*; they
      used 11–17 % of it and died fighting. Why that is not a verdict on the game is in the next
      box.

- [ ] **Is the escape fair for a human? Walkable — observed once — but the odds are still not
      measured, and the new evidence is harder than the game, not easier.** The budget is `clamp(45 s + 15 s/hop, 60 s, 180 s) × 1.2` solo —
      **72–216 s**; every door opens; a hazard ring closes one tile in from the walls every 25 s,
      capped at 3; a solo operative gets one free last stand at 25 HP. Terrain is the shipped
      `DEFAULT_TERRAIN_INTENSITY = 0.5` and is not re-rolled. The bot walked it in a sixth of the
      clock, so **time is not what killed it**. What killed it is an artefact of the deep link: a
      crew that arrives by `?tier=4&at=exit` has **no attunements, no skill nodes, no unlocked
      `E`, 0 resources**, and must retreat through rooms it never cleared, full of tier-4 enemies
      at `tierMultiplier(4) = 1.72×`, under `long_dark` (vision 206 px). A crew that had walked
      the route would be retreating through rooms it had emptied, with the upgrades those rooms
      paid for. So: the escape **works**; whether it is winnable is still open, and the number
      here is a floor well below the real one. The one run that got out is the one whose Custodian
      fight left it at **62** integrity instead of 17–29; after that the walk home cost it nothing.

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

- [x] **Hub → three rooms → Guardian → ritual → debrief, solo. Observed**, `--legacy --only
      legacy --class bastion`, **4/4** (`/tmp/relay-shots/q2/legacy2/`). `/api/config` reported
      `floors:false, laws:false` and the client adopted it; the world was a three-room legacy world
      (`floors=false`) prepared in **0.2 s** with an `OFFLINE FIXTURE` badge and an honest
      `recorded · not used in this world` receipt; the gate started the run in **1.4 s**; the bot
      walked to **room index 2**, fought the Guardian through **phases 1 and 3**, and completed the
      ritual `relays#0 → relays#1 → relays#2 → core#3 → discharging#3` into the debrief. No
      collapse, as expected — the 3-room fixtures give the final arena no door out.
      The first attempt at this **aborted on a harness bug**: `player.read()` returns `null` while
      the page is mid-navigation and `groupLegacy` dereferenced it. Fixed on this branch
      (commit `13068b7`); the run above is the re-run.

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

`--floors` (flags on), on merged `main`: **5/5 checkpoints passed, 0 skipped**.

- `9e` laws and the look identical on both clients — `the_many` / `committed_strike` / `thin_air`,
  each with its resolved numbers ("Enemy groups 1.8x size, up to 12 per room. Enemy health 0.53x,
  damage -23%."), `lawsDerived:false` (these are authored), string-for-string equal on both.
- `9a` `snapshot.floor` present and identical on both screens.
- `9b` 6 door traversals, alternating who walks through, 7 rooms visited, floor state identical.
- `9c` doors seal in combat on both screens; the guest pushed into a sealed door with real input
  and the crew stayed put.
- `9d` **the gatekeeper and the biome choice, played** — offered `b3-kiosk-row` /
  `b5-rope-store`; the guest pressed `1` and was ignored; the host pressed `1` and both screens
  entered `b3-kiosk-row`.

Not added for lack of time, and therefore **unverified**: an attunement bought by the *guest*
specifically (the purchase path is per-player and is observed solo), and the collapse escape with
two players (unreachable for the same reason it is unreachable solo — see the finale section).

## Audio

- [ ] **Audible sound.** Hearing it is a human check and stays open.
- [x] **WebAudio graph starts only after a gesture; mute persists across reload.** **Observed**,
      `--only audio`, **4/4**, `/tmp/relay-shots/q2/audio/`. Before any input the contexts read
      `["suspended"]`; after one real keypress they read `["running","running"]` and the top bar
      shows `Sound on`. Muting, reloading and re-reading gave `muted before=true, after=true` with
      the control reading `Sound off`. **Zero audio-related console errors** during play.

## External verification

- [x] **A real live-generation run end to end, in a browser. Observed.** Server started with
      `RELAY_GENERATION_MODE=live RELAY_AI_PROVIDER=anthropic RELAY_FLOORS=1 RELAY_LAWS=1` and the
      repo's own `.env` key; `/api/config` reported `generationMode:"live",
      liveGenerationAvailable:true, floors:true, laws:true`. One idea was typed in and `Prepare
      world` pressed with real input. **Portal-ready in 49.2 s.** The receipt read
      **`LIVE · claude-sonnet-4-6`** — not `OFFLINE FIXTURE` — and the contribution was
      **attributed, not just recorded**: *"a signal lamp somebody wired to the handrail"* →
      *lantern in "Signal Lamp Post 3"*. The world the model wrote: title *Relay Station Autumn
      Seven*, laws `committed_strike` / `few_and_terrible` / `long_dark` (all shown `active`), look
      `sodium`, Custodian **"Mina Aguilar, Cable Hall Below Decks"** with three written phase
      titles, four written attunements, eight biomes in the recipe. **Nothing derived was labelled
      LIVE**: the fixture runs in the same pass all carried `OFFLINE FIXTURE` and a
      `recorded · not used in this world` receipt line. 9/9 checkpoints,
      `/tmp/relay-shots/q2/live/`. Not reached: a second live world, and the model's Custodian seen
      in its own final room (the tier deep link was exercised against fixtures only).

- [x] **The local production bundle — built, served and played. Observed.**
      `npm run build && RELAY_FLOORS=1 RELAY_LAWS=1 PORT=6987 npm start`. `GET /` returns **200 in
      2.4 ms**; `/api/health` reports `ok:true, service:"relay"`, its three fixture ids and
      `liveImplemented:true`; `/api/config` reports `floors:true, laws:true`. Driven with
      `scripts/solo-e2e.mjs --only hub --base http://localhost:6987 --debug`: **9/9**, the hub
      renders, the weapon stand works, an idea is recorded, a floors world is prepared, the
      departure ritual runs and room 1 is played — **0 page errors, 0 `console.error`**
      (`/tmp/relay-shots/q2/prod/`). **WebSocket co-op against that same production server:
      `scripts/coop-e2e.mjs --base http://localhost:6987 --only lobby`, **5/5** — two browsers
      join and agree, a third and fourth make 4/4 on every screen, a fifth is refused cleanly, and
      a departed player leaves the crew list after the 30 s server grace
      (`/tmp/relay-shots/q2/coop-prod/`).
      **Note for anyone driving a built site:** `window.relay` is now DEV-or-`?debug` only, so both
      harnesses need the flag — `--debug` on `solo-e2e.mjs`, and `coop-e2e.mjs` now appends
      `&debug=1` itself.
- [x] **GitHub Pages — loaded in a headless browser and it works.**
      `https://phronesis618.github.io/HackMIT2026/` returns 200 in 0.08 s, the hub renders, the
      offline notice reads *"No generation server is reachable. Solo play uses a clearly labelled
      offline fixture."* with a Dismiss control, the top-bar badge reads **PREVIEW · CLIENT
      FIXTURE**, and the onboarding coach prompt (`W A S D Walk.`) is up. One 404 in the console
      for a resource the static host does not have; the game mounts regardless.
      Screenshot: `/tmp/relay-shots/q1/70-pages.png`.
- [ ] **Render — reachable, but it is serving an OLD BUILD.** `GET /api/health` and `/api/config`
      both answer in 0.16 s and report `generationMode:"live", liveGenerationAvailable:true` —
      but **`/api/config` has no `floors` or `laws` fields at all**, which means the deployed
      server predates `src/shared/flags.ts`. The rendered hub confirms it: different palette, the
      old ability bar, "four class shrines" wording, no relic shelf, no quartermaster line, no
      onboarding. Screenshot: `/tmp/relay-shots/q1/71-render.png`.
      **Action for whoever owns the deploy: redeploy `main` to Render before the demo**, or do
      not point a judge at that URL. The thing it serves is not the thing in this repo.
- [ ] Two physical laptops on the presentation LAN. **Unverified** — needs two laptops.


## The flip decision: should floors + laws be ON by default for the demo?

**No. Do not flip.** The criteria set for this decision were: Step 1 completes without a
softlock, crash, console-error spam or desync; the first room arrives within 60 s in live mode;
legacy fixtures and the Pages build are still fine. Measured against those:

| Criterion | Result |
| --- | --- |
| No crash, no console errors, no desync | **Met.** Zero uncaught page errors and zero `console.error` lines across every solo run; co-op 24/24 with flags off. |
| No softlock | **Met as far as anyone got.** Nothing ever hung; the one run that ended early ended in a legitimate death with a correct debrief. |
| Step 1 *completes* | **Q1: not met. Q2: met once, from a deep link.** One run of six played the whole ending — Custodian, ritual, collapse, extraction, relic choice, debrief, hub. It was *positioned* at tier 4 by a DEV deep link rather than walking there, and five of six runs died on the way out under conditions the deep link makes harder than the game. |
| First room within 60 s live | **Met.** Q2 measured one live world: Prepare → portal-ready in **49.2 s**, `LIVE · claude-sonnet-4-6`, contribution attributed. |
| Legacy and Pages still fine | **Met.** Pages: yes (Q1). Production bundle: yes (Q2 — 9/9 solo, 5/5 co-op over WebSocket). Legacy solo: yes (Q2 — 4/4, Guardian and ritual played). |

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

### Q2's amendment to that decision

The live half is now **done**: 49.2 s to portal-ready, honestly labelled. The floors half is
**partly** done, and the precise wording matters, so here it is without hedging:

> **A floors run has been played to its ending in a browser on `56be6a0`** — the tier-4 Custodian
> through all three phases, the three-relay ritual, the collapse, the walk home through terrain,
> **the extraction, the carry-one-relic choice**, the "returned with the world anchored" debrief
> and the hub afterwards, all rendered and driven with real input. The run was **positioned** by a
> DEV-only deep link (`?tier=4&at=exit`), not walked there, and that deep link makes the ending
> *harder* than the game, not easier (no attunements, uncleared rooms on the way out). One run in
> six got out; the other five died fighting, never short of clock.

> Turning floors + laws on by default is `RELAY_FLOORS=1 RELAY_LAWS=1` (server) or
> `?floors=1&laws=1` (client) — **left to the team.** Q2 changed no defaults.

Q2's own read, offered and not acted on: **the bar Q1 set has now been cleared on the letter of
it** — the ending has been played, and one live world reached the portal in 49.2 s. Nothing in six
tier-4 runs hung, crashed, logged an error or left a state a player could not leave; every failure
was a death, handled correctly all the way to the hub. What has *not* been cleared is the spirit
of it: the winning run was 1 of 6, from a position no player reaches, so **how hard the ending is
for a real player with a real route's upgrades is still unmeasured**. The residual risk is not a
crash — it is a judge who beats the Custodian, does not get out, and sees a `stranded` debrief
instead of a relic. That is a tuning question, and a tuning edit hours before a demo would be a
guess dressed as a fix.

## Known limits of the harness itself

- `scripts/coop-e2e.mjs`'s `headquartersRoom()` is a hand-written replica of the hub's tile grid.
  It is still geometrically correct, but it is **missing the props added since**: the five
  `monolith_shard` relic brackets on the north wall (blocking, 1×2 each) and the `records`
  station at (24,8). Its BFS will happily path through those. `scripts/solo-e2e.mjs` reads the
  real room from `session.sim.getRoom()` instead and has no replica to drift.
- **Fixed on `qa/fullrun`:** `groupLegacy` dereferenced a null `player.read()` and aborted the
  whole group; `coop-e2e.mjs` now appends `&debug=1` so it can drive a production bundle.
- **Fixed on `qa/fullrun`:** `coop-e2e.mjs`'s `headquartersRoom()` replica was missing the five
  `monolith_shard` relic brackets on the north wall and the `records` station at (24, 8), so its
  BFS walked through solid props. Both are back, and
  `tests/presentation/coop-harness-hub.test.ts` is now a tripwire: it reads the harness as text
  and fails if the tiles the replica blocks stop matching the tiles `headquartersRoom` blocks, so
  the next prop added to the hub cannot drift silently.
- **Still open (Q2):** checkpoint `F8` reads the hub's *station panels*, which only open when an
  operative stands next to a station; the bot returns to the middle of the hub and reads
  immediately, so F8 fails on a hub that is in fact correct. Fix: walk to the quartermaster and the
  records station before reading. Same shape as `F5`'s `on-screen clock="null"`.
- The solo bot's `?hints=off` silences the onboarding prompts — so a run launched that way cannot
  also verify that the first-encounter notes appear. `--only onboarding` runs `?hints=reset` for
  exactly that, and the room-kind note check reports SKIP (not FAIL) when hints are off.
