# TILES — combat-facing terrain, second pass

**Status: design only. Nothing here is implemented.** This is the T1 brief (OVERNIGHT_PLAN §4 Wave 2).
It **extends** PR #16's terrain registry; it replaces nothing.

## 0 · What exists, and the gap

PR #16 gave the registry four features and six new tile chars:

| char | id | behaviour today | where |
| --- | --- | --- | --- |
| `B` | `breakable_walls` | solid, 36 HP, becomes `:` when broken | `sim/terrain.ts` `damageBreakableWall` |
| `=` / `>` | `bridges` | walkable crossing + ramps through a wall run | compiler `applyTerrain` |
| `:` | `rubble` | walk speed ×0.65 | `shared/terrain.ts` `terrainSpeedMultiplier` |
| `+` | `conduits` | walk speed ×1.25 | same |
| `~` | (pre-#16) | **nothing** | — |

Two facts from reading the code:

1. **All four features are movement modifiers.** Nothing in the terrain layer deals damage, blocks a
   projectile, changes line of sight, or can be turned against an enemy. The room is scenery you walk
   through, not a participant. `strikeBreakableWalls` is the only place where an attack and the terrain
   meet, and its only outcome is "a wall is gone".
2. **`~` hazard floor is cosmetic.** `grep -n "'~'" src/sim/` returns nothing. It is placed by
   `compiler.ts` (`applyHazard`), drawn by `environment.ts:280`, validated against in
   `RoomSpecSchema` ("anchor relays must be on safe ground") — and then the simulation ignores it.
   The renderer already promises damage the sim does not deliver.

The reference games make the room fight, and they are specific about it:

- **Isaac's spikes deal one heart to Isaac and 8 damage to non-flying enemies.** Retracting spikes
  "retract and extend on timers" and "can be walked over safely while they are retracted," and they can
  be **deactivated with pressure plates**
  ([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Spikes)). One tile, three of the mechanics this
  doc wants: neutral damage, a readable period, and a linked switch.
- **Isaac's rocks block movement *and* projectiles, and can be pushed into gaps to make bridges**;
  bomb rocks explode when destroyed ([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Rocks)).
- **Gungeon: non-flying enemies pushed into a pit "instantly die," which is stated outright as the
  reason knockback weapons are good.** The player who falls in pays **half a heart** and respawns at
  the rim; a dodge roll keeps you airborne; non-flying enemies will not cross a pit on their own
  ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Pits)).
- **Gungeon's tables block bullets, clear nearby bullets during the flip animation, grant a few frames
  of invincibility — and Bullet Kin flip tables and use them as cover themselves**
  ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Tables)). Braziers are explicitly called out as
  objects that "do not provide cover," i.e. the distinction is designed, not incidental
  ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Objects)).
- **Gungeon's explosive barrels deal ~35 damage to enemies**, and a dodge roll destroys one *without*
  detonating it; water barrels can be electrified, oil ignites from explosions and fire, poison goop
  hurts anything standing in it ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Objects)).

And the doctrine stated most plainly, by Hades:

