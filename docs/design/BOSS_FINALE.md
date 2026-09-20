# BOSS + FINALE — the world-built Custodian and the run's last five minutes

**Status: design only. Nothing here is implemented.** This is the B1 brief (OVERNIGHT_PLAN §4 Wave 3).
It **extends** PR #16's `shared/finale.ts`, its three `bossPhase` HP phases and its three-relay ritual.
Nothing in #16 is thrown away.

## 0 · What exists

| piece | where | what it does today |
| --- | --- | --- |
| 3 HP phases | `shared/finale.ts` `guardianPhase()` | `>2/3 → 1`, `>1/3 → 2`, else `3` |
| phase titles | `guardianTitle()` | fixed strings `WATCH / FRACTURE / LAST LIGHT` |
| phase movesets | `simulation.ts` `attackKindFor()` | P1 cycles `burst, volley, ring, beam`; P2 `beam, charge, ring, burst`; P3 `charge, ring, beam, burst, ring` |
| escalation | `resolveEnemyAttack`, `stepEnemy` | P3 windup 1100→900 ms, cooldown 1600→1200 ms, ring 8→12 bolts |
| recovery windows | `s.recoveryMs` | 1100 ms after charge/burst, 650 ms otherwise, 1400 ms on phase change |
| ritual | `updateAnchorRitual` | `locked → relays → core → discharging → complete`; 3 relays tapped with F, expanding 12-damage pulses between them, 1600 ms discharge |
| end | `finishRun('anchored')` | `run_ended`, phase → `debrief` |

Three problems, in order of how badly they hurt.

1. **The fight is over in five seconds.** `ENEMY_INFO.guardian.maxHp = 240`. A Bastion deals
   20 damage per 360 ms = 55 dps; a Shade 69. Solo, uncontested, the Custodian dies in **4.4 seconds**.
   No player will ever *see* phase 2, let alone read it. Every other note in this doc is downstream of
   that number.
