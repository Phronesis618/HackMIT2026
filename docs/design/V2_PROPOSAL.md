# V2 — what to improve next, ranked

Agent V2, on branch `next/v2` (base: `overnight-v1` / `main` @ `7f7bd67`). **This document does not
change main.** It is a ranked list of proposals, each grounded in a source *and* in the code that
would have to move, followed by the subset that was actually built before the hard stop.

Contents: [0 What exists](#0-what-exists-today) · [1 Ranked proposals](#1-ranked-proposals) ·
[2 Difficulty](#2-difficulty-the-one-that-is-actually-broken) · [3 Cut three things](#3-cut-or-simplify-three-things) ·
[4 What I built](#4-what-i-built-now) · [5 For humans](#5-what-humans-should-consider-next) · [6 Sources](#6-sources)

## 0 What exists today

Read before proposing, so nothing here proposes something already shipped.

| Area | What is already there | Where |
|---|---|---|
| Combat FX | 15 procedural draw functions (slash, impact, defeat, shockwave, beam, tether, burn trail…), all deterministic from a seed, all one `Graphics` per effect driven by one tween | `src/client/render/fx.ts` (533 lines) |
| Damage numbers | **already shipped** — `floatText` on `enemy_damaged`, 13 px, 16 px at >= 30 damage, rises 26 px over 650 ms | `RoomScene.ts:989`, `:934` |
| Screen shake | 8 call sites, all `cameras.main.shake()`, 0.004–0.012 intensity | `RoomScene.ts:996,1002,1097,1101,1113,1127,1144` |
| Screen flash | 5 call sites (`anchor_planted`, `room_entered`, two ultimates) | `RoomScene.ts:1074,1079,1102,1128` |
| Audio | 573-line synth layer, mute persisted to `relay.audio.muted` | `src/client/audio/index.ts` |
| Reduced motion | **CSS only** — 5 `@media (prefers-reduced-motion)` blocks. The canvas ignores it entirely. | `src/client/styles/*.css` |
| Tuning | 15 knobs in one leaf module, every value pinned by a test so a stray edit fails the suite | `src/sim/tuning.ts`, `tests/sim/tuning.test.ts` |
| Theme in mechanics | contributions already become `RoomSpec.attributions` -> in-world lore markers you walk into; memory seeds carry between runs | `RoomScene.ts:826+`, `src/client/chronicle/memorySeeds.ts` |

Two findings from that table shape everything below:

1. **The FX vocabulary is rich and the *reaction* layer is thin.** There is a beautiful impact
   burst when you hit something, and the thing you hit does not move, flinch, flash, or make the
   camera notice. Vlambeer's talk is explicit that the cheap half of screenshake is what the
   *target* does, not what the shooter draws.
2. **Reduced motion is honoured in the DOM and violated on the canvas.** Every shake and flash in
   the game fires regardless of `prefers-reduced-motion`. That is an accessibility bug today, and
   it is also the blocker on making the feel pass *stronger* — you cannot responsibly add punch
   without an off switch.

## 1 Ranked proposals

Ranked by impact per minute of work, with the risk that matters here (determinism / co-op) called
out for each. "Client-only" means: no sim tick, no protocol field, no shared constant — two clients
watching the same snapshot can disagree about it and nothing breaks.

### R1 — Reaction layer: hit flash, flinch, damage-scaled impact, contact shake — **built**
*Impact: high. Cost: ~40 min. Risk: none (client-only, render).*

Vlambeer's "The Art of Screenshake" spends most of its runtime on the target's side of the hit:
enemies flash white, get knocked back, the screen shakes on *your* hit and not only on theirs, and
the impact scales with the blow. Jonasson and Purho's "Juice it or lose it" builds the same list
live (squash, flash, shake, particles) and shows each addition separately.

Today `enemy_damaged` draws a burst at a fixed `strength = 1` whatever the damage, and the local
camera does nothing at all when you connect. Concretely:

- **Hit flash** on the struck enemy, white, ~90 ms, decaying. `EntityView` already owns a
  `Graphics` stack inside a container (`RoomScene.ts:738`), so this is one more child drawn from a
  decaying timer in `update()`.
- **Flinch / knockback nudge**, ~7 px along the hit direction, eased back over ~140 ms. Purely a
  render offset: `updateEnemyView` sets `container.setPosition(enemy.x, enemy.y)` from the
  snapshot, so the offset is added on top and decays to zero. **The simulation never sees it**, so
  two clients can render different flinch phases and remain in perfect agreement about the world.
- **Damage-scaled impact**: `drawImpact` already takes a `strength` argument and is always passed
  `1`. Feed it the share of the target's max health the hit took, so a 40 % blow reads as a 40 %
  blow.
- **Contact shake on your own hit**, tiny (0.002–0.006 by damage share), only for hits *you* dealt
  — the thing the game currently never does.

### R2 — Motion settings: `prefers-reduced-motion` on the canvas + a menu toggle — **built**
*Impact: high (accessibility + it unblocks R1). Cost: ~20 min. Risk: none.*

Celeste, Hades and Dead Cells all ship a screen-shake setting; the web platform hands us the
player's answer for free and we ignore it. The audio layer already shows the pattern to copy:
read the OS/browser preference, let a menu toggle override it, persist to `localStorage`
(`relay.audio.muted` at `audio/index.ts:84`).

Ship `relay.motion.reduced`, defaulted from `matchMedia('(prefers-reduced-motion: reduce)')`,
overridable in the Controls page of the menu (`src/client/ui/GameMenu.tsx`). When reduced: shake
amplitude and camera flash go to zero, hit flash drops to a low alpha, flinch stops. **Nothing
informational is removed** — damage numbers, telegraphs, health bars and the impact burst all stay,
because they carry information and shake does not. That distinction is the accessibility rule, not
"turn the effects off".

### R3 — Audio impact layering (pitch scatter + a low shelf on heavy hits)
*Impact: medium-high. Cost: ~25 min. Risk: none (client-only).*

Nijman's cheapest listed trick is randomised pitch on repeated sounds so a burst of hits does not
machine-gun the same sample. We synthesise everything, so a per-hit detune of ±6 % and a
damage-keyed low-frequency thump on heavy blows is a small change in `src/client/audio/index.ts`.
Not built: it needs an ear, and I cannot hear the build.

### R4 — First-biome ramp and a mercy mechanic (difficulty) — **proposed, not built**
See [§2](#2-difficulty-the-one-that-is-actually-broken). Highest *player-facing* impact of anything
here, and the only item on this list that touches the sim, which is why it is not built blind.

### R5 — Treasure rooms that offer 1-of-2 attunements
*Impact: high. Cost: ~90 min. Risk: medium (sim + protocol).*

Hades' boon screen is a choice of three, and the choice is what makes the build yours; Isaac's
pleasure is the synergy you did not plan. `docs/design/ITEMS.md` already specifies this as
"Design B-minus" and the attunement registry already exists — the missing piece is the *offer*: a
treasure room that presents two attunements and takes one. In co-op it needs an owner (whoever
stands on it) or it becomes a loot argument, which is the known failure mode of co-op roguelikes.
The synergy layer that would make it sing is free: world **laws** are already rolled per world, so
"this world's `first_light` law plus the `first_strike` attunement" is a build identity the world
authored — and `openingStrikeMaxMul` already exists precisely because someone found that
interaction. Lean into it: name the pairs in the receipt.

### R6 — Risk/reward legible on the minimap: elite / treasure / rest shown one room ahead
*Impact: high. Cost: ~45 min. Risk: low (client-only if room kinds are already in the plan).*

Slay the Spire's map is a real decision only because you can see what each path costs and pays
*before* you commit; Into the Breach's whole thesis is that perfect information raises tension
instead of lowering it. We already have room kinds, a fog-of-war minimap and a hold-`M` full map
(`src/client/ui/Minimap.tsx`, `FullMap.tsx`). Revealing the *kind* of the adjacent unvisited rooms
— elite, treasure, rest — converts a corridor into a choice at zero simulation cost. Dead Cells'
cursed chest (a real gamble with a stated price) is the natural second step and does need sim work.

### R7 — Theme into mechanics: the artefact you can fire once — **the best idea here, and the most work**
*Impact: very high (it is the pitch). Cost: 3–4 h. Risk: medium-high (sim + protocol + generation).*

The premise is *the crew authored this world together, and only what really happened is remembered*.
Right now authorship is **visible** (attributions become lore markers you walk into) but not
**playable**. Hades' whole design lesson is that the theme should arrive through the mechanic you
use, not the text you read; Outer Wilds makes knowledge itself the progression.

The move: each crew member's accepted contribution becomes one **artefact** carried into the run,
usable once, whose effect is derived from their own idea — and the debrief shows the receipt again
as *what your idea became, and what happened there*. Two properties make it worth the cost:

- It is the only mechanic in the game that **cannot be copied** by another roguelike, because it
  needs the pitch loop.
- It makes failure legible in the crew's own words, which is the Hades trick: the run that died
  still produced something the hub keeps.

Second half, cheaper and nearly as good: **carried relics seed the next world's generation
prompt.** `src/client/chronicle/memorySeeds.ts` already carries memories between runs; feeding the
carried relic into the world recipe closes the loop the tagline promises ("your stories don't").

### R8 — Co-op role clarity and revive drama
*Impact: medium-high for demo, low for solo. Cost: ~60 min. Risk: low-medium.*

Deep Rock Galactic's stickiness is roles you can name and a revive you can fail. We have four
classes and a revive; what we do not have is the moment *reading* as drama — no crew-wide callout,
no downed-teammate direction indicator, no shared "the crew did this" beat. The cheapest version is
entirely client-side: when a crewmate goes down, everyone gets an off-screen arrow and a named
line; when they are picked up, everyone gets the beat. A shared verb ("Rock and Stone") is a
social-glue trick that costs a button and a sound.

### R9 — The hub physically filling up
*Impact: medium (it is the emotional payoff). Cost: ~2 h.*

The relic shelf exists with five brackets and the memory wall counts. The stronger version is
spatial: the hub gets *fuller* the more runs happen, so a returning crew sees their history as
architecture rather than as a list. Hades' House does exactly this and it is the single most
commented-on part of that game's meta layer.

## 2 Difficulty — the one that is actually broken

`docs/QA_FULLRUN.md` is blunt: a solo bot **died in room 2** of a live run and never reached tier 4
by playing, and at the deep-linked ending **5 of 6 runs died to the Custodian or the walk home**,
losing fights rather than the clock (11–17 % of a 216 s budget used). QA is careful to say the deep
link is *strictly harder* than the real game, so 1-in-6 is a floor. But the room-2 death is not a
deep-link artefact. That one is real.

`ONBOARDING.md` already has the doctrine for the fix (kishōtenketsu: introduce safely, develop,
twist, conclude) and does not have the numbers. Proposed, with the caveat that **every one of these
must be bot-measured before it lands** — `tests/sim/tuning.test.ts` deliberately pins all 15
values, so any change fails a test on purpose and forces the conversation:

| Knob | Now | Proposed | Why |
|---|---|---|---|
| first-biome ramp (new) | none | rooms 1–3 of biome 1 at `0.75×` enemy hp/damage, lerping to `1.0×` by room 4 | kishōtenketsu's *ki*: the first rooms teach, they do not test. The bot died in room 2. |
| `tierScalePerTier` | 0.18 | 0.15 | tier 4 goes `1.72×` -> `1.60×`. QA's dead runs are tier-4 fights, and the crew that got out was the one that reached the boss above 60 integrity. |
| `restHealFraction` | 0.40 | 0.45, and **guarantee one rest site per biome from tier 2** | Hades puts a fountain on the route rather than in the loot table; a heal you cannot route to is not a heal. |
| mercy (new) | none | one free stand at 25 hp already exists per run; make the *second* death in the same biome restore to 25 hp once, decaying | Hades' Death Defiance, not Hades' God Mode: a charge, not a difficulty slider, so the run stays honest. |

**Target to hold it to:** a solo `weaver` bot (the class QA used, on `crystal-tide`, the hard
fixture) clears **biome 1 in 3 of 5 runs** with `scripts/solo-e2e.mjs --only fullrun`. Today's
measured number is 0 of 1, in room 2. That is the before/after table this change has to fill in,
and I am not shipping the numbers without it.

**Why I did not build it in the time I had:** a tuning change without the bot run is exactly the
kind of pre-demo edit that looks safe and is not. The measurement is the work, and it does not fit.

## 3 Cut or simplify three things

1. **Eighteen world laws, nine live.** Nine unimplemented laws are nine ways for a world to promise
   something the room does not do, and `docs/PRODUCT.md`'s honesty rules are the best thing about
   this project. Cut the nine to zero or finish two of them; do not ship the list.
2. **Seven menu pages** (`codex / bestiary / operative / skills / controls / fieldnotes /
   memories`). A judge has three minutes. Fold `fieldnotes` into `codex` and `bestiary` into the
   thing you learn by fighting; the menu is competing with the game for the demo's clock.
3. **Five biomes of 10–30 rooms.** QA's own evidence is that nobody — bot or judge — walks 90+
   rooms. The honest demo shape is fewer, denser biomes. This is a *content-shape* cut, not a code
   cut, and it is the one that would most improve the played experience per minute.

## 4 What I built now

Everything in this section is **client-side render and UI only**. No file under `src/sim/`,
`src/shared/` or `src/server/` changed, so there is no determinism or co-op-desync surface: two
clients rendering the same snapshot differently is already true of every particle in `fx.ts`.

- **R2 first** (it gates R1): `src/client/render/feel.ts`, a dependency-free module holding the
  motion preference and the pure easing/intensity functions, unit-tested in
  `tests/client/feel.test.ts`. Reads `prefers-reduced-motion`, overridable and persisted at
  `relay.motion.reduced`, surfaced as a toggle in the menu's Controls page.
- **R1**: hit flash, flinch offset, damage-scaled impact and contact shake in `RoomScene.ts`, every
  one of them multiplied by the motion setting so "reduced" really is reduced.

Before/after evidence, screenshot paths and the check run are in the pull request.

## 5 What humans should consider next

1. **Run the difficulty measurement in §2** before touching any number. It is a 20-minute bot run
   and it is the difference between a tuned game and a guess.
2. **Build R7's artefact**, or at least its cheap half (carried relic seeds the next world's
   prompt). It is the only thing here that no other roguelike can copy, and it is the pitch.
3. **R6's minimap reveal** is the best pure-client win left on the board: a corridor becomes a
   decision for about an hour of work.
4. Decide the content-shape cut in §3.3 before the demo, not during it.

## 6 Sources

- Jan Willem Nijman (Vlambeer), *The Art of Screenshake*, INDIGO 2013 — hit flash on the target,
  knockback, shake on your own hit, impact scaled to the blow, randomised pitch.
  https://www.youtube.com/watch?v=AJdEqssNZ-U
- Martin Jonasson & Petri Purho, *Juice it or lose it*, 2012 — the incremental juice list, each
  effect demonstrated in isolation. https://www.youtube.com/watch?v=Fy0aCDmgnxg
- Steve Swink, *Game Feel: A Game Designer's Guide to Virtual Sensation*, 2008 — real-time control,
  simulated space, polish; polish as the layer that sells the other two.
- Supergiant, *Hades* — boons as a choice of three, death as narrative delivery, Death Defiance as a
  charge rather than a slider, the House filling with evidence of past runs.
- Motion Twin, *Dead Cells* — cursed chests and timed doors as stated-price gambles.
- Mega Crit, *Slay the Spire* — the map as a real decision because the rewards are visible ahead.
- Subset Games, *Into the Breach* — perfect information raising tension rather than lowering it.
- Ghost Ship Games, *Deep Rock Galactic* — nameable roles, shared objectives, revive drama, and a
  social verb as glue.
- Andersen et al., CHI 2012, on tutorials — already cited and applied in `docs/design/ONBOARDING.md`.
