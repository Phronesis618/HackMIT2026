# The demo tuning preset — and why the difficulty evidence contradicted itself

Measured on branch `qa/difficulty` with **`scripts/difficulty-report.ts`** (`npx tsx`), sim-level,
no browser: 3 fixtures × 4 classes × 10 seeds × laws ON and OFF, biome 1 played room by room, plus
a solo tier-4 Custodian fight from the Anchor room. Raw JSON and the printed table are in
`/tmp/relay-difficulty/` (`baseline.json`, `preset.json`, `report.txt`); they are not committed.

Reproduce:

```
npx tsx scripts/difficulty-report.ts --seeds 10 --preset --out /tmp/relay-difficulty
npx tsx scripts/difficulty-report.ts --render --preset --out /tmp/relay-difficulty   # re-print only
```

---

## 1. The contradiction: the bot was bad, and biome 1 is not lethal

**Q1 was right and Q2/V2 were measuring their bot, not the game.**

`tests/sim/floorsBot.ts` `fightIntent` retreats from its target whenever the target is nearer than
a **hard-coded 130 px**:

```ts
if (!sight || d > 200) move = steerIntent(...);       // close
else if (d < 130) move = { away from target };        // back off
else move = { strafe };
```

But the reach a class actually needs is `CLASS_COMBAT[classId].range` (`src/sim/combat.ts`):

| class | weapon range | can it ever attack under the 130 px rule? |
| --- | --- | --- |
| beacon | 240 | yes — it kites inside its own range |
| weaver | 135 | yes, barely |
| bastion | `ATTACK_RANGE` (~50) | **no** — it backs off at 130 px and never closes |
| shade | 42 | **no** |

So a melee operative under the shipped bot walks backwards, never lands a hit, and absorbs damage
until it dies. That is a **bot defect, not a difficulty signal**, and it is the single biggest
confound in every earlier number. The same defect is the reason a 5-room Q1 sample (shallow rooms,
small packs) looked fine while a 10-room Q2 run did not.

Swapping in a **class-aware kite band** (close to 0.75 × the class's own range, back off below
0.45 ×; otherwise the identical bot — same hazard stepping, same Q/E/R, plus a dash out of a
resolving telegraph) and changing nothing else in the game:

| biome 1, laws ON, 10 seeds | shipped `floorsBot` | class-aware bot | both on **unchanged** `tuning.ts` |
| --- | --- | --- | --- |
| vantage-spire / bastion | **10 %** | **90 %** | |
| crystal-tide / bastion | **0 %** | **100 %** | |
| crystal-tide / shade | **30 %** | **100 %** | |
| overall (12 class×fixture cells) | 76 % | **99 %**, worst cell 90 % | |

**Biome 1 is already ≥ 90 % for every class on every fixture on main as shipped.** No tuning change
is needed to make biome 1 safe for a demo. Nothing in room 2 of crystal-tide is a trap; the bot
simply could not fight.

### Where the fixtures *do* genuinely differ (and why crystal-tide got blamed)

Resolved law effects, from `resolveLaws` on each fixture's authored recipe:

| fixture | laws | **player max HP** | enemy count | enemy HP | enemy dmg | player dmg |
| --- | --- | --- | --- | --- | --- | --- |
| vantage-spire | `the_many`, `committed_strike`, `thin_air` | 100 | ×1.8 | ×0.525 | ×0.775 | ×1.25 |
| **crystal-tide** | `tidal_drag`, **`glass_lattice`**, `few_and_terrible` | **48** | ×0.55 | **×2.2** | ×1.275 | ×1.80 |
| root-archive | `long_dark`, `the_many`, `long_echo` | 100 | ×1.8 | ×0.525 | ×0.775 | ×1.00 |

`glass_lattice` at intensity 0.5 sets max Integrity to **48, not 100** (`lerp(60, 35, i)` in
`src/sim/laws.ts`), and `few_and_terrible` makes each enemy ×2.2 HP and ×1.275 damage. crystal-tide
is a genuine glass-cannon world — the crew kills 1.8× faster and dies to four hits instead of ten.
That is a real, large difficulty difference, and it is why crystal-tide was the world Q2 happened to
roll and die in. It is **not**, on the evidence, lethal in room 2 to a competent operative.

