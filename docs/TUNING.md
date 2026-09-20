# TUNING — the knobs, in one place

Every number below lives in **`src/sim/tuning.ts`** (`DEMO_TUNING`). The constants that used to
hold them (`CUSTODIAN_BASE_HP`, `HAZARD_BASE`, `FLOOR_TUNING.restHealFraction`, …) now read from
it, so a knob is turned in exactly one file and nothing else has to move.

Nothing here changed when the file was created: `tests/sim/tuning.test.ts` pins every value and
checks that each old constant still equals its entry, so a rename or a stray edit fails the suite
rather than the demo.

**Turn one knob at a time**, then re-run `npm test` — the simulation tests are the fastest way to
see what a change did. Anything outside the safe range is a different game, not a tuned one.

## The last fight (`docs/design/BOSS_FINALE.md` §3)

| Knob | What it does | Now | Safe range |
| --- | --- | --- | --- |
| `bossHpBase` | Custodian health for a solo operative. Fight length keys off this. | 1200 | 800–1800 (under 800 the three phases blur together; over 1800 a solo run drags past two minutes) |
| `bossHpPerExtraPlayer` | Added per operative beyond the first. Health scales with the crew, never with the tier. | 400 | 250–550 (below 250 a four-stack melts it; above 550 a four-stack out-lasts the collapse timer) |
| `gatekeeperHpBase` | Biome-exit gatekeeper at tier 0 — a one-phase preview of the Custodian. | 320 | 220–450 |
| `gatekeeperHpPerExtraPlayer` | Added per extra operative on a gatekeeper. | 80 | 50–120 |
| `bossHitCap` | Share of max health a SINGLE hit may take. Keeps the phase structure intact whatever the build does. Dead Cells' Conjunctivius uses 0.15. | 0.12 | 0.08–0.18 (above 0.2 an ultimate can skip a phase) |
| `corruptedFloorTickMs` | How often a corrupted conduit or a live flood tile hurts whoever stands on it. | 600 | 450–900 (under 450 a crossing is unsurvivable) |
| `corruptedFloorDamage` | Damage per tick of corrupted floor. Flood tiles use their own pattern damage. | 10 | 6–16 |

## Damaging terrain (`docs/design/TILES.md` T0, §1.1)

| Knob | What it does | Now | Safe range |
| --- | --- | --- | --- |
| `hazardIntervalMs` | One `~` damage tick per this many ms of standing in it. | 450 | 350–600 |
| `hazardBase` | The ramp's step: tick *n* deals `hazardBase × n` — 3, 6, 9, 12, 15 at the default. | 3 | 2–4 (at 5 the fifth tick alone is a fifth of a crew's health) |
| `hazardStackMax` | The ramp stops here, so standing in fire is survivable for a known number of seconds. | 5 | 4–6 |
| `enemyHazardMul` | Enemies burn this much harder than the crew, so kiting a pack across a hazard is worth doing. | 1.6 | 1.2–2.0 (over 2.0 the room clears itself) |
| `envKillCredit` | Share of the reward and ult charge paid when the ROOM made the kill. Attractive to aim for, never better than fighting. | 0.5 | 0.3–0.7 (1.0 makes hazards strictly better than combat) |

Per-room intensity still scales the three hazard numbers around these (`terrainTuning`, TILES.md
§4.2); the knobs above are the middle of that band, not a hard cap.

## Floors (`docs/design/FLOORS.md` §12)

| Knob | What it does | Now | Safe range |
| --- | --- | --- | --- |
| `tierScalePerTier` | Enemy health and damage grow by this much per biome tier. Tier 0 is the legacy numbers; tier 4 is ×1.72. | 0.18 | 0.10–0.25 (over 0.25 the fifth biome outclasses the Custodian) |
| `restHealFraction` | Share of max Integrity a rest site restores to every living operative, **once per run**. | 0.4 | 0.25–0.6 (over 0.6 a rest room undoes a whole biome) |

## What is deliberately NOT here

Class damage and speed (`CLASS_COMBAT`), enemy stats (`ENEMY_COMBAT`, `ENEMY_INFO`), the collapse
timer (`src/sim/escape.ts`) and the world-law bands (`src/sim/laws.ts`) are balance tables, not
demo knobs: they are read in many places and each has its own document. Change those in their own
file, with their own test.