2. **The phases are the same fight, faster.** Both phase lists are permutations of the same four
   telegraph kinds with shorter timers. The research is unanimous that this is the failure mode:
   adding only HP and speed "does not improve the gaming experience"; a phase needs a new gimmick, and
   phase transitions exist partly to create *resting moments*
   ([boss design guide](https://kistofe.github.io/Boss-Design/)). Hollow Knight's title boss is the
   sharpest counter-example — its **fourth phase removes** the triple-cut and dash and is reduced to two
   attacks, and reads as the boss breaking down rather than as a difficulty step
   ([wiki](https://hollowknight.wiki/w/The_Hollow_Knight)).
3. **The Custodian is the same in every world.** RELAY's whole premise is that the players' ideas build
   the world. The final boss — the thing they will remember — is the one part of it that is identical
   every time.

## 1 · The structure we are building to

Mike Stout's eight boss beats are the canonical checklist and we can hit six of them cheaply
([Boss Battle Design and Structure](https://www.gamedeveloper.com/design/boss-battle-design-and-structure)):

| Stout's beat | RELAY's version |
| --- | --- |
| 1 Build-Up | **Gatekeepers** at the biome 1–4 exits, each a single-pattern preview of the real fight (§5) |
| 2 Intro/Reveal | Door seals, title card with the world's own name for the Custodian, 2 s of it standing up |
| 3 Business as Usual | **Phase 1** — the three chosen patterns, one at a time, telegraphs 1.4× on first use |
| 4 Escalation | **Phase 2** — the biome's own terrain turns hostile; patterns chain in pairs |
| 5 Midpoint | The phase-2 → 3 transition: adds wave, 1600 ms invulnerable stagger, title change |
| 6 It's ON! | **Phase 3** — the relay-shield split (§4) |
| 7 Kill Sequence | Boss kneels, 1200 ms, room goes quiet, relays unlock |
| 8 Victory Sequence | The ritual → the collapse → **carrying one thing out** (§6–8) |

The underlying four-beat grammar is Hayashida's kishōtenketsu — *learn the mechanic, use it in a harder
scenario, something unexpected happens, demonstrate mastery*
([Game Developer](https://www.gamedeveloper.com/design/the-secret-to-i-mario-i-level-design)). Note for
whoever writes the pitch: **Mark Brown's *Boss Keys* is about dungeon lock-and-key topology, not
bosses.** Don't cite it here.

## 2 · Attack-pattern registry (closed set of 11; the model picks 3)

Precedent for randomised movesets and the rules that keep them readable:

- **Delirium** (Isaac) is the genre's definitive randomly-drawn boss: it transforms into bosses *from the
  current run*, but keeps **its own** health, copies the phase the source boss would be in *at Delirium's
  current health percentage*, and takes **heavy damage reduction while transformed**. Randomness plus
  three hard guard-rails ([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Delirium)).
- **Nuclear Throne** randomises the *order* of phases; each phase's content is a fixed, memorisable
  pattern ([wiki](https://nuclear-throne.fandom.com/wiki/The_Nuclear_Throne)).
- **Hades' Furies** fill one encounter slot with three mechanically distinct bosses — the player's first
  job is to identify *which* fight they are in ([guide](https://hadesguides.com/hades/bosses/the-furies)).

The rule those share: **randomise which patterns appear, never the relationship between a tell and its
hitbox.** Every pattern below is deterministic once started.

`src/shared/custodian.ts` (new file, so it cannot collide with #16):

```ts
export const CUSTODIAN_PATTERN_IDS = [
  'sweep_arc', 'siege_charge', 'ring_bloom', 'summon_choir', 'tether_haul',
  'arena_flood', 'mirror_shade', 'pylon_lock', 'gravity_well', 'shatter_step', 'overload_vent',
] as const;
export type CustodianPatternId = (typeof CUSTODIAN_PATTERN_IDS)[number];
export type PatternClass = 'close' | 'ranged' | 'arena' | 'control';
```

All telegraph durations below are the **phase-1** value. Phase 2 multiplies by 0.85, phase 3 by 0.75.
On the *first* use of a pattern in a run, multiply by **1.4** and show the model's `tell` line for
2.5 s — that is Stout's beat 3 and Mantis Lords' "phase 1 exists to teach each attack in isolation"
([analysis](https://www.michigandaily.com/arts/hollow-knight-anatomy-of-a-boss-fight/)).

| id | class | telegraph | what happens | numbers | counterplay |
| --- | --- | --- | --- | --- | --- |
| `sweep_arc` | ranged | **900 ms**, a thin amber wedge that widens to the full arc | a beam sweeps 300° around the boss over 1400 ms | range 420, arc 0.5 rad, **18** dmg, sweep rate 214°/s | walk *with* the sweep, or stand inside the 70 px dead zone, or put a `#`/`-` between you |
| `siege_charge` | close | **750 ms**, boss reverses 40 px, rim flashes | dashes 260 px at 900 px/s, destroying what it crosses | **26** dmg + 140 px knockback; destroys `B`, `-`; detonates `*` | sidestep 1 tile; **bait it into a canister or a pit** |
| `ring_bloom` | ranged | **700 ms**, concentric ground rings | 12 bolts radially, then a second ring at half-spacing offset 500 ms later | 12 × **6** dmg, speed 240, life 1600 | dash a gap; the second ring's gaps are where the first ring's bolts were |
| `summon_choir` | control | **1100 ms**, boss immobile, arms raised | calls 3 cheap + 1 ranged enemy **from the biome's own `enemyPool`** | boss takes **×1.25** damage for the whole cast | punish the cast, or kill the adds first — the choice is the mechanic |
| `tether_haul` | control | **800 ms**, a visible line to the *farthest* living player | hauls them 180 px toward the boss over 500 ms | **10** dmg, 40% slow for 2 s | break line of sight before it fires; in co-op a teammate can body-block the line |
| `arena_flood` | arena | **1200 ms**, 40% of floor tiles marked in a lane or checker pattern | marked tiles become live hazard for 2500 ms | **14** dmg per 600 ms on a marked tile | read the pattern; there is always a contiguous safe route (generator-checked) |
| `mirror_shade` | control | **600 ms**, three silhouettes bloom | 2 decoys, 1 HP each, mirror the boss's next telegraph but deal **0** damage | killing a decoy refunds **12** ult charge | the real one keeps its rim light; decoys have no shadow |
| `pylon_lock` | arena | **1000 ms**, three pylons rise | 3 gates split the arena into wedges for 6 s; boss channels a 3 s beam at whoever shares its wedge | beam **32** dmg; gates open early if a `_` plate is held | don't be in its wedge; co-op: one player plays gatekeeper |
| `gravity_well` | arena | **900 ms**, floor spiral | pulls **everything** — players, enemies, armed canisters — toward the boss at 90 px/s for 2 s | **0** direct damage | it is a positioning attack: let it feed enemies into a hazard |
| `shatter_step` | close | **500 ms** after-image at the destination | teleports to the farthest player, then a radial burst | burst range 240, **22** dmg | the after-image is a free 500 ms read; walk off the mark |
| `overload_vent` | arena | **1000 ms**, every `^` in the room glows at once | the room's own vents fire 3× on a 900 ms cadence; boss is immobile throughout | vent **18** dmg; boss takes **×1.3** damage while channelling | stand off the vents and burn it — the highest-DPS window in the fight |

`overload_vent`, `arena_flood` and `pylon_lock` are the patterns that **use the biome's own tiles**
(TILES.md T3 `^`, T0 `~`, T6 `_`/`G`). If the room lacks the tile, the pattern falls back to a
generated version at the same numbers — the boss makes its own vents. Never let a pattern no-op.

### 2.1 The model's choice, and the validation that keeps it readable

```ts
export const CustodianMoveSchema = z.object({
  patternId: z.enum(CUSTODIAN_PATTERN_IDS),
  /** The world's name for this attack. "The Ledger Sweep". */
  name: z.string().trim().min(1).max(32),
  /** One line, shown once, the first time the pattern is used. Goes through prose.ts. */
  tell: z.string().trim().min(1).max(80),
});

export const CustodianSchema = z.object({
  /** Replaces 'THE LAST CUSTODIAN'. */
  title: z.string().trim().min(1).max(40),
  /** Replaces WATCH / FRACTURE / LAST LIGHT. */
  phaseTitles: z.tuple([ShortText, ShortText, ShortText]),
  moves: z.array(CustodianMoveSchema).length(3),
});
// WorldRecipeSchema gains:  custodian: CustodianSchema.nullable().optional()
```

Compiler-enforced, never model-trusted:

- the three `patternId`s are distinct;
- **at most one** of class `arena` (two arena-wide patterns at once is unreadable);
- **at least one** `close` **and at least one** `ranged` (otherwise the fight has one range band and one
  answer);
- `summon_choir` is only legal if the biome's `enemyPool` has ≥ 2 non-boss ids;
- on any violation, substitute from `DEFAULT_CUSTODIAN_MOVES = ['ring_bloom', 'siege_charge', 'arena_flood']`
  one at a time until valid. **Generation never fails over the boss.**
- `name`/`tell`/`phaseTitles` run through W1's `src/shared/prose.ts`; failures fall back to the existing
  hard-coded strings in `guardianTitle()`, which stay in the file as the default.

This is the same shape as `AttunementSchema` (`contracts.ts:393`) — closed mechanical id, model-written
identity — so it needs no new concept in the codebase.

## 3 · Health, phases, and the anti-melt guard

### 3.1 Health

```ts
// src/shared/custodian.ts
export const CUSTODIAN_BASE_HP = 1200;
export const CUSTODIAN_HP_PER_EXTRA_PLAYER = 400;
export const GATEKEEPER_BASE_HP = 320;
export const GATEKEEPER_HP_PER_EXTRA_PLAYER = 80;
custodianMaxHp(players) = CUSTODIAN_BASE_HP + CUSTODIAN_HP_PER_EXTRA_PLAYER * (players - 1)
```

Solo 1200 · 2p 1600 · 3p 2000 · 4p 2400. Linear rather than Risk of Rain 2's
`× √(livingPlayers)` ([wiki.gg](https://riskofrain2.wiki.gg/wiki/Difficulty)) because at 1–4 players the
curves are within 15% of each other and linear is one line. **Use living players, recomputed on the
tick a player goes down**, which is RoR2's actual trick and the reason a death mid-fight immediately
softens the encounter — with `maxHp` held fixed and only the *remaining* pool scaled, so the health bar
never jumps backwards.

Sanity check: 55 dps solo × ~50% uptime = 28 dps → **~43 s of damage** plus three 1.4–1.6 s transitions
and the phase-3 shield downtime ≈ **60–75 s**. Calibration note from the research: Derek Yu intended
Olmec to "take at least a couple of minutes" and optimal play kills it in **under 20 seconds**
([PS Blog](https://blog.playstation.com/archive/2017/11/02/classic-trophies-beating-speedlunky-spelunkys-vicious-speedrunning-challenge)).
Designers overestimate. 1200 is deliberately on the low side; tune up after the first playtest, and use
the instrumented metric below rather than opinion.

**Acceptance metric:** phase 1 must last ≥ 18 s in a solo Bastion run, and the whole fight ≥ 45 s.
Separately: a boss whose win rate is **below 50%** needs revision ([boss design guide](https://kistofe.github.io/Boss-Design/)).

### 3.2 The anti-melt guard — steal this verbatim

Dead Cells' Conjunctivius caps **single-hit damage at 15% of her max HP** (and tentacle damage at 25%),
which is what keeps her three-phase structure intact regardless of the player's build
([wiki.gg](https://deadcells.wiki.gg/wiki/Conjunctivius)).

```ts
export const CUSTODIAN_HIT_CAP = 0.12;  // fraction of maxHp per single damage application
// in damageEnemy(), for enemies with role 'guardian':
amount = Math.min(amount, Math.round(s.maxHp * CUSTODIAN_HIT_CAP));
```

At 1200 HP that is 144 per hit — above every current ability (Aegis Slam 60, Blade Storm 3 × 22,
Solar Lance 55), so it changes nothing today and makes the fight immune to whatever the item system
does tomorrow. Six lines of insurance.

### 3.3 Phase transitions

Keep `guardianPhase()`'s 2/3 and 1/3 thresholds. Add one **mixed** condition, copying Mithrix — whose
P1→P2 is an HP threshold but whose P2→P3 is "all spawned Lunar enemies are dead"
([wiki.gg](https://riskofrain2.wiki.gg/wiki/Mithrix)):

```
phase 1 → 2 :  hp <= 2/3 * maxHp
phase 2 → 3 :  hp <= 1/3 * maxHp  AND  the phase-2 add wave is dead
                (if adds are still alive at 1/3 HP, the boss holds at 1/3 + 1 and becomes
                 immune, so the crew must clear the room — a forced breather they earn)
```

On every transition: `telegraph = null`, all boss projectiles cleared (already done at
`simulation.ts:821`), `recoveryMs = 1600`, boss invulnerable for that window, title card swaps to
`phaseTitles[n]`, camera `flash(180)` + `shake(260, 0.007)`. The transition **is** the rest beat; do not
let it be skippable.

### 3.4 Phase 1 — teach

Cycle `moves[0] → moves[1] → moves[2]`, one at a time, never two in flight.

| | value |
| --- | --- |
| telegraph | the pattern's own, ×1.4 on first use |
| recovery after | 1100 ms for `close` patterns, 650 ms otherwise (unchanged from #16) |
| cooldown between | 1900 ms |
| adds | none |
| no-repeat rule | never run the same pattern 3× in a row, even if the cycle is disturbed ([Cuphead-boss exercise](https://medium.com/@menardisaac/how-i-created-a-new-cuphead-boss-a6f71f8687c2)) |

### 3.5 Phase 2 — the twist: the biome joins in

This is the beat that makes the Custodian *this world's* Custodian. On entering phase 2, a one-time
`custodian_corruption` event converts the room's own terrain, permanently for the fight:

| tile | becomes | note |
| --- | --- | --- |
| `+` conduit | live hazard at 10 dmg / 600 ms (`~` rules) | the speed lane you have been using all fight turns on you — the strongest single beat available |
| `:` rubble | `%` crumbling floor, `CRUMBLE_MS = 900` | the arena erodes where the fight has been densest |
| `*` canister | re-armed (fuse reset, undestroyed ones stay) | |
| `^` vent | `VENT_CYCLE_MS` → 2000 | |
| `-` cover | HP halved | cover degrades exactly when you need it |

If the room has none of those tiles (a bare arena, or T1 hasn't landed), the fallback is a generated
ring of `~` at the arena's perimeter, closing 1 tile every 20 s to a maximum of 3 tiles — arena
shrink, which is what Hades' Tisiphone does per health milestone
([guide](https://hadesguides.com/hades/bosses/the-furies)) and what Furi does with its blue ring.

Pattern behaviour in phase 2: patterns **chain in pairs** — `moves[i]` then `moves[(i+1) % 3]` with only
400 ms between them, then a 2200 ms cooldown. Telegraphs ×0.85. One `summon_choir`-equivalent add wave
fires once at 50% HP regardless of whether `summon_choir` was chosen (this is the wave phase 3 gates on).

### 3.6 Phase 3 — test: the co-op split

See §4. Patterns reduce to `moves[2]` + `ring_bloom` on a 2400 ms cadence — **fewer moves, not more**,
because the player's attention is now on the relays. Hollow Knight's final phase does exactly this.

## 4 · The phase-3 relay shield (co-op split with a solo variant)

### 4.1 Why it is built this way

The published co-op mechanics split cleanly into two kinds:

- **Continuous / proportional — degrades to solo for free.** Risk of Rain 2's teleporter charges at a
  rate *proportional to the fraction of living players inside the radius*: two of four players inside =
  50% speed, nobody inside = no charge ([wiki.gg](https://riskofrain2.wiki.gg/wiki/Teleporter)). Solo
  needs no special case at all.
- **Role-gated and information-asymmetric — cannot degrade.** Destiny's Deep Stone Crypt gives one
  player a Scanner role that *sees things the others literally cannot*
  ([guide](https://www.redbull.com/gb-en/deep-stone-crypt-encounter-guide-destiny-2-beyond-light)).
  It Takes Two is the same idea taken to its end: solo play is structurally impossible
  ([Wikipedia](https://en.wikipedia.org/wiki/It_Takes_Two_(video_game))).

RELAY ships solo *and* co-op from the same simulation, so phase 3 must be the first kind.

### 4.2 The mechanic

On entering phase 3 the Custodian raises a shield and the three ritual relays light **early** — the same
three `anchor.ritual.relays` objects that the finale uses afterwards. Damage reduction is a continuous
function of how many are held:

```ts
export const CUSTODIAN_SHIELD_DR = [0.90, 0.60, 0.30, 0.00];  // indexed by relays held
shieldDr = CUSTODIAN_SHIELD_DR[relaysHeld]
```

A relay is *held* while a living player's centre is within `RELAY_ACTIVATION_RANGE` (42 px, already a
constant in `shared/finale.ts`).

| | co-op (≥2 living) | solo (1 living) |
| --- | --- | --- |
| `RELAY_LATCH_ARM_MS` | 1200 — time standing on a relay before it latches | 1200 |
| `RELAY_LATCH_MS` | 2000 | **5000** |
| typical relays held | 2 (one each) → **30% DR** | 1 standing + 1 latched → **30% DR** in ~3.5 s windows |

The latch is diegetic: *the Custodian remembers where you stood.* Solo play becomes a route problem —
arm relay A, run to relay B, burn the window, repeat — which is a different verb from co-op's
hold-and-shoot but reaches the same DR. Nobody is locked out and nobody is trivialising it.

Every 12 s the boss rotates which relay is **inert** (dark, un-holdable), so the crew must move; this is
the tension knob and it is one integer. The boss keeps attacking throughout; relays are not a safe zone.

**This is also the ritual's tutorial.** After the boss dies, the crew must tap F at these same three
relays under pulses. Phase 3 has already taught the verb, the geometry and the routes. Super Metroid's
escape works for the same reason — it reuses a shaft the player has already traversed several times for
other purposes ([Anatomy of Games](https://www.anatomyofgames.com/2014/03/07/the-anatomy-of-super-metroid-18-zebessinia-henry/)).

### 4.3 Fields

```ts
// EnemyStateSchema gains (optional, so legacy snapshots parse):
shieldDr:   z.number().min(0).max(1).optional(),
patternId:  z.enum(CUSTODIAN_PATTERN_IDS).optional(),   // drives the named-move HUD banner
// AnchorState.ritual.relays[] gains:
latchedMs:  z.number().nonnegative().optional(),
inert:      z.boolean().optional(),
```

## 5 · Gatekeepers — the run teaches its own final fight

floorgen's director already places `role: 'gatekeeper'` in every biome exit room (FLOORS.md §6, §7.4).
Make each one a single-pattern preview:

| biome tier | pattern shown | HP | telegraphs | phases |
| --- | --- | --- | --- | --- |
| 0 | `moves[0]` | 320 + 80·(n−1) | ×1.3 | 1 |
| 1 | `moves[1]` | 360 + 90·(n−1) | ×1.2 | 1 |
| 2 | `moves[2]` | 400 + 100·(n−1) | ×1.15 | 1 |
| 3 | `moves[0]` + `moves[1]`, alternating | 480 + 120·(n−1) | ×1.05 | 1 |
| 4 | **the Custodian** | 1200 + 400·(n−1) | ×1.0 | 3 |

Gatekeepers carry the model's `name` for the pattern in their HUD banner, so by the time the crew
reaches biome 5 they have already been told three times what "The Ledger Sweep" looks like. This is
Stout's beat 1 (Build-Up) done systemically rather than scripted — *Portal* teaches you to throw a core
into an incinerator before GLaDOS asks you to.

Inverse trick worth reserving: Dead Cells expresses higher difficulty on the Hand of the King by
**skipping straight to phase 2** — i.e. removing the teaching phase
([wiki.gg](https://deadcells.wiki.gg/wiki/Bosses)). Wire that to WORLD_MUTATORS' difficulty budget later;
don't spend it tonight.

On 3-room worlds there are no biome exits, so gatekeepers are inert code. **That is fine** — build them
behind the same `role` check floorgen already emits, and they light up when floors flips.

## 6 · The ritual, shortened by what you read

Keep #16's `locked → relays → core → discharging` exactly. Two changes, both cheap, both making
exploration pay:

```
r = number of `relic`-kind fragments actually read this run   // discoveredLore ∩ recipe.lore[kind==='relic']
preActivated  = min(2, floor(r / 2))        // 0-1 relics → 0 ; 2-3 → 1 ; 4+ → 2
ANCHOR_DISCHARGE_MS = 1600 - 150 * min(4, r)      // 1600 → 1000
```

The first `preActivated` relays start with `activated: true` and `ritual.activeRelay = preActivated`.
**No schema change** — the array stays `.length(3)`, the ritual just begins further along. The HUD line
(`anchorInstruction()` in `shared/finale.ts`) gains one case:

> `Two relays already remember you · Relay 3/3 · tap F at the lit relay · dash through pulses`

That is the whole mechanical payoff for reading lore, and it is legible in one sentence.

## 7 · The collapse — escape state machine

### 7.1 Why a timed escape, and why a generous one

- **The cluster is three minutes.** Super Metroid 3:00 · Metroid Dread 3:00 (best runs 1:54, i.e. the
  timer is ~35% generous) · Risk of Rain 2 3:00 + a 1:00 holdout · Deep Rock Galactic 5:00 / 3:00 / 1:00
  by mission type, where players complain 4–5 minutes is **too long**. The tolerable band for a
  run-ending escape is **1–3 minutes**.
  ([Dread](https://en.wikipedia.org/wiki/Metroid_Dread), [RoR2](https://riskofrain2.wiki.gg/wiki/Mithrix), [DRG](https://deeprockgalactic.wiki.gg/wiki/Drop_Pod))
- **Escapes fail when the route is unknown.** The stated object lesson is that nobody complains about
  Super Metroid's escape and everybody complains about Metroid Fusion's, for the same mechanic: Super
  Metroid runs you back up a shaft you have used repeatedly, while carrying the Hyper Beam that deletes
  everything in the way. The escape is a **victory lap**, not a second difficulty spike
  ([Anatomy of Games](https://www.anatomyofgames.com/2014/03/07/the-anatomy-of-super-metroid-18-zebessinia-henry/)).
- **Tension comes from the display, not the clock.** Reminder timers make you plan; warning timers make
  you panic, and the difference is presentation. Danganronpa's trial timer renders to *microseconds*
  while giving ~5 minutes for a ~30-second puzzle. **Generous timer + high-salience display beats a
  tight timer** ([Game Developer](https://www.gamedeveloper.com/design/time-for-a-timer---effective-use-of-timers-in-game-design)).
- **Counter-argument, honestly noted:** Spelunky deliberately **disables** its ghost timer on the first
  and last levels — it removes time pressure exactly where Metroid adds it
  ([wiki](https://spelunky.wiki/wiki/Ghost_(Classic))). Our mitigation is §7.5: the timer can cost you
  the souvenir, never the run.

### 7.2 State machine

Extend `AnchorState.ritual.stage`:

```
locked → relays → core → discharging → collapse → extraction → complete
                                           ↓
                                       stranded
```

```ts
// AnchorStateSchema.ritual.stage
z.enum(['locked','relays','core','discharging','collapse','extraction','complete','stranded'])

// New top-level snapshot field:
collapse: z.object({
  remainingMs: z.number().nonnegative(),
  totalMs:     z.number().positive(),
  ringDepth:   z.number().int().min(0).max(3),
  portalRoomId: IdString,
  /** Rooms already lost behind the crew; the minimap greys them. */
  lostRoomIds: z.array(IdString).max(40),
  /** Extraction only. */
  offer: z.array(z.object({
    key: z.string().max(40),             // 'relic:3' | 'remains:1' | 'custodian_log'
    title: z.string().max(40),
    votes: z.array(IdString),
  })).max(3),
  chosenKey: z.string().max(40).nullable(),
}).nullable().optional()
```

### 7.3 Timer

```
hops = BFS graph distance from the anchor room to the portal room
collapseMs = clamp(45_000 + 15_000 * hops, 60_000, 180_000)
if living players == 1: collapseMs *= 1.2
```

3-room world: `hops = 2` → **75 s** (90 s solo). 5-biome world with a ~8-hop return: **165 s** — inside
the 1–3 minute band at both extremes.

**Acceptance test:** a solo player who knows the route reaches the portal with ≥ 35% of the timer
remaining. That is Dread's margin, and it is the number to tune against, not "does it feel tense".

### 7.4 What happens during `collapse`

| beat | rule |
| --- | --- |
| doors | **all unlocked**, including `D` sealing doors and `X` exits, regardless of live enemies. Never make the player fight to leave. |
| enemies | existing ones remain; **nothing respawns**, nothing new spawns. Survivors get +20% move speed and stop using ranged patterns — they chase. Reads as panic, and removes the "sniped from off-screen during a timer" failure. |
| arena decay | a hazard ring closes from the room walls inward: **1 tile every 25 s, maximum 3 rings.** Capped so a room can never become impassable. |
| rooms behind | when the crew leaves a room, it is added to `lostRoomIds` 3 s later, greys out on the minimap, and cannot be re-entered (its door becomes solid). One-way pressure without a second timer. |
| route marking | the next door toward the portal gets a floor chevron and a minimap pulse. Deep Rock Galactic's M.U.L.E. lays **blinking marker buoys** to the extraction point for exactly this reason ([wiki.gg](https://deeprockgalactic.wiki.gg/wiki/Drop_Pod)); a procedurally generated escape has to be *drawn*. |
| revives | `REVIVE_DURATION_MS` 2000 → **1000**. It Takes Two lets dead players speed up their own respawn during boss fights so failure costs tempo, not the run ([interview](https://gamerant.com/it-takes-two-interview-josef-fares-turn-me-up-switch-port-gameplay-content-design/)). |
| solo last stand | a solo operative downed during `collapse` self-recovers after **6000 ms** at **25 HP**, **once per run**. A second down → `stranded`. |
| co-op wipe | all players down → an **8000 ms** bleed-out during which any player revived by… nobody, obviously, so: the timer simply continues and they bleed out → `stranded`. (Do not add a self-revive in co-op; the 1000 ms revive is already the concession.) |
| mercy | entering the **portal room** stops the timer, full stop. No edge cases, no "10 seconds left" special-casing. DRG's drop pod always opens 10 s early if the M.U.L.E. fails; ours is the same instinct, stated as geometry instead of as a clock. |

### 7.5 Fail state — `stranded`, not death

`run_ended.outcome` gains a fourth value:

```ts
outcome: z.enum(['anchored', 'collapsed', 'aborted', 'stranded'])
```

`stranded` means: **the Anchor held. The crew did not get out.** The world is saved, the memory wall
gets the anchor memory and an honest run summary, and there is **no relic**. You lose the souvenir, not
the run.

The design literature recommends exactly this over a Game Over — "design multiple endings, including a
separate ending sequence that implements narrative consequences of failing… for example, having the bomb
go off"
([Game Developer](https://www.gamedeveloper.com/design/time-for-a-timer---effective-use-of-timers-in-game-design)).
Metroid and RoR2 both take the punitive route; we should not, because RELAY's entire product promise is
that *the run produces a memory*. A timer that deletes the memory is a timer that deletes the product.

## 8 · Extraction — carrying one thing out

The timer is stopped. This beat is calm on purpose. Celeste's Farewell ends on its *easiest* moment — a
single dash — after its hardest ([ExOK](https://exok.com/posts/2019-11-25-chapter-9-design/)).

### 8.1 The offer

Three pedestals rise at the portal. Every card is derived from a **real event this run** — PRODUCT.md's
social rules forbid inventing anything — assembled in this priority order until three are filled:

1. **relics actually read** (`discoveredLore` ∩ `kind === 'relic'`), most recent first;
2. **remains recovered** (`kind === 'remains'`);
3. **`custodian_log`** — always available, generated from the fight itself: the world's name for the
   Custodian, the three pattern names, the fight duration, who landed the last hit.

If fewer than three exist, the remaining pedestals stay dark; a crew that read nothing gets exactly one
choice, which is itself a statement.

Caves of Qud's death screen is the minimal precedent — cause of death, artifacts created, how many
**storied items** the run generated ([wiki](https://wiki.cavesofqud.com/wiki/Death)). Spelunky 2 names
the final constellation after what you carried out — Eggplant Crown → "Solanum Major"
([wiki](https://spelunky.fandom.com/wiki/Cosmic_Ocean_(2))). One branch on "what did you take" is enough
to make an ending feel personal; we get three.

### 8.2 Choosing

No new input. The pedestals are physical:

| | rule |
| --- | --- |
| highlight | standing on a pedestal highlights that card for everyone |
| solo | 1200 ms hold locks it |
| co-op | locks when a **majority of living players** occupy the same pedestal; after **20 s**, the plurality leader locks automatically; ties break by lowest player id (the same deterministic ordering `orderedPlayers()` already uses) |
| revive | **entering the extraction room revives every downed player at 40 HP.** Gungeon does this — defeating any boss immediately revives a dead co-op partner ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Co-op)). Nobody should watch the ending from the floor. |

On lock: emit `relic_carried`, `finishRun('anchored')`, phase → `debrief`. H1's hub turns
`relic_carried` into the physical object on the memory wall.

### 8.3 New events

```ts
{ type: 'boss_phase_changed', enemyId, phase: 1|2|3, title: string }
{ type: 'boss_pattern_started', enemyId, patternId, name: string, firstUse: boolean }
{ type: 'terrain_corrupted', roomId, tilesChanged: number }         // the phase-2 twist
{ type: 'collapse_started', worldId, totalMs, hops }
{ type: 'room_lost', worldId, roomId }
{ type: 'extraction_reached', worldId, playerIds, remainingMs }
{ type: 'relic_carried', worldId, key, title, playerIds }
// run_ended.outcome gains 'stranded'
```

Every one of these is chronicle-grade — they are what the hub's quartermaster is allowed to talk about.

## 9 · Renderer and audio beats

Ordered by how much they are worth per line of code.

| beat | visual | audio |
| --- | --- | --- |
| boss intro | door slams (`shake(140, 0.005)`), 2 s stand-up, title card with the world's `title` | low sustained tone |
| first use of a pattern | the model's `tell` line, 2.5 s, upper third; telegraph ×1.4 | one-shot sting |
| telegraph wind-up | **amber** (`#f2bb71`, already used for `B` walls) — the research is explicit that dark red is the wrong danger colour, and recommends bright orange/yellow or a shift toward magenta ([telegraph notes](https://note.com/darkangels_417/n/nb520b22d60f7)) | rising whine, pitch tracks the remaining windup |
| live hit frame | `palette.hazard` (`#ff5c7a`), 60 ms white flash | impact |
| phase change | `flash(180)`, `shake(260, 0.007)`, title swap, all boss bolts dissolve | music layer added |
| phase-2 corruption | conduits ignite in a wave outward from the boss over 800 ms | grinding sub-bass |
| phase-3 shield | a hexagonal shell whose opacity **is** `shieldDr` — the player reads the number directly | hum whose pitch drops per relay held |
| relay held | beam from relay to boss; latch = a ring that ticks down visibly | |
| kill | 1200 ms kneel, room silent, relays unlock with a chime | everything stops for ~600 ms |
| collapse start | screen edges crack, `flash(400)`, the HUD timer takes over the top centre | siren, then the music drops to a pulse |
| collapse timer | **large, 0.1 s precision** — the Danganronpa trick; the display does the work, not the clock | a tick that accelerates under 20 s |
| room lost | the door behind slams and greys on the minimap | distant collapse |
| extraction | timer freezes with a visible *clunk*, hazards stop, three pedestals rise | music resolves; this is the only major-key beat in the run |
| carry-out | chosen object lifts, portal opens, walk through | |

## 10 · One-night cut — in priority order

Every item works on **3-room worlds**, so none of this is blocked on the floors flip.

| # | item | why here | files | est. |
| --- | --- | --- | --- | --- |
| 1 | **HP + hit cap + phase-1 cycle** (§3.1–3.4) | Without this nobody ever sees a second phase. Two constants and a `Math.min`. Everything else in the doc is worthless until the fight lasts a minute. | `registry.ts`, `simulation.ts` | ~40 lines |
| 2 | **Pattern registry + model's 3 moves + named tells** (§2) | This is the "world-built boss" ask. New file `shared/custodian.ts` → no merge conflict with Devin. Ship 5 of the 11 patterns if time is short: `ring_bloom`, `siege_charge`, `sweep_arc`, `summon_choir`, `shatter_step` — they reuse existing telegraph kinds and `firePattern`. | new `shared/custodian.ts`, `contracts.ts`, `simulation.ts`, `provider.ts` | ~260 lines |
| 3 | **Phase-3 relay shield + solo latch** (§4) | Reuses the three relay objects that already exist. Continuous DR, so solo needs no branch. Teaches the ritual. Highest design value per line in the doc. | `simulation.ts`, `shared/finale.ts`, `contracts.ts` | ~90 lines |
| 4 | **Collapse timer + `stranded` + portal-stops-the-clock** (§7) | The finale beat the lead asked for. On 3-room worlds it is "walk back 3 → 2 → 1". Needs `enterRoom` to permit backwards traversal during collapse — one condition in the existing guard at `simulation.ts:1059`. | `simulation.ts`, `contracts.ts`, `Hud.tsx` | ~150 lines |
| 5 | **Extraction: three pedestals, carry one out, relic-shortened ritual** (§6, §8) | The emotional payoff and the thing that links the run to the hub wall. §6's ritual shortening is 8 lines on its own and could ship even if the pedestals don't. | `simulation.ts`, `shared/finale.ts`, `render/anchorRitual.ts` | ~170 lines |

Deliberately **out** tonight: phase-2 terrain corruption beyond the `+`-conduit line (it depends on T1's
tiles — keep the generated-hazard-ring fallback, which needs only TILES cut #1), gatekeepers (dead code
until floors flips), `mirror_shade`, `pylon_lock`, `overload_vent`, `gravity_well`, `arena_flood`.

## Needs a human call

- **Boss HP is a guess.** 1200 is derived from 55 dps × 50% uptime, not from play. Somebody must fight
  it once before the demo and move the number. If there is time for exactly one playtest tonight, spend
  it here.
- **`stranded` adds a fourth `run_ended` outcome**, which touches the Chronicle, the memory wall, the
  debrief screen and `contracts.test.ts`. That is a contracts change on the night F1b owns
  `contracts.ts`. Either F1b lands it as part of its schema pass, or B1 waits.
- **Does the demo ever show the collapse?** The judged sequence in PRODUCT.md ends at the arrival
  keepsake and explicitly does not require finishing a run. If nobody will see the escape on stage, it
  is the correct thing to cut when the clock runs out — and the boss patterns are not.
- **Co-op wipe during the collapse.** As specced, a two-player wipe is `stranded` with no recovery. The
  kinder alternative is a single shared self-revive on an 8 s timer, matching the solo last stand.
  Kinder is probably right for a hackathon demo; it is a taste call, not a design one.
- **Three-minute escapes in a five-minute presentation.** If the demo slot is tight, the timer formula's
  floor (60 s) may still be too long. A `--demo` constant that halves `collapseMs` is trivial, but
  somebody has to decide whether the demo build and the shipped build may differ.