`the_many` on root-archive is the *opposite* of a threat: more enemies, each at ×0.525 HP and
×0.775 damage. root-archive is the safest of the three.

---

## 2. What the preset is actually for: the tier-4 Custodian

Biome 1 needed nothing. The **ending** did. On shipped tuning, a solo operative wins the tier-4
Custodian **53 %** of the time overall and **0–40 %** on half the class×fixture cells — matching
the "7/13 runs died to the Custodian, every non-Bastion" observation.

### Before → after (laws ON, 10 seeds each, solo)

| | biome 1 clear (worst cell) | Custodian win (overall) | Custodian win (worst cell) | Bastion avg win time |
| --- | --- | --- | --- | --- |
| **before** (main) | 99 % (90 %) | **53 %** | **0 %** | 55.5 s |
| **after** (preset) | 99 % (90 %) | **78 %** | 20 % | 39.5 s |

Custodian win rate per cell, laws ON:

| fixture | bastion | shade | beacon | weaver |
| --- | --- | --- | --- | --- |
| vantage-spire | 50 % → **90 %** | 80 % → **100 %** | 100 % → **100 %** | 90 % → **90 %** |
| crystal-tide | 30 % → **60 %** | 30 % → 20 % | 0 % → 30 % | 10 % → **50 %** |
| root-archive | 40 % → **100 %** | 40 % → **100 %** | 90 % → **100 %** | 80 % → **90 %** |

Bastion average win time after the preset: vantage-spire **34.6 s**, crystal-tide **24.5 s**,
root-archive **52.9 s** — all comfortably above the 20 s "don't trivialise it" floor. Every
Custodian loss is still `custodian phase 3`, i.e. the fight still reaches its last phase.

### The target that was NOT met, and why

The brief asked for **≥ 60 % for every class on every fixture**. The preset reaches that on
**vantage-spire (90–100 %) and root-archive (90–100 %)**, but not on **crystal-tide**
(20–60 %).

That is not a knob that was left unturned — **it is not reachable from `tuning.ts` at all.**
crystal-tide's problem is the 48-HP cap that `glass_lattice` imposes, and player max Integrity lives
in `src/sim/laws.ts`, which `docs/TUNING.md` explicitly lists under *"What is deliberately NOT
here"*. Every lever that `tuning.ts` does own (boss HP, hit cap, tier scaling, floor damage) was
pushed to the edge of its documented safe range and crystal-tide still tops out near 50 %.

**Recommendation for the demo:** turn floors ON and demo on **vantage-spire or root-archive**, where
biome 1 is ~100 % and the Custodian is 90–100 % with the preset. If crystal-tide must be demoable at
the same odds, that is a `laws.ts` change (raise the `glass_lattice` band from `lerp(60, 35, i)`
toward `lerp(75, 55, i)`), with its own test — deliberately **not** included here, because it would
stop this being a pure-constants change.

---

## 3. The preset — exact diff for `src/sim/tuning.ts`

Every value is inside the safe range `docs/TUNING.md` already publishes for that knob. Nothing
outside `DEMO_TUNING` changes.

```diff
--- a/src/sim/tuning.ts
+++ b/src/sim/tuning.ts
@@ export const DEMO_TUNING = {
   /** Custodian health for a solo operative. The whole fight length keys off this. */
-  bossHpBase: 1200,
+  bossHpBase: 850,
@@
-  bossHitCap: 0.12,
+  bossHitCap: 0.18,
   /** A corrupted conduit (and a live flood tile) hurts whoever stands on it this often... */
-  corruptedFloorTickMs: 600,
+  corruptedFloorTickMs: 900,
   /** ...for this much, per tick. Flood tiles carry their own pattern damage instead. */
-  corruptedFloorDamage: 10,
+  corruptedFloorDamage: 6,
@@
   /** One '~' damage tick per this many ms of standing still in it. */
-  hazardIntervalMs: 450,
+  hazardIntervalMs: 600,
   /** The ramp's step: tick n deals `hazardBase * n`, so 3, 6, 9, 12, 15 at the default. */
-  hazardBase: 3,
+  hazardBase: 2,
   /** The ramp stops here, so standing in fire is survivable for a known number of seconds. */
-  hazardStackMax: 5,
+  hazardStackMax: 4,
@@
   /** Enemy health and damage grow by this much per biome tier. Tier 0 is the legacy numbers. */
-  tierScalePerTier: 0.18,
+  tierScalePerTier: 0.1,
   /** Share of max Integrity a rest site restores to every living operative, once per run. */
-  restHealFraction: 0.4,
+  restHealFraction: 0.6,
 } as const;
```