> *"Traps can damage Zagreus and enemies, but **hurt enemies considerably more** than Zagreus."*
> — [Hades wiki, Gameplay mechanics](https://hades.fandom.com/wiki/Gameplay_mechanics)

That sentence is the design rule for this entire document. Not "hazards hurt you", not "hazards hurt
them" — **both, weighted toward the crew**, so touching a hazard is a mistake and *aiming* one is a play.

Two more framings worth keeping in mind while reading §2:

- **Telegraphing changes what is under threat.** Into the Breach's postmortem draws the chain directly:
  *"Telegraphed Attacks → Changes Threat → What's the threat? → **Defenseless Objects**."* Once the
  player cannot be surprised, the interesting thing to threaten is the room
  ([GDC 2019 deck](https://media.gdcvault.com/gdc2019/presentations/Into%20the%20Breach%20Postmortem%20Final.pdf)).
- **Hazards are how a room gets a personality; enemies can't be.** Alex Sulman's line:
  *"**You're building AI to work anywhere and you're building a boss to work somewhere.**"*
  ([Game Developer](https://www.gamedeveloper.com/design/enemy-design-and-enemy-ai-for-melee-combat-systems)).
  Our seven enemy archetypes have to work in every generated room, so they can never assume a shape.
  Terrain is the only layer that gets to be specific to *this* room — which is exactly what a
  world-generating game needs.

The common thread — *the hazard is neutral; the player's edge is that they can aim it* — is the single
mechanic missing from our terrain layer.

**What this doc adds:** 11 combat-facing tiles, each with exact sim rules; a bounded schema letting the
model skin and tune them per biome; generator placement rules that cannot strand a room; a 5-tile
one-night cut.

## 1 · Design rules every tile here obeys

These are the acceptance criteria for a tile, not prose. A proposed tile that fails one gets cut.

- **R1 — Neutral, not player-only.** If it damages, it damages enemies on the same terms. The player's
  edge is that they can *aim* it (knockback, baiting, detonation), not that they are immune.
- **R2 — Dashes are the universal answer.** Dash (`dashRemainingMs > 0`, 150 ms, 96 px) crosses every
  floor hazard without harm. This matches `terrainSpeedMultiplier`'s existing contract ("dashes retain
  their normal speed") and gives every hazard one legible, always-available counterplay.
- **R3 — Telegraphed on the tile itself.** Anything that damages on a timer shows its state in the tile
  art for ≥ 400 ms before it fires. No off-screen kills.
- **R4 — Never mandatory.** Reachability (spawn ↔ every door entry ↔ focus ↔ relics ↔ encounters) must
  hold with every new blocking or damaging tile treated as **solid**. A room is always beatable by a
  player who refuses to touch any of it.
- **R5 — One tile char, one mechanic.** Anything needing a parameter (a conveyor's direction, a gate's
  group) goes in an additive `terrainLinks` side-table, not a second char. Char budget is scarce.
- **R6 — Snapshot cost is bounded.** Per-tile mutable state is a sparse record keyed `"col,row"`,
  capped at 2048 entries, exactly like `TerrainState.wallDamage` already is.
- **R7 — Attribution is preserved.** See §1.1: the sim currently has no way to damage an enemy without
  a player. Every tile here needs that, and there is exactly one right way to add it.

### 1.1 · The one piece of plumbing every tile here needs

`damageEnemy(e, p: PlayerRuntime, damage, events)` (`simulation.ts:282`) requires a player, because it
credits `p.state.ultCharge` and stamps `enemy_defeated.byPlayerId`, which is `IdString` and **not
nullable**. There is no enemy-vs-enemy or terrain-vs-enemy damage path in the codebase at all.

Add one function, used by every tile in §2 and by the `unstable_matter` world law:

```ts
type DamageSource =
  | { kind: 'player'; player: PlayerRuntime }
  | { kind: 'terrain'; tile: string }                      // 'hazard' | 'vent' | 'pit' | 'canister'
  | { kind: 'displaced'; by: PlayerRuntime | null };        // knocked/pulled into something lethal

function damageEnemyFrom(e, source: DamageSource, damage, events): void
```

Rules:
- `kind: 'player'` behaves exactly as today. **No behaviour change, no test churn.**
- `kind: 'displaced'` with a non-null `by` credits `byPlayerId` normally — *if you knock something into
  a pit, you killed it.* This is the whole reason pits are fun and it must not be lost.
- `kind: 'terrain'` (and `displaced` with `by: null`) credits nobody. It needs
  `enemy_defeated.byPlayerId` to become `IdString.nullable()` — **one character in `contracts.ts`**,
  plus one `?? 'the room'` in whatever the Chronicle renders. Do not fake a player id; the honesty rule
  in PRODUCT.md applies to the memory wall and a fabricated kill credit would reach it.

**Environmental kills must pay less than earned kills — `ENV_KILL_CREDIT = 0.5`.**
Both shipped precedents agree and one is harsher than the other: Gungeon states
*"Enemies that die from traps triggered by the player such as chandeliers or explosive barrels will give
**less shells**"* ([wiki](https://enterthegungeon.fandom.com/wiki/Pickups)), and Spelunky goes further —
*"enemies killed by traps, **player-caused or not**, do not count toward the player's kill score"*
([wiki](https://spelunky.fandom.com/wiki/Traps_(HD))).

Without this rule, every tile in §2 is strictly better than attacking, and the game we built stops being
played. So: `displaced` and `terrain` kills award **half** the usual
`ULT_CHARGE_PER_DAMAGE`/`ULT_CHARGE_PER_KILL` and **half** `ROOM_CLEAR_REWARD`'s per-enemy share. Half,
not zero — Gungeon also ships an unlock for *"Kill 100 enemies by knocking them into pits"*
([wiki](https://enterthegungeon.fandom.com/wiki/Amulet_of_the_Pit_Lord)), i.e. it meters environmental
kills as a thing worth doing. We want them attractive, not dominant.

## 2 · The tiles

Numbers are given at `intensity = 0.5` (see §4). Every damage number is against `PLAYER_MAX_HP = 100`;
enemy HP runs 14 (swarmling) → 70 (warden) → 240 (guardian today, see BOSS_FINALE.md).

---

### T0 · `~` hazard floor — *make the existing tile real* ★ cut #1

**Feature id:** `hazard_floor` (new id for an old char). **Char:** `~` (already in `TILE_CHARS`).

**Sim rules — ramping, not flat.** Hades' Asphodel magma is the model to copy, and it is better than a
flat tick: damage starts *"at **1 damage per tick** and increas[es] rapidly until death.
**Dashing or stepping off the magma resets the ticks back to 1**"*
([Hades wiki](https://hades.fandom.com/wiki/Asphodel)). Crossing is cheap; standing is fatal; the reset
is generous and legible. A flat 8-per-tick punishes the traversal we actually want players to attempt.

A new `sim/hazards.ts` steps once per tick over entities:

```
for each entity (player or enemy):
  tile = terrainTileAt(room, worldToTile(e.x, e.y))
  onHazard = tile === '~' && !(player && dashRemainingMs > 0)
  if (!onHazard) { e.hazardMs = 0; e.hazardStacks = 0; continue }   // reset, like Asphodel
  e.hazardMs += TICK_MS
  while (e.hazardMs >= HAZARD_INTERVAL_MS) {
    e.hazardMs -= HAZARD_INTERVAL_MS
    e.hazardStacks = min(HAZARD_STACK_MAX, e.hazardStacks + 1)
    apply HAZARD_BASE * e.hazardStacks * (isPlayer ? 1 : ENEMY_HAZARD_MUL)
  }
```

| constant | value | note |
| --- | --- | --- |
| `HAZARD_INTERVAL_MS` | 450 | one tick per tile crossed at walking speed (32 px / 190 px/s = 168 ms… so ~2.7 tiles per tick) |
| `HAZARD_BASE` | 3 | first tick costs 3 |
| `HAZARD_STACK_MAX` | 5 | so ticks run 3, 6, 9, 12, 15, 15, 15… |
| `ENEMY_HAZARD_MUL` | **1.6** | R1 and the Hades doctrine: enemies take considerably more |
| elite/gatekeeper/guardian | ×0.5 of the enemy value | bosses cannot be parked in a puddle |

What that buys: **walking straight across a 3-tile band costs 3 HP** (one tick, maybe two) and is a fine
decision. **Standing in it for 3 seconds costs 45** and is not. A husk (30 HP) chased into it for 2.2 s
dies; a swarmling (14 HP) dies in two ticks. The stack resets the moment anything steps off or dashes,
so nobody is ever killed by a hazard they had already escaped.

Damage bypasses the 350 ms `invulnerableMs` refresh (it is its own clock) but respects
`invulnerableMs > 0` at the moment it fires, so a dash's i-frames and a revive's 1000 ms grace both
protect. Source id `terrain:hazard` on the `player_damaged` event (`IdString` allows `:`; the ritual
already uses `anchor-pulse`). Two new fields on the runtime, not the snapshot: `hazardMs`,
`hazardStacks`. The renderer derives the stack glow from the player's own state, so it costs nothing
to sync.

**Precedent for the reset-on-dash rule** beyond Asphodel: Hades' dash *"cross[es] Asphodel magma and
Elysium hedges outright, and grant[s] full damage immunity for the dash"*; ALttP grants **58 frames
(~0.97 s) of invulnerability** on spike contact (`countdown_for_blink = 58`) so a mistake is never a
death spiral. Our 450 ms interval plus the reset does the same job with one fewer mechanic.

**Enemies.** Identical rules. `chaseWaypoint` is *not* taught to avoid `~` — enemies walk into it. This
is the entire point: a player who kites a husk pack across a vent band kills them with the room. A
single-line exception: enemies with `role: 'elite' | 'gatekeeper' | 'guardian'` take ×0.5, so bosses
cannot be trivially parked in a hazard.

**Co-op.** The first real use of "one of us pulls, the other holds the lane". Weaver's `tether`
(drags an enemy 135 px toward the caster) becomes a hazard-delivery tool.

**Renderer.** `environment.ts:280` already draws `~` with `palette.hazard`. Add a 600 ms pulse synced to
`HAZARD_INTERVAL_MS` so players can *see* the beat they are taking damage on, and a 1-tile inner glow
when any entity stands on it.

**Generator.** Already placed by `compiler.ts applyHazard` (4 tiles, one row, never within 1 of the
guaranteed path `pathY`). floorgen's `rooms.ts` hazard-pool mutator already reverts if it would leave
no hazard-free route. Tighten to R4's full rule (§5).

**Tests.** (a) a player standing still on `~` takes 3, 6, 9, 12, 15, 15 on successive 450 ms ticks;
(b) stepping off for one tick and back resets the next tick to 3; (c) a player dashing across a 3-tile
band takes 0; (d) a husk held in a band dies in ≤ 2.5 s; (e) a guardian's per-tick value is exactly half
the husk's; (f) `~` never appears within Chebyshev 2 of `P`, `A`, a door entry or an `anchorRelays` site.

**Why it is cut #1:** zero new tile chars, zero schema change, zero generator change, zero renderer
rewrite, and it closes a promise the renderer already makes. ~60 lines.

---

### T1 · `*` volatile canister ★ cut #2

**Feature id:** `canisters`. **Char:** `*`. **Solid** (add to `SOLID_TILES`).

**Sim rules.** Canisters are their own sparse state: `canisters: Record<"col,row", { hp, fuseMs }>`.

| constant | value |
| --- | --- |
| `CANISTER_HP` | 1 — any damage from any source arms it |
| `CANISTER_FUSE_MS` | 420 — armed → detonation, with a visible/audible fuse (R3) |
| `CANISTER_RADIUS` | 76 px (2.4 tiles) |
| `CANISTER_ENEMY_DAMAGE` | 48 |
| `CANISTER_PLAYER_DAMAGE` | 26 |
| `CANISTER_WALL_DAMAGE` | 40 — one blast destroys a `B` (36 HP) |
| `CANISTER_KNOCKBACK` | 120 px, radially, linear falloff to 0 at the rim |
| chain delay | an unarmed canister inside the radius arms with `fuseMs = 140` |

Damage falls off linearly from centre to rim (×1.0 at 0 px, ×0.35 at 76 px) and requires
`clearPath(grid, canister, target)` so a wall shields you — Isaac ships the same occlusion rule for the
same reason: *"an explosion's blast radius **does not propagate past**"* a metal block
([wiki](https://bindingofisaacrebirth.fandom.com/wiki/Blocks)). On detonation the tile becomes `:`
rubble (consistent with `B`). Chains are depth-limited to 6 to bound a pathological cluster.

**Hazard chaining is the point, and Isaac is explicit about it:** movable TNT *"auto-detonates on
contact with a Fire Place, Spiked Rock, or Red Poop"*
([wiki](https://bindingofisaacrebirth.fandom.com/wiki/TNT)). Ours: a canister pushed or knocked onto a
**firing `^` vent** or a live `~` tile arms instantly. That is 3 lines and it turns two separate tiles
into a combo the players discover rather than are told.

**Asymmetry is deliberate:** 48 to enemies vs 26 to players. Gungeon's barrels deal ~35 to enemies and
hurt you too, which is what makes shooting one a decision rather than a free button
([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Objects)); our 2:1 ratio keeps it a *good* decision at
our shorter range band. Gungeon also lets a dodge roll destroy a barrel **without** detonating it —
worth copying later as a safety valve, but not tonight.

**Enemies.** Enemy projectiles and melee also arm canisters — a sentinel volley aimed at a player
standing beside one is a real threat. `chaseWaypoint` treats `*` as solid, so enemies path around them
and cluster in the gaps between, which is exactly where you want them.

**Co-op.** Beacon's `flare` (ranged, 24 dmg) is the designated remote detonator; Bastion's `shockwave`
knocks a pack *into* a canister's radius. The 420 ms fuse is long enough for a partner to shout.

**Renderer.** A squat cylinder with a hazard chevron; when `fuseMs > 0`, a red rim flash accelerating
from 4 Hz to 12 Hz over the fuse, plus `cameras.main.shake(140, 0.005)` on detonation (the codebase
already uses exactly this for enemy attacks). Blast = expanding ring + `flash(160, …)`.

**Generator.** Placed only on `.` tiles with ≥ 6 walkable neighbours (so a blast cannot orphan a
corridor), never within Chebyshev 2 of `P`/`A`/door entries/relays, never adjacent to another canister
(chains should be a lucky read, not a carpet), count `= density` (1/2/3). Must pass R4 with `*` solid.

**Tests.** (a) a single blast destroys an adjacent `B`; (b) a chain of 3 in a line all detonate, in
order, within 700 ms; (c) a player behind a `#` from the blast takes 0; (d) the tile is `:` afterwards
and the solid grid is rebuilt; (e) chain depth is capped; (f) detonation is deterministic given the
same tick-ordered inputs (co-op desync guard).

---

### T2 · `o` pit ★ cut #3

**Feature id:** `pits`. **Char:** `o`. **Solid for walking, open for everything else.**

**Sim rules.** `o` joins `SOLID_TILES` for `moveCircle`, but:

- **Projectiles pass over it.** `stepProjectiles` tests `circleHitsSolid(grid, …)` at
  `simulation.ts:449`. Build a **second** `SolidGrid` — `projectileGrid = buildSolidGrid(room, broken,
  { pitsSolid: false })` — and point projectiles and `clearPath` at that one. Two grids, rebuilt on the
  same ticks the existing one is.
- **Dashes cross it.** While `dashRemainingMs > 0` a player's collision ignores `o`. A dash covers
  96 px = 3 tiles, so any gap of ≤ 2 tiles is dashable with margin.
- **Dash ending over a pit:** the player is snapped to `nearestOpenPosition` and takes
  `PIT_FALL_DAMAGE = 12`. No down, no instant death — a mistake, not a run-ender.
- **Knockback into a pit kills.** Any effect that displaces an entity (`bastion.e.shockwave`,
  `bastion.r.aegis_slam`, `CANISTER_KNOCKBACK`, `,` currents, the Custodian's `gravity_well`) resolves
  its displacement *before* collision; if the destination tile is `o`, the entity is removed:
  - enemy → `hp = 0`, `enemy_defeated` with `byPlayerId` = the displacer, **half** ult charge credit
    (§1.1's `ENV_KILL_CREDIT`), and `dropRemains` fires at the pit rim so lore is never lost down a
    hole. Gungeon does the same for currency: *"Shells that fall into pits reappear on top of the
    player"* ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Pit)) — a pit may eat an enemy, never a
    reward.
  - player → `hp = 1`, snapped to `nearestOpenPosition`, `invulnerableMs = 800`. Players never die to
    a pit. Gungeon charges **half a heart and a respawn at the pit edge**, and lets a dodge roll carry
    you over ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Pits)); every rule in this section is that
    page, translated to our numbers.

**Enemies.** `chaseWaypoint`'s BFS already avoids solids, so enemies path around pits and, crucially,
*bunch at the ledge* — a readable, exploitable formation. Gungeon documents the same behaviour
("non-flying enemies won't attempt crossing pits on their own") and the same exploit
([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Pits)). We have no flying enemies, so the "flyers
ignore pits" half of that design is free to add later as an enemy flag.

**Co-op.** Bastion's knockback becomes a deletion tool, which is the clearest "your class matters"
moment in the kit. Weaver's `collapse` pulls a pack toward a point: aim it past a ledge.

**Renderer.** Black interior with a 3 px inner rim lit from `palette.accent`, a 1-tile drop shadow on
the north edge, and slow motes falling in. Depth `DEPTH.floorDecal`.

**Generator.** Pits are carved as **blobs of 2–6 tiles** on `.` ground, never a 1-tile dot (reads as a
bug), never a full-width band (reads as a wall), always with R4 checked treating `o` as solid — so a pit
is never on the only route. Max 2 blobs per room; `hazardBias` (§4) decides edges vs centre.

**Tests.** (a) walking into `o` is blocked; (b) a dash crosses a 2-tile gap; (c) a dash ending over `o`
relocates the player and costs 12; (d) a shockwave that pushes a husk onto `o` emits `enemy_defeated`
and drops remains on walkable ground; (e) a player knocked onto `o` ends at 1 HP, never 0; (f) R4 holds
over 1 000 generated rooms.

---

### T3 · `^` timed vent ★ cut #4

**Feature id:** `vents`. **Char:** `^`. Walkable.

**Sim rules.** Stateless — the cycle is a pure function of tick and tile coordinates, so it costs
nothing in the snapshot and cannot desync.

```
VENT_CYCLE_MS  = 3000
VENT_GROUPS    = 3
VENT_TELL_MS   = 500          // charging, visible + audible
VENT_FIRE_MS   = 300          // live
phaseOf(col,row) = ((col*5 + row*3) % VENT_GROUPS) * (VENT_CYCLE_MS / VENT_GROUPS)   // 0 / 1000 / 2000
t = (timeMs + phaseOf(col,row)) % VENT_CYCLE_MS
state = t < VENT_CYCLE_MS - VENT_TELL_MS - VENT_FIRE_MS ? 'idle'
      : t < VENT_CYCLE_MS - VENT_FIRE_MS               ? 'charging'
      :                                                  'firing'
```

While `firing`, any entity whose centre is on the tile takes `VENT_DAMAGE = 14`, once per firing window
(tracked as `lastVentTick` per entity, not per tile). Dash immune (R2). Enemies take the same 14; elites
and bosses ×0.5, as with `~`.

Three phase groups mean a vent field is never all-on: there is always a safe third of it, so crossing is
a rhythm problem, not a dice roll. This is Isaac's retracting-spike grammar — *fixed period, safe while
retracted, deactivable from a pressure plate* — with **8 damage to non-flying enemies** as the stated
precedent for hurting both sides ([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Spikes)).
Our `_` plate (T6) is the same lever: standing on a plate of the vent field's group forces every vent in
it to `idle` while held. That is one line and it turns a hazard into a co-op puzzle.

**Enemies.** Enemies walk vent fields freely and eat the damage. The vent field is the best kiting
ground in the room.

**Co-op.** A vent field is where a two-player crew naturally splits — one kites through, one holds the
clean lane. Also the hook for the Custodian's `overload_vent` pattern (BOSS_FINALE.md §3).

**Renderer.** Idle: a flush grille. Charging: grille glows and a 4 px shimmer rises, with a rising
whistle. Firing: a 26 px column in `palette.hazard`, full-tile, plus a 60 ms white flash. The charging
state must be readable at 0.85 camera zoom from 8 tiles away — test with a screenshot.

Two readability rules worth lifting:

- **Make the dangerous state flicker, not just glow.** Isaac's creep uses ownership plus a visual tell —
  enemy creep harms only the player, player creep only enemies, and the player-harming kind *"flickers
  rapidly"* ([wiki](https://bindingofisaacrebirth.fandom.com/wiki/Creep)). A vent's 500 ms charge should
  pulse at a rate no ambient dressing in `dressing.ts` uses, so it reads as *mechanism*, not decoration.
- **Hazards must stay lit in the dark.** Spelunky's dark levels explicitly give traps candles so they
  remain visible, and Spelunky 2 goes further — *"most traps are **illuminated** to mark their
  location"* ([wiki](https://spelunky.fandom.com/wiki/Level_Feeling_(2))). This is a hard
  cross-dependency: **the `long_dark` world law (WORLD_MUTATORS §2) must exempt every
  `DANGEROUS_TILES` tile from the light radius.** Write that as a test, not a comment.

**Generator.** Vents place in **fields of 4–9 tiles** (a 2×2 to 3×3 block), 1–2 fields per room, never
on the guaranteed path, never within Chebyshev 2 of `P`/`A`/doors/relays. Because they are walkable,
R4 is automatically satisfied; the stricter rule is that the *hazard-free* route must exist, which the
existing floorgen hazard-pool check already computes.

**Tests.** (a) the cycle is pure — same `(timeMs, col, row)` gives the same state on host and client;
(b) a player standing on a vent for 9 s takes exactly 3 × 14; (c) dashing through a firing vent takes 0;
(d) at any instant at least one of the three phase groups is idle; (e) a 3×3 field never kills a
stationary husk in under 2 cycles (so the player gets to watch it work).

---

### T4 · `-` low cover ★ cut #5

**Feature id:** `cover`. **Char:** `-`. **Walkable — does not block movement.** Blocks *shots*.

**Sim rules.**

- `clearPath()` returns false through a `-` tile → hitscan attacks (`melee`, `beam`, `burst`, `charge`)
  from either side do not land, and enemy target acquisition fails, so enemies reposition (the existing
  `if (distance > stopRange || !clearPath) → chase` branch already does the right thing).
- Projectiles collide with `-` and are destroyed, dealing `COVER_HP` damage to it.
- `COVER_HP = 24`, shared pool in `TerrainState.coverDamage` (same shape as `wallDamage`). At 0 it
  becomes `:` rubble.
- **It does not block the player's own melee** at ≤ 1 tile: if the target is within `TILE_SIZE`, the
  `clearPath` check is skipped. You can hit the thing standing on the other side of the barricade.

This is the tile that makes our four ranged archetypes legible. `sentinel` (280 range, 3-bolt volley),
`warden` (260, homing), `spewer` (220, spread) and `channeler` (230, 1500 ms spiral) currently have one
counter: run at them. Cover gives a second: break the line and make them move.

**Enemies.** Enemies do not deliberately use cover (no new AI — out of budget tonight). They lose line
of sight and re-path, which reads as them flanking. Note the honest limitation in the code comment.
Gungeon does go the extra step — **Bullet Kin flip tables and use them as cover themselves**
([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Tables)) — and that is the obvious follow-up if `-`
lands well. Gungeon also draws the line we are drawing: braziers "do not provide cover" and tables do,
and the game is explicit about which is which ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Objects)).

**Co-op.** Bastion's `bulwark` already blocks beams; `-` is the free, shared version of that, so a
Beacon can hold a firing line while a Shade flanks. The clearest split-duty terrain we have.

**Renderer.** A waist-high barricade drawn at `DEPTH.propsBehind` with its top edge lit: the silhouette
must read as *half* a wall. Chipped segments as `coverDamage` rises, identical to `B`'s crack treatment.

**Generator.** Runs of 2–4 tiles, placed perpendicular to the room's long axis, in the open half of the
room, at least 3 tiles from any wall (cover against a wall does nothing). Never on doors or focus tiles.
R4 is trivially satisfied (walkable).

**Tests.** (a) a sentinel across a `-` never lands a bolt and starts chasing; (b) a player's melee at
1 tile through `-` still lands; (c) 24 damage of bolts destroys it and it becomes `:`; (d) beams are
blocked, players standing on `-` are not slowed; (e) a screenshot at 1280 px shows cover distinct from
`B` and from a `pillar` prop.

---

### T5 · `D` sealing door

**Feature id:** `sealing_doors`. **Char:** `D`. Solid while the room has live encounters; walkable once
`progress.cleared`.

Floors needs this anyway — FLOORS.md §7.5 says "the sim must treat `X` as solid while the room has live
encounters". `D` is the *interior* version: it splits a large room into two arenas so a fight escalates
in stages instead of all at once.

**Sim.** `buildSolidGrid` gains `cleared` and treats `D` as solid when `!cleared`. Rebuild the grid on
the tick `progress.cleared` flips (the code already rebuilds on wall destruction, so the hook exists).
Optionally: a `D` opens when the encounters *in its own half* are dead — needs `terrainLinks` group ids
and a flood-fill per half. **Cut that**; one room-wide flag is enough tonight.

**Co-op.** Anti-scatter. A sealed second half means the crew fights the first wave together.

**Renderer.** A portcullis that slams down with a 200 ms animation and `shake(140, 0.005)` when the
room locks, and grinds up on clear. This beat — *the door closes behind you* — is worth more for tone
than the mechanic is for tactics.

**Generator.** Across a 1–3 tile-wide neck of the room, at the narrowest cut. R4 is checked with `D`
**walkable** (it always opens) but a second check must confirm the half containing `P` also contains at
least one enemy, or the lock is meaningless.

**Tests.** (a) `D` is solid with a live enemy and walkable after `room_cleared`; (b) the grid rebuild
happens on the same tick; (c) no player can be geometrically trapped in the empty half at spawn.

---

### T6 · `_` pressure plate + `G` gate

**Feature ids:** `plates_and_gates`. **Chars:** `_` (walkable), `G` (solid until open).

**Sim rules.** Linked through the additive `terrainLinks` table (§3):
`{ kind: 'plate', x, y, group: 0..3 }` and `{ kind: 'gate', x, y, group: 0..3 }`.

```
for each group g:
  occupied = any entity (player OR enemy) whose centre is on a '_' of group g
  if occupied: gateOpenMs[g] = GATE_LATCH_MS
  else:        gateOpenMs[g] = max(0, gateOpenMs[g] - TICK_MS)
  all 'G' of group g are walkable iff gateOpenMs[g] > 0
```

| constant | co-op (≥2 players) | solo |
| --- | --- | --- |
| `GATE_LATCH_MS` | 400 (a grace window, so you can dash through as your partner steps off) | 4000 (the plate latches; solo can step off and run) |

Enemies trigger plates too. A husk wandering onto a plate opening a gate you wanted shut is the kind of
accident that makes a room memorable, and it costs nothing to allow.

**Co-op.** This is the doc's one genuinely co-op-*shaped* tile: one player holds, one passes, then the
holder is let through. The solo latch is the graceful degradation, and it is the same trick the
Custodian's phase 3 uses (BOSS_FINALE.md §4), so the game teaches the pattern twice.

**Renderer — and Zelda already solved the hold-vs-latch legibility problem.** A Link to the Past bakes
the distinction into the engine as two separate room tags (`RoomTag_SwitchTrigger_HoldDoor` vs
`RoomTag_SwitchTrigger_ToggleDoor`) and surfaces it to the player as a **colour and shape convention**:
**yellow = latches on any weight, blue = must be held down**; square = latch, round = hold
([Zelda Wiki](https://zeldawiki.wiki/wiki/Floor_Switch)). Adopt it verbatim — a solo player's latching
plate is **yellow and square**, a co-op hold plate is **blue and round**, and nobody needs telling.

Plate: a recessed square/circle that sinks 3 px and lights when occupied, with a soft *clunk*.
Gate: vertical bars, retracting into the floor over 180 ms, tinted to match the plate's group
(4 groups → 4 accent-derived hues). Draw a dim line from plate to gate when the player is within 3 tiles
— players must be able to *see* the link without a tutorial.

**The cheap sibling, if plates prove fiddly: one global toggle.** ALttP's crystal switch is a single
bit — `orange_blue_barrier_state ^= 1` — that every blue/orange block in the room reads, reset to 0 on
load, with a **9-frame hit window** so a charging sword can't flip it, and a sparkle every 31 frames so
it advertises itself (`zelda3`, `Sprite_1E_CrystalSwitch`, ROM `86b8d0`). Our version: one shootable
`switch` prop per room flipping which of two gate groups is open. It is a third of the code of
plates-and-gates and gives most of the tactical value; plates are only worth their extra complexity for
the co-op hold. Note also the colour trap ALttP set and later games inverted: **the switch's colour
matches the LOWERED set**, not the raised one ([Zelda Wiki](https://zeldawiki.wiki/wiki/Elevator_Block)).
Pick a convention and write it in the test name.

**Generator.** Gates guard **optional** regions only unless R4 passes with `G` solid. Formally: a gate
may be the sole route into a region *iff* that region contains no door, no `P`, no `A`, and no
encounter — i.e. treasure alcoves only. Everything else must have a second way round.

**Tests.** (a) the gate opens while occupied and closes 400 ms after; (b) solo latch is 4000 ms;
(c) an enemy on the plate opens the gate; (d) 1 000 generated rooms: no `G` is ever the sole route to a
door/spawn/anchor/encounter; (e) a `G` closing on a player does not clip them into geometry (use
`nearestOpenPosition` on close).

---

### T7 · `%` crumbling floor

**Feature id:** `crumbling_floor`. **Char:** `%`. Walkable, once.

**Sim rules.** `crumble: Record<"col,row", number>` (ms stood on).

```
CRUMBLE_MS   = 700       // cumulative occupancy before it goes
CRUMBLE_WARN = 0.5       // visual crack at 50%
```

Occupancy by any entity accumulates; dashes **do** count (this is weight, not damage — R2 does not
apply, and the exception is worth it because it makes `%` the one tile a dash cannot cheat). Gungeon
keeps exactly one such exception for exactly this reason: rolling spikes *"cannot be dodge-rolled
through"* ([wiki](https://enterthegungeon.fandom.com/wiki/Traps)). One tile that ignores the universal
answer is a spike of tension; two would be a broken promise. At
`CRUMBLE_MS` the tile becomes `o` **permanently** for the run, with a 220 ms collapse animation during
which it is already open. Anything standing on it resolves as a pit entry (T2): enemy dies, player goes
to 1 HP at the nearest ledge.

**Enemies.** Enemies do not know. A pack chasing you across a `%` field deletes itself. This is the
tile that most rewards kiting, and it is the arena-erosion tool the Custodian's phase 2 uses.

**Co-op.** Shared attrition: the floor two players cross is gone faster than the floor one crosses. It
makes a co-op room *harder over time* without a single balance number, which is a nice free property.

**Renderer.** Hairline cracks at 25%, a spidering web + dust puff at 50%, tiles tilting at 85%. Collapse
= debris falling into the hole with a 200 ms trail.

**Generator.** Fields of 6–12 tiles, at most one per room, **never** on the guaranteed path and never
adjacent to a door entry (a room must still be traversable after the whole field is gone — check R4
with the entire `%` field pre-converted to `o`). That single check makes crumbling floors safe.

**Tests.** (a) 700 ms of cumulative standing converts it; (b) two players standing convert it in 350 ms;
(c) a husk on a collapsing tile dies and drops remains on solid ground; (d) R4 holds with the whole field
converted, over 1 000 rooms; (e) the converted tile persists across a room re-entry (it is in
`RoomProgress`, which `rooms` already caches per index).

---

### T8 · `,` current

**Feature id:** `currents`. **Char:** `,`. Walkable. Direction from `terrainLinks`:
`{ kind: 'current', x, y, dir: 'north'|'south'|'east'|'west' }` (default `east` if absent).

**Sim.** In the movement integration, after the normal velocity is computed:
`vx += CURRENT_SPEED * dirX; vy += CURRENT_SPEED * dirY` for any entity whose centre is on a `,`.
`CURRENT_SPEED = 110 px/s` — 58% of `PLAYER_SPEED`, so you can walk against it (at 80 px/s) but you
cannot ignore it. Dashes (640 px/s) override it entirely (R2).

ALttP's conveyor is **exactly 0.5 px/frame = 30 px/s ≈ 1.9 tiles/s** (`Link_ApplyConveyor`, ROM
`87e5f0`, adding `±8 << 4` into a 16.8 fixed-point accumulator), which is *faster than Link walks* — so
its belts genuinely dictate position. It exempts three states: **airborne**, **wall-grab/hookshot**, and
**dashing at full charge in the belt's own direction**. Ours is deliberately weaker (58% of walk speed)
because our rooms are combat arenas rather than puzzle rooms and being unable to hold a firing position
is worse than being unable to solve a puzzle. If currents feel toothless in play, **raise
`CURRENT_SPEED` toward 190 before adding a second mechanic** — Zelda's number says the aggressive end
of the range is playable.

Currents apply to **projectiles too** (`vx/vy` nudged by 110 px/s while over a `,`), which bends bolt
lanes and is the cheapest "this world has physics we don't" moment in the doc.

**Enemies.** Pushed identically. `chaseWaypoint` does not compensate, so enemies slide and overshoot —
readable, funny, and exploitable. A current lane pointing into a pit or a vent field is a kill lane you
build a fight around.

**Co-op.** A conveyor into a hazard is a shared setup: one player tethers/knocks an enemy in, the other
keeps the lane clear. Gungeon's minecarts are the nearest published relative — frictionless, they keep
moving until you get out, and in co-op **two players can share one but only one steers**
([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Objects)). Currents are the ungated version of that:
no boarding, no steering, no new input.

**Renderer.** Directional chevrons scrolling at 110 px/s (the actual speed — never lie about the number),
plus a faint streak on anything standing on it. Reuse `+` conduit's chevron drawing with a pan.

**Generator.** Lanes of 3–6 tiles in a straight line, ending in `o`, `~`, `^` or a wall. Never pointing
at a door entry, `P`, `A` or a relay. Max 2 lanes per room. R4 trivially holds (walkable).

**Tests.** (a) a stationary player on an east current drifts at exactly 110 px/s; (b) walking west on it
nets 80 px/s; (c) a dash is unaffected; (d) a bolt crossing a 4-tile lane is deflected by the expected
offset; (e) no lane terminates at a door.

---

### T9 · `"` veil — line-of-sight fog

**Feature id:** `veils`. **Char:** `"`. Walkable, blocks **vision**, passes **projectiles**.

**Sim.** A second grid, `visionGrid`, where `"` is opaque. Used in exactly two places:

- enemy target acquisition: an enemy cannot select a player when the segment between them crosses a `"`
  and the distance is > 64 px (inside 64 px, they find you by touch);
- hitscan resolution (`melee`/`beam`/`burst`/`charge`): unchanged — those already use `clearPath`, to
  which `"` is **transparent**. A beam goes through the veil; the enemy just cannot aim it at you.

Projectiles pass through. This is the important distinction from `-` cover: **`-` stops the bullet,
`"` stops the aim.** Standing in a veil is safe only while nothing already has a lock on you.

**Enemies.** An enemy that loses its target holds its last known position for 900 ms (`lastSeen`), walks
to it, then idles. That is 6 lines and it is what makes the veil feel like hiding rather than like a bug.

**Co-op.** Shade's `shroud` (2.2 s, enemies lose you) already exists; `"` is the free version everyone
gets, and a veil is where a downed teammate can be revived (the 2 s `REVIVE_DURATION_MS` is otherwise
nearly impossible under fire).

**Renderer.** A soft particle volume at `DEPTH.fog - 1`, `atmosphere`-tinted, with entity alpha dropping
to 0.55 inside it. Players inside see out normally — **never** obscure the player's own information.

**Generator.** Patches of 4–9 tiles, 1 per room, at least 4 tiles from the spawn, preferring corners.
Walkable → R4 trivially holds. Forbidden in the final room (the Custodian's telegraphs must be legible).

**Tests.** (a) a sentinel with a veil between it and a player never telegraphs; (b) the same sentinel at
50 px still attacks; (c) a bolt already in flight crosses the veil unaffected; (d) a beam fired from
inside the veil hits normally; (e) `"` never generates in `isFinal` rooms.

---

### T10 · `S` secret wall *(bonus — only worth it once floorgen makes secret rooms)*

**Feature id:** `secret_walls`. **Char:** `S`. Renders **identically to `#`**; solid; destroyed by any
single point of damage.

FLOORS.md §8 lists secret rooms as not generated. `S` is the tile they will need, and Isaac's placement
rule is precise: pick an **empty cell adjacent to at least three rooms**, avoiding cells next to dead
ends; if no cell qualifies after 300 attempts, relax the criteria, and again after 600, so **the secret
room is always placed** — "generally wedged near intersections"
([Boris the Brave](https://www.boristhebrave.com/2020/09/12/dungeon-generation-in-binding-of-isaac/)).
Note that this is a deliberate exception to Isaac's own "don't place next to >1 filled neighbour" rule,
which FLOORS.md §4 already implements verbatim — so the exception has to be coded as one.

Our equivalent: the floorgen pass finds such a cell, builds a small treasure room, and marks the shared
border tile `S`. The "relax, never fail" structure is the same one floorgen's `MAX_ATTEMPTS = 60` +
deterministic comb fallback already uses, so it is a known shape in this codebase.

Tell: a seam drawn at alpha 0.08 (visible if you look, invisible if you don't) plus a hollow *knock*
audio ping when a player is within 64 px. No map marker. The audio channel is not a nicety — ALttP
ships exactly this: *"Cracked Floor Tiles make a **stark sound when hit by the Sword**"*
([Zelda Wiki](https://zeldawiki.wiki/wiki/Cracked_Floor_Tile)), a second sensory channel for a tell the
eye is meant to miss. Tunic reduces it further to a rule the player is simply told — *"Touch Every
Wall"* — with breakable walls activated by hitting **or dashing into** them, and hidden passages that
are two-way so they *"become apparent when exited through the hidden side"*
([wiki](https://tunic.fandom.com/wiki/Puzzles)). Make ours two-way for free.

**Cheapest possible placement, and it is one RNG roll.** Isaac's Crawl Space: roll one tile index in the
room's grid; **if that tile happens to be a plain rock, breaking it opens the secret; if the roll lands
on a prop, spike or void tile, nothing spawns at all**
([wiki](https://bindingofisaacrebirth.fandom.com/wiki/Crawl_Space)). No search, no validation, no
failure path — the miss *is* the design. Our version: roll one `(col,row)`; if it is a `#` with exactly
one walkable orthogonal neighbour, make it `S`; otherwise this room has no secret. Three lines.

ALttP also ships the troll, as a first-class distinction in the room-object table: object **`0x47`
"Bomb Floor"** versus **`0x48` "Fake Bomb Floor"** (`zelda3`). A cracked-looking tile that does nothing
is *authored*, not a bug. Worth exactly one per world, and worth none tonight.

**Cut it tonight** — it depends on a floorgen pass that does not exist. Listed so the char is reserved
and the renderer contract is fixed.

---

## 3 · Registry + schema changes (exact)

### 3.1 `src/shared/registry.ts`

```ts
// EXTEND — do not reorder or remove existing entries.
export const TILE_CHARS = [
  '#', '.', ' ', '~', 'P', 'X', 'A', 'B', '=', '>', ':', '+',   // PR #16 + base
  '*', 'o', '^', '-', 'D', '_', 'G', '%', ',', '"', 'S',        // this doc
] as const;

export const SOLID_TILES: ReadonlySet<string> = new Set(['#', ' ', 'B', '*', 'o', 'S']);
// 'D' and 'G' are conditionally solid -> handled in buildSolidGrid(room, broken, ctx), not here.
export const WALKABLE_TILES: ReadonlySet<string> = new Set([
  '.', '~', 'P', 'X', 'A', '=', '>', ':', '+', '^', '-', '_', '%', ',', '"', 'D', 'G',
]);
/** Tiles that damage or delete an entity. Used by the generator's safety checks. */
export const DANGEROUS_TILES: ReadonlySet<string> = new Set(['~', '^', '%', 'o', '*']);

export const TERRAIN_FEATURE_IDS = [
  'breakable_walls', 'bridges', 'rubble', 'conduits',                       // PR #16
  'hazard_floor', 'canisters', 'pits', 'vents', 'cover',                    // combat-facing
  'sealing_doors', 'plates_and_gates', 'crumbling_floor', 'currents', 'veils', 'secret_walls',
] as const;

export const TERRAIN_LAYOUT_IDS = ['scattered', 'barricades', 'crossroads', 'gauntlet', 'arena'] as const;
export const HAZARD_BIAS_IDS = ['none', 'edges', 'centre', 'lanes'] as const;
```

`TERRAIN_FEATURE_INFO` gains one honest sentence per new id (it is injected verbatim into the model
prompt by `provider.ts:74`, so it is the tile's only documentation as far as the model is concerned).
Keep the existing house style: *char, what it does, the number.*

### 3.2 `src/shared/contracts.ts`

```ts
export const TerrainLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current'), x: TileCoord, y: TileCoord,
             dir: z.enum(['north', 'south', 'east', 'west']) }),
  z.object({ kind: z.literal('plate'),   x: TileCoord, y: TileCoord, group: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal('gate'),    x: TileCoord, y: TileCoord, group: z.number().int().min(0).max(3) }),
]);

// RoomSpecSchema gains (additive, optional — legacy rooms and fixtures stay valid):
terrainLinks: z.array(TerrainLinkSchema).max(64).default([]),
```

`superRefine` additions: each link's `(x,y)` must carry the matching char; every `,` `_` `G` tile must
have exactly one link; every plate group in use must have ≥ 1 gate and vice versa.

`GameSnapshot.terrain` gains (all optional, all sparse, all capped):

```ts
terrain: z.object({
  brokenWalls: z.array(...).max(2048),
  wallDamage:  z.record(...),
  coverDamage: z.record(TileKey, z.number().nonnegative()).optional(),
  canisters:   z.record(TileKey, z.object({ fuseMs: z.number().nonnegative() })).optional(),
  crumbled:    z.array(TileKey).max(512).optional(),
  crumbleMs:   z.record(TileKey, z.number().nonnegative()).optional(),
  gateOpenMs:  z.array(z.number().nonnegative()).length(4).optional(),
}).optional()
```

Vents carry **no** state (pure function of `timeMs`), which is the reason they are in the one-night cut
and `%` is not.

## 4 · The LLM-creative layer — exact bounded schema

The repo already has the right pattern and we should copy it rather than invent one: `AttunementSchema`
(`contracts.ts:393`) is `{ effectId: <closed enum>, name: <40 chars>, description: <160 chars> }` — the
engine owns the mechanic, the world owns the identity. Everything below is that shape.

### 4.1 Per-world skins (the model names each mechanic)

```ts
export const TerrainSkinSchema = z.object({
  featureId: z.enum(TERRAIN_FEATURE_IDS),
  /** In-world name. "tide-gauge vents", "ledger stacks", "the sump". */
  name: z.string().trim().min(1).max(28),
  /** Replaces the hard-coded HUD caption in render/terrain.ts terrainCaption(). */
  caption: z.string().trim().min(1).max(60),
});
// WorldRecipeSchema gains:
terrainSkins: z.array(TerrainSkinSchema).max(15).default([]),
```

Rules the compiler enforces (never the model):
- one skin per `featureId`, at most one entry per id, unknown ids rejected;
- a skin for a feature the world does not use is dropped silently;
- `caption` runs through W1's `src/shared/prose.ts` linter; failures fall back to the registry's
  built-in caption, which stays in `TERRAIN_FEATURE_INFO`. **The default is always present**, so a bad
  generation degrades to today's text rather than to nothing;
- the sim never reads `terrainSkins`. Determinism and co-op sync cannot be affected by it.

Today `terrainCaption()` hard-codes `'RUBBLE · slows footsteps, not dashes'`. It becomes
`skin?.caption ?? TERRAIN_CAPTION[featureId]`. Six lines.

### 4.2 Per-room parameters (the model tunes each room)

```ts
export const RoomTerrainSchema = z.object({
  features:  z.array(z.enum(TERRAIN_FEATURE_IDS)).max(4),   // unchanged
  layout:    z.enum(TERRAIN_LAYOUT_IDS),                    // + 'gauntlet' | 'arena'
  density:   z.enum(TERRAIN_DENSITIES),                     // unchanged
  /** 0 = gentlest legal value, 1 = harshest. Interpolates INSIDE a hard-clamped band. */
  intensity: z.number().min(0).max(1).default(0.5),
  /** Where hazards prefer to sit. Generator hint only; never overrides reachability. */
  hazardBias: z.enum(HAZARD_BIAS_IDS).default('edges'),
});
```

**`intensity` is the whole safety argument.** The model picks one number in [0,1]; trusted code decides
what that number *means*, and the endpoints are chosen so both are shippable:

| constant | `intensity = 0` | `intensity = 1` | formula |
| --- | --- | --- | --- |
| `HAZARD_INTERVAL_MS` | 600 | 350 | `round(lerp(600, 350, i))` |
| `HAZARD_BASE` | 2 | 4 | `round(lerp(2, 4, i))` |
| `HAZARD_STACK_MAX` | 4 | 6 | `round(lerp(4, 6, i))` |
| `VENT_CYCLE_MS` | 4000 | 2400 | `round(lerp(4000, 2400, i))` |
| `VENT_DAMAGE` | 10 | 18 | `round(lerp(10, 18, i))` |
| `CRUMBLE_MS` | 1100 | 500 | `round(lerp(1100, 500, i))` |
| `CANISTER_FUSE_MS` | 600 | 300 | `round(lerp(600, 300, i))` |
| `CURRENT_SPEED` | 70 | 140 | `round(lerp(70, 140, i))` |
| `COVER_HP` | 34 | 18 | `round(lerp(34, 18, i))` |

Nothing else scales. `CANISTER_PLAYER_DAMAGE`, `PIT_FALL_DAMAGE` and the knockback numbers are fixed,
because a world that can make its own canisters lethal is a world that can generate an unwinnable room.

`layout` additions:
- `gauntlet` — hazards and cover form parallel lanes along the room's long axis; the crew picks a lane.
- `arena` — hazards ring the perimeter, the centre is clean; the fight pulls inward. Best for exits.

### 4.3 Per-biome look (how the same tile looks like a different thing)

The renderer already maps `MotifId → FloorPattern` and `MotifId → MoteStyle` (`dressing.ts:30,42`).
Extend the same table-driven idea to the new tiles: `TILE_SKIN: Record<MotifId, TileSkinSpec>` where
`TileSkinSpec` picks, per feature, one of 3–4 hand-drawn variants:

| feature | `ruined_machinery` | `roots` | `crystals` | `lanterns` |
| --- | --- | --- | --- | --- |
| `vents` | steam jets from grilles | thorn spikes from the soil | shard eruptions | flame vents |
| `canisters` | pressure cylinders | seed pods | unstable geodes | oil jars |
| `pits` | open ducting | root hollows | fissures | wells |
| `cover` | sheet-metal barricade | fallen trunk | shard bank | crate stack |

The model picks `motifIds`; the renderer picks the variant. **The model never emits art.** This is the
same contract `dressing.ts` already documents at the top of the file, extended by four rows.

## 5 · Generator placement — the reachability contract

**The insight that makes this tractable, from the game where literally everything is destructible:**
Spelunky does not *preserve* reachability against destruction. It **guarantees a path before placing
anything**, and destruction can then only ever *add* connectivity, never remove it — hazards are layered
on last. Derek Yu's own description of the order: *"A path is drawn from the entrance of the level at
the top, to the exit at the bottom… Each room is selected from a set of room templates… [then] I add the
**critters, traps, treasures**, and other fun stuff!"*
([Make Games](https://makegames.tumblr.com/post/4061040007/the-full-spelunky-on-spelunky)). Spelunky 2
states the resulting guarantee outright: the main path *"can be initially passed through **without the
help of resources**"* ([wiki](https://spelunky.fandom.com/wiki/Level_Generation/2)).

floorgen already does the first half — `buildRoom` guarantees spawn/doors/focus mutual reachability
before any terrain runs (FLOORS.md §5). So our rule is simply: **terrain is a strictly additive layer
applied after that guarantee, and the only tiles that may subtract connectivity (`o`, `*`, `G`, `S`) are
re-checked against it.** That is what §5's S1–S3 encode.

Isaac states the player-facing half of the contract as a sentence worth copying into the test name:

> *"Rooms adjacent to Secret Rooms will always have a **clear, walkable path to the middle of the wall**"*
> — never behind gaps, obstacles, spikes, or enemy spawn points
> ([wiki](https://bindingofisaacrebirth.fandom.com/wiki/Secret_Room))

That is S4, generalised: **anything the player must reach has a clean approach, and no hazard is ever
placed on it.**

One function, `validateRoomSafety(room): string[]`, run in tests over every generated room and in the
compiler before a room is committed. It returns the list of violated rules; non-empty = regenerate.

```
S1  Every pair of {spawn P, each door entry, focus/A, each relic, each encounter, each anchorRelay}
    is mutually reachable by 4-way flood where {#, ' ', B, *, o, S} and every 'G' are SOLID
    and every 'D' is WALKABLE.
S2  A hazard-free route exists between the same set, where {~, ^, %, ,} are also blocked.
    (floorgen's rooms.ts already computes this for '~'; extend the blocked set.)
S3  R4 under full decay: repeat S1 with every '%' tile pre-converted to 'o' and every 'B' still SOLID.
S4  No tile of DANGEROUS_TILES within Chebyshev 2 of P, A, any door entry, or any anchorRelay.
S5  No 'G' is the sole route to a region containing a door, P, A, or an encounter.
S6  Every ',' lane terminates in a wall or a DANGEROUS tile, never at a door entry / P / A / relay.
S7  Every ',' '_' 'G' tile has exactly one matching terrainLinks entry, and every group in use has
    at least one plate and at least one gate.
S8  Counts per room: pits ≤ 2 blobs (2..6 tiles each), vents ≤ 2 fields (4..9), '%' ≤ 1 field (6..12),
    canisters ≤ 3 and never orthogonally adjacent, cover ≤ 3 runs (2..4), currents ≤ 2 lanes (3..6),
    veils ≤ 1 patch (4..9), 'D' ≤ 2, plate/gate groups ≤ 4.
S9  'veils' and 'crumbling_floor' are forbidden in isFinal rooms (boss legibility, arena integrity).
```

Order of operations in `applyTerrain`: **structure first, then hazards, then check.**
`bridges → breakable_walls → sealing_doors → plates/gates → pits → cover → canisters → vents →
crumbling → currents → veils → hazard_floor`, then `validateRoomSafety`. On failure, drop the
*last-placed* feature group and re-check, up to 4 times, then fall back to `density = 'sparse'` with
only `breakable_walls`. It must be impossible for a room to fail to compile because of terrain.

Property test, mirroring floorgen's existing 1 000-seed fuzz: generate 1 000 rooms across all 15
features × 3 densities × 5 layouts × intensity ∈ {0, 0.5, 1}; assert `validateRoomSafety` is empty for
every one, and assert byte-identical output for equal seeds (co-op determinism).

## 6 · One-night cut — 5 tiles, in priority order

Built in this order, each independently shippable; stop wherever the clock stops.

| # | tile | why it is here | new chars | est. |
| --- | --- | --- | --- | --- |
| 1 | `~` **hazard floor becomes real** (T0) | The renderer already promises it. Zero new chars, zero schema change, zero generator change. Unlocks "terrain hurts enemies" — the premise of everything else, and the Custodian's phase-2 twist. | 0 | ~60 lines |
| 2 | `*` **volatile canister** (T1) | Biggest "the room is a weapon" payoff per line. Chains, opens `B` walls, gives ranged classes a reason to aim at scenery. Its blast code is reused by the `unstable_matter` world law (WORLD_MUTATORS §2). | 1 | ~140 lines |
| 3 | `o` **pit** (T2) | Turns Bastion's knockback and Weaver's pull into deletion tools — the clearest class-identity moment available tonight. Reachability rule is one flag on the existing flood. | 1 | ~120 lines |
| 4 | `^` **timed vent** (T3) | Stateless (pure function of `timeMs`), so it costs nothing in the snapshot and cannot desync. Gives the boss's phase-2 twist something to weaponise. | 1 | ~100 lines |
| 5 | `-` **low cover** (T4) | Makes our four ranged archetypes legible, and it is nearly free because `clearPath` already gates every hitscan attack and every enemy's target acquisition. | 1 | ~90 lines |

Then, if time remains: `D` sealing doors (F2 wants it anyway), `_`/`G` plates and gates, `%` crumbling.
`,` currents, `"` veils and `S` secret walls are explicitly out tonight.

Ship alongside the cut, non-negotiable:
- `TerrainSkinSchema` + the six-line `terrainCaption` change (§4.1) — this is the "let the LLM be
  creative" half of the ask and it is the cheapest thing in the doc;
- `intensity` (§4.2) with the clamp table;
- `validateRoomSafety` S1–S4 + S8 and the 1 000-room fuzz.

## Needs a human call

- **Co-op and hazards — the two shipped answers point in opposite directions, and we must pick one.**
  Gungeon keeps hazards **fully shared** (no friendly fire, enemy HP +40%) and adds one anti-trap rule:
  *"Doors may only be opened if **both players press against the door simultaneously**, preventing
  players from getting trapped"* ([wiki.gg](https://enterthegungeon.wiki.gg/wiki/Co-op)). Isaac takes
  the opposite route — **co-op babies always have flight**, so spikes, pits and fires simply do not
  exist for player 2, while the host still pays
  ([wiki](https://bindingofisaacrebirth.fandom.com/wiki/Co-op)). Every co-op angle in §2 assumes
  Gungeon's model. If someone wants the Isaac model for accessibility, it has to be decided before T1
  starts, because it changes what `DANGEROUS_TILES` means per-player.
- **`SOLID_TILES` / `WALKABLE_TILES` are read by floorgen's tests** (FLOORS.md §7.5 explicitly relies on
  this). Adding chars is additive, but F1a's "legal chars only" assertions will need the new sets — that
  is a cross-agent edit to `registry.ts`, which F1b owns tonight. Someone must sequence T1 after F1b.
- **Tile-char budget, and the shape of the fix.** This doc spends 11 chars and the world is a text grid.
  ALttP hit the same wall and solved it by reserving a **contiguous band of tile types, `0x70`–`0x7F`
  "ManipulablyReplaced"**, for everything the engine rewrites at runtime — pushed blocks, opened chests,
  extinguished torches (`zelda3`, `src/tile_detect.c`). Our equivalent is a parallel `overlay[][]` grid
  or a reserved char range, and the decision is cheap now and expensive after T1 ships. If anyone wants
  water, ice, one-way doors or breakable props later, decide this first.
- **Enemies never use cover or avoid hazards.** That is honest and cheap, but a judge may read
  "enemies walk into fire" as a bug rather than as the mechanic. Worth 20 lines of "elites path around
  `DANGEROUS_TILES`"? My call: no, tonight. Flagging it because it will be noticed.
- **Do vents/canisters get audio?** Every hazard in §2 assumes an audio tell (R3), and the research is
  consistent that the tell is a *redundant channel*, not a garnish — ALttP's cracked floors sound
  different under the sword, Spelunky lights its traps in dark levels, Isaac flickers player-harming
  creep. If the audio budget is zero tonight, the visual tells need to be ~40% louder than specified,
  and that is an art call somebody has to make rather than discover at 8 a.m.