| knob | from | to | safe range | why |
| --- | --- | --- | --- | --- |
| `bossHpBase` | 1200 | **850** | 800–1800 | the single biggest lever on solo win rate; keeps three phases |
| `bossHitCap` | 0.12 | **0.18** | 0.08–0.18 | lets a saved ultimate visibly matter on stage |
| `corruptedFloorTickMs` | 600 | **900** | 450–900 | the Anchor floor is crossable at 48 max HP |
| `corruptedFloorDamage` | 10 | **6** | 6–16 | same |
| `hazardIntervalMs` | 450 | **600** | 350–600 | terrain stops deciding fights |
| `hazardBase` | 3 | **2** | 2–4 | ramp becomes 2/4/6/8 |
| `hazardStackMax` | 5 | **4** | 4–6 | caps a bad step at 20 rather than 45 |
| `tierScalePerTier` | 0.18 | **0.1** | 0.10–0.25 | tier 4 is ×1.40 instead of ×1.72 |
| `restHealFraction` | 0.4 | **0.6** | 0.25–0.6 | a rest site is worth crossing a biome for |

`bossHpPerExtraPlayer`, `gatekeeperHpBase`, `gatekeeperHpPerExtraPlayer`, `enemyHazardMul`,
`envKillCredit` and `openingStrikeMaxMul` are **unchanged**.

### One knob the brief asked for that does not exist

A **first-biome enemy budget ramp for rooms 1–3** has no home in `tuning.ts`, and `tierScalePerTier`
cannot stand in for it: `tierMultiplier(0) = 1`, so **tier scaling has literally no effect in biome
1**. Adding a ramp means new code in the room generator, not a constant. It is also not needed —
biome 1 already measures 99 %. It is deliberately left out so the preset stays a pure constants
change that a human can merge with one command.

---

## 4. Caveat: bots are not humans

Every number above is a **bot** playing, and it should be read as an upper bound on consistency and
a lower bound on flair:

- The bot has **frame-perfect reaction** — it reads the snapshot every tick (60 Hz) and dashes the
  instant a telegraph drops under 260 ms. A human on a projector, narrating, will not.
- It **never panics, never mis-aims, and never explores.** It walks the shortest plan path and
  fights everything on it.
- It plays with **E unlocked and no attunements, skill nodes or resources** — flatter than either a
  real early run (no E) or a real tier-4 arrival (many upgrades).
- `--only fullrun` in a browser acts on a ~40 ms input cadence through real key taps, so the *same*
  policy is meaningfully worse there. The gap between this report and a browser run is expected and
  is not evidence that the sim is wrong.
- Cause of death is **attributed** by the harness (was the operative on a damaging tile when HP
  dropped, else the nearest living enemy), not reported by the sim. `unknown` means neither applied.

A human demoing under stage pressure is plausibly worse than this bot at dodging and better at
deciding. Treat 90 % here as "reliable enough to demo", not as "cannot lose".

---

## 5. Crystal Tide law softening (release/floors-default, 2026-09-20)

Crystal Tide was the one fixture whose authored laws made it a bad demo. Measured with the demo
preset already applied, on `npx tsx scripts/difficulty-report.ts` (10 seeds x 4 classes x 3
fixtures). Only `fixtures/worlds/crystal-tide.json` changed — no sim or tuning constants.

### The change

| Law | Before | After |
| --- | --- | --- |
| `tidal_drag` "Salt Underfoot" | intensity 0.5 | unchanged |
| `glass_lattice` "Aalto's Tables" | intensity 0.5 — Integrity capped at **48**, damage x1.8 | intensity **0** — Integrity **60**, damage x1.5 |
| `few_and_terrible` "Eleven on the Roster" | intensity 0.5 — enemy HP **x2.2**, count x0.55 | **replaced** by `committed_strike` "Boots in the Salt", intensity 0 — no enemy multiplier at all; operatives slow during their own attack and hit ~15 % harder |

`few_and_terrible` was the dominant problem: its `enemyHpMul` of 2.2 applies to the **Custodian
itself**, so the solo boss carried more than double health on this fixture alone. `committed_strike`
is an implemented law in the `movement` group (`glass_lattice` already occupies the `combat` group,
which is capped at one), it conflicts with nothing Crystal Tide uses, and it fits the world's own
fiction of wet salt setting around a boot on Gauge Pier. Law names and descriptions were rewritten
to stay truthful to the rule and now pass `tests/generation/fixture-prose.test.ts` and
`tests/sim/law-honesty.test.ts` (the linter rejected an earlier draft for printing the engine's own
number, "60 Integrity", and for a missing bible noun).

### Before / after, Crystal Tide

| Metric | Before | After | Target | Verdict |
| --- | --- | --- | --- | --- |
| Biome-1 survival, every class | 100 % | **100 %** | >= 90 % | **MET** |
| Biome-1 survival, worst class across all 3 fixtures | 90 % | **90 %** | >= 90 % | **MET** |
| Solo Custodian, bastion | 60 % | 50 % | >= 60 % | not met |
| Solo Custodian, shade | 20 % | **80 %** | >= 60 % | met |
| Solo Custodian, beacon | 30 % | 40 % | >= 60 % | not met |
| Solo Custodian, weaver | 50 % | **60 %** | >= 60 % | met |
| Solo Custodian, overall all fixtures | 78 % | **83 %** | — | improved |
| Solo Custodian, worst class/fixture | 20 % | **40 %** | >= 60 % | improved, short |

### Why the >= 60 %-per-class target was not reached, and why that is not a law problem

**The laws are no longer the binding constraint.** With the authored laws stripped entirely
(`lawsOFF` column), Crystal Tide still measures bastion 70 %, shade 40 %, beacon **30 %**, weaver
50 %. A fixture whose Custodian beacon wins 30 % of the time with *no laws at all* cannot be brought
to 60 % by editing law intensities. The remaining difficulty lives in the tier-4 encounter and the
finale bot, not in `crystal-tide.json`.

Three law variants were measured before settling; the worst class plateaus at 40 % in both
`committed_strike` variants, and at 10 seeds a single class/fixture cell is +/- 15 %, so the
differences between the last two rows are inside the noise:

| Variant | bastion | shade | beacon | weaver | overall | worst |
| --- | --- | --- | --- | --- | --- | --- |
| authored (glass 0.5, few 0.5) | 60 % | 20 % | 30 % | 50 % | 78 % | 20 % |
| glass 0, few 0 | 50 % | 50 % | 30 % | 40 % | 78 % | 30 % |
| glass 0, committed 0.5 | 40 % | 60 % | 70 % | 60 % | 83 % | 40 % |
| **glass 0, committed 0 (shipped)** | 50 % | 80 % | 40 % | 60 % | **83 %** | **40 %** |

The shipped variant was chosen because intensity 0 is the gentlest form of the law (operatives are
slowed during their own attack rather than rooted outright), which avoids systematically punishing
the melee classes the way the 0.5 variant punished bastion.

**What is demo-safe today:** biome 1 — the part of Crystal Tide a demo actually plays — is 100 %
survivable for all four classes. The solo tier-4 Custodian on this one fixture is still a coin flip
for bastion and beacon. Anyone driving the finale on stage should pick Vantage Spire or Root
Archive (90-100 % for every class), or run the Custodian in co-op.

**Next lever if someone wants the per-class target met:** it is a tier-4 encounter or finale-bot
question (`bossHpBase`, the phase-3 pattern, or the `custodian phase 3` death cluster that accounts
for nearly every loss), not a fixture-law question.
