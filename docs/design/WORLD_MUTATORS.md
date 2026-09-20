# WORLD MUTATORS — laws the world writes for itself, and how worlds stop looking alike

**Status: design only. Nothing here is implemented.** This answers the lead's third ask: *"ideally the AI
can also script strong gameplay mechanics or changes that help the game feel less repetitive and more
different between worlds, and can also change up how things look in the worlds."*

Two halves, because those are two different problems:

- **§1–4 — Laws.** A closed registry of 18 world-level rule changes. The model picks **2–3** per world
  and names them in-world. They touch movement, combat, enemies, terrain, economy and vision.
- **§5 — Look.** Bounded art parameters beyond palette, so two worlds are distinguishable in a
  screenshot with the sound off.

Neither half lets the model emit code, expressions, or an unbounded number. Every law is
`{ closed id, model-written name, one float in [0,1] }`, which is exactly the shape
`AttunementSchema` (`contracts.ts:393`) already uses and the compiler already validates.

## 0 · Why this is the highest-value ask of the three

Measured, not asserted. The three shipped fixture worlds differ as follows:

| | Vantage Spire | Crystal Tide | Root Archive |
| --- | --- | --- | --- |
| `motifIds` | cables, spires, lanterns | crystals, arches, monoliths | roots, ruined_machinery, lanterns |
| `art.fog` | 0.35 | 0.38 | 0.37 |
| `art.glowIntensity` | 0.60 | 0.57 | 0.84 |
| `art.paletteFamily` | `ink-neon` | `ink-neon` | `ink-neon` |
| rules of play | identical | identical | identical |

`ArtRecipeSchema.paletteFamily` is `z.literal('ink-neon')` — there is exactly one family and the schema
enforces it. `fog` lands in a 0.03 band across all three worlds. So the entire observable difference
between two RELAY worlds today is **a hue rotation, three motif choices, and the prose**. The
simulation is byte-for-byte the same game.

That is the repetition the lead is describing, and laws + look parameters are the cheapest fix: neither
needs new content, new art assets, new enemies or new rooms. They reinterpret what already exists.

### 0.1 · What the shipped systems actually do — and the rule they share

| system | a representative entry | exact effect |
| --- | --- | --- |
| RoR2 Artifacts | **Glass** | "Allies deal **500% damage**, but have **10% health**." |
| | **Swarms** | "Monster spawns are **doubled**, but monster maximum health is **halved**." |
| | **Honor** | Enemies can **only** spawn as elites |
| | **Spite** | Enemies drop exploding bombs on death |
| | **Kin** | Monsters become **one type per stage** |
| | **Frailty** | "Fall damage is **doubled and lethal**." |
| | **Chaos** | Friendly fire enabled |
| Isaac Curses | **Curse of Darkness** | The floor becomes significantly darker; visibility is limited to Isaac's aura |
| | **Curse of the Lost** | Removes the map from the HUD **and increases the floor's room count by 4** |
| | **Curse of the Maze** | Entering a room "will occasionally take Isaac to the wrong room, with a screen-shake and sound effect" |
| | **Curse of the Blind** | Item sprites become question marks until picked up |
| | **Curse of the Labyrinth** | Merges a chapter's two floors into one XL floor with **two** boss rooms and **two** treasure rooms |

Sources: [RoR2 wiki.gg](https://riskofrain2.wiki.gg/wiki/Artifacts) ·
[Isaac wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Curses)

Three observations that shape everything below.

1. **Almost none of them are difficulty sliders.** RoR2's artifacts are *rule* changes — friendly fire,
   one monster type, items from monsters instead of chests. Isaac's curses are almost entirely
   **information** changes: no map, no health bar, no item sprites, darkness. Neither system's flagship
   entries touch a damage number. The lead asked for "changes that help the game feel less repetitive",
   and the shipped answer to that is *change what the player knows and what the rules are*, not *change
   what the numbers are*.
2. **The good ones trade.** Glass is 500%/10%. Swarms is ×2 spawns / ÷2 health. Curse of the Lost takes
   your map **and gives you four more rooms**. A one-directional nerf is a difficulty setting; a trade
   is a law. Every entry in §2 that is worth shipping has a trade in it, and the ones that don't
   (`wardens_watch`, `long_dark`) carry a +2 budget to pay for it.
3. **They are implementable in single-digit lines.** "Monster spawns doubled, health halved" is two
   multipliers. That is the bar for §2: if a law needs new runtime state, it is not in the one-night cut.

## 1 · Schema

```ts
// src/shared/laws.ts  — new file, no merge conflict with #16 or F1b's contracts pass
export const WORLD_LAW_IDS = [
  // movement
  'thin_air', 'tidal_drag', 'committed_strike',
  // combat
  'glass_lattice', 'long_echo', 'bleeding_light', 'first_light',
  // enemies
  'few_and_terrible', 'the_many', 'wardens_watch', 'restless', 'unstable_matter',
  // terrain
  'hollow_ground', 'slow_fire', 'sealed_halls',
  // vision / look
  'long_dark', 'mirror_halls', 'held_breath',
] as const;
export type WorldLawId = (typeof WORLD_LAW_IDS)[number];

export type LawGroup = 'movement' | 'combat' | 'enemies' | 'terrain' | 'vision';

export const LAW_INFO: Record<WorldLawId, {
  group: LawGroup;
  /** Injected verbatim into the model prompt by provider.ts. One sentence, with the number. */
  summary: string;
  /** Difficulty budget: negative = helps the crew, positive = hurts. See §3. */
  budget: -2 | -1 | 0 | 1 | 2;
}>;
```

```ts
export const WorldLawSchema = z.object({
  lawId: z.enum(WORLD_LAW_IDS),
  /** The world's name for this law. "The Long Dark", "Ledger Law". */
  name: z.string().trim().min(1).max(36),
  /** Shown on the creation receipt and the pre-portal card. Goes through prose.ts. */
  description: z.string().trim().min(1).max(160),
  /** Interpolates INSIDE the law's hard-clamped band. The model never sets a raw number. */
  intensity: z.number().min(0).max(1).default(0.5),
});
export type WorldLaw = z.infer<typeof WorldLawSchema>;

// WorldRecipeSchema gains:
laws: z.array(WorldLawSchema).max(3).default([]),
```

Everything downstream reads **one resolved object**, computed once per world in the compiler:

```ts
export interface ResolvedLaws {
  // movement
  dashSpeedMul: number; dashDurationMul: number; dashCooldownMul: number;
  walkSpeedMul: number; attackMoveMul: number;
  // combat
  playerMaxHp: number; playerDamageMul: number;
  abilityCooldownMul: number; ultChargeMul: number;
  abilityHealMul: number; relicHealHp: number; firstStrikeMul: number;
  // enemies
  enemyCountMul: number; enemyHpMul: number; enemyDamageMul: number;
  eliteFraction: number;
  deathBlast: { radius: number; playerDamage: number; enemyDamage: number } | null;
  reanimate: { delayMs: number; hpFraction: number; windowMs: number } | null;
  // terrain
  terrainFeatureBonus: number; terrainDensityStep: number;
  hazardDilation: { radius: number; speedMul: number; projectileMul: number } | null;
  splitRooms: boolean;
  // vision
  lightRadius: number | null; hideMinimap: boolean; telegraphMul: number; muteTells: boolean;
}

export const NEUTRAL_LAWS: ResolvedLaws = { /* every multiplier 1, every nullable null */ };
export function resolveLaws(laws: readonly WorldLaw[]): ResolvedLaws;
```

`NEUTRAL_LAWS` is the whole safety story. Every call site becomes `× laws.walkSpeedMul` with a default
of 1, so a world with no laws is bit-identical to today's game and the legacy fixtures stay green.
`resolveLaws` is pure, so co-op determinism is unaffected — the host sends `laws` in `PreparedWorld` and
both ends resolve the same object.

## 2 · The registry

Numbers are at `intensity = 0.5`; the band is `[i=0 → i=1]`. Baselines: `PLAYER_MAX_HP = 100`,
`PLAYER_SPEED = 190`, `DASH_SPEED = 640`, `DASH_DURATION_MS = 150` (96 px), `DASH_COOLDOWN_MS = 800`,
`TILE_SIZE = 32`.

### Movement

**`thin_air`** · budget **−1** · *dashes carry further*
`dashSpeedMul = lerp(1.20, 1.60, i)` · `dashDurationMul = lerp(1.15, 1.40, i)` · `dashCooldownMul = lerp(1.10, 1.35, i)`.
At 0.5: dash covers **158 px (4.9 tiles)** instead of 96, on a 1000 ms cooldown instead of 800. Enemies
unaffected. Interacts with every hazard in TILES.md — pits become jumpable, vent fields crossable in one
move — so it is the law that most changes *routes*.
**Touch points:** `simulation.ts` `stepPlayer` (2 lines).

**`tidal_drag`** · budget **0** · *everything moves through something*
`walkSpeedMul = lerp(0.90, 0.75, i)` for **players and enemies** · `dashCooldownMul = lerp(0.80, 0.55, i)`.
At 0.5: walk 157 px/s, dash cooldown 540 ms. Turns the game from walking-with-dashes into
dashing-with-walks. Difficulty-neutral, feel-transforming — the best kind of law.
**Touch points:** `stepPlayer`, `stepEnemy` (the `terrainSpeedMultiplier` call sites already exist).

**`committed_strike`** · budget **0** · *you cannot walk out of your own swing*
`attackMoveMul = lerp(0.20, 0.0, i)` (default 0.35) · `playerDamageMul = lerp(1.15, 1.35, i)`.
At 0.5: you are **rooted for the 220 ms of your attack** and hit for 25% more. Changes every class's
spacing without touching a single ability.
**Touch points:** `stepPlayer`'s speed expression, `damageEnemy`.

### Combat

**`glass_lattice`** · budget **+2** · *thin walls, bright light*
`playerMaxHp = round(lerp(60, 35, i))` · `playerDamageMul = lerp(1.5, 2.1, i)`.
At 0.5: **48 HP, ×1.8 damage**. A husk hit (14) is now 29% of your health. Every hazard in TILES.md
matters. The single most run-defining law available and it is two constants.
RoR2's Glass is **500% damage at 10% health** ([wiki.gg](https://riskofrain2.wiki.gg/wiki/Artifacts));
ours is deliberately a third as extreme, because RoR2's Glass is chosen by a veteran who wants it and
ours is imposed on someone playing for five minutes at a hackathon booth.
**Touch points:** `makePlayer`, `damageEnemy`.

**`long_echo`** · budget **−1** · *the world remembers your gestures*
`abilityCooldownMul = lerp(0.80, 0.55, i)` · `ultChargeMul = lerp(0.85, 0.65, i)`.
At 0.5: Q/E cooldowns ×0.68 (Bastion's Bulwark 6 s → 4.1 s), ultimate charges 25% slower. Ability-heavy
rather than attack-heavy play.
**Touch points:** the six `*CooldownMs` assignments, `ULT_CHARGE_PER_DAMAGE`/`PER_KILL`.

**`bleeding_light`** · budget **+2** · *only what you read will mend you*
`abilityHealMul = 0` · `relicHealHp = round(lerp(24, 40, i))`.
Beacon's Rally heals **0** (it still hastes). Reading a relic restores **32 HP to every living
operative**, once per relic. Turns the lore that BOSS_FINALE.md already rewards into a survival
resource, so a crew that ignores exploration is a crew on its last 30 HP at the Custodian.
**Touch points:** the `beacon.e.rally` branch, `discoverLore`.

**`first_light`** · budget **−1** · *the first cut is the deep one*
`firstStrikeMul = lerp(2.0, 3.0, i)` on the first damage instance against an untouched enemy.
At 0.5: **×2.5**. A Shade one-shots swarmlings and husks from stealth. This promotes the existing
`first_strike` attunement (`registry.ts:235`, status `planned`) from a skill node to a world law, which
also means implementing it once serves both.
**Touch points:** `damageEnemy` + one boolean on `EnemyRuntime`.

### Enemies

**`few_and_terrible`** · budget **+1** · *fewer things, and each one is worse*
`enemyCountMul = lerp(0.65, 0.45, i)` · `enemyHpMul = lerp(1.8, 2.6, i)` · `enemyDamageMul = lerp(1.15, 1.40, i)`.
At 0.5: **half as many enemies with ×2.2 HP and ×1.28 damage**. Fights become duels.
Enemy radius is *not* scaled — hitboxes must stay honest.

**`the_many`** · budget **+1** · *the world is crowded with small failures*
`enemyCountMul = lerp(1.5, 2.1, i)` (hard cap 12 per room, the existing `RoomSpecSchema` limit) ·
`enemyHpMul = lerp(0.60, 0.45, i)` · `enemyDamageMul = lerp(0.85, 0.70, i)`.
At 0.5: **1.8× enemies at 0.55 HP and 0.78 damage.** Bastion's sweep and Shade's Blade Storm become the
answer; Beacon's single-target lance stops being. This is RoR2's Swarms ("spawns doubled, maximum health
halved", [wiki.gg](https://riskofrain2.wiki.gg/wiki/Artifacts)) pulled in slightly because our rooms are
smaller and our cap is 12.
**Mutually exclusive with `few_and_terrible`.**

**`wardens_watch`** · budget **+2** · *everything here has a rank*
`eliteFraction = lerp(0.25, 0.50, i)`. That fraction of spawned enemies get `role: 'elite'`: **+60% HP,
+25% damage, a visible aura ring, +2 resources on death.** At 0.5: **37%**.
floorgen's director already assigns `role` (FLOORS.md §6), so this is a director multiplier, not new code.
RoR2's Honor makes enemies spawn **only** as elites ([wiki.gg](https://riskofrain2.wiki.gg/wiki/Artifacts));
a fraction is the right call for us because we have four archetype roles and turning all of them elite
erases the encounter director's composition work.

**`restless`** · budget **+1** · *nothing here stays down*
`reanimate = { delayMs: round(lerp(14000, 9000, i)), hpFraction: lerp(0.35, 0.50, i), windowMs: same as delayMs }`.
A defeated enemy leaves a marker; after the delay it stands back up at that HP fraction, **once**,
unless a player walks over the marker within the window (a 1-tile touch, no hold). At 0.5:
**11.5 s, 42% HP**. The counterplay is movement, not damage — you have to go *into* the room you just
cleared. Never applies to `elite`, `gatekeeper` or `guardian`.

**`unstable_matter`** · budget **+1** · *matter here does not let go quietly*
`deathBlast = { radius: round(lerp(56, 84, i)), playerDamage: round(lerp(8, 16, i)), enemyDamage: round(lerp(14, 26, i)) }`.
At 0.5: **70 px, 12 to players, 20 to enemies.** Detonates `*` canisters (TILES.md T1) and chains through
packs. The blast code is **literally the canister's** — if TILES cut #2 lands, this law is ~15 lines.
Falls off linearly to 0.35× at the rim and requires `clearPath`, same as the canister.
This is RoR2's Spite ("enemies drop exploding bombs on death",
[wiki.gg](https://riskofrain2.wiki.gg/wiki/Artifacts)) with the bomb's fuse removed, because our rooms
are small enough that a delayed bomb would just be a second hazard the player can't see.

### Terrain

**`hollow_ground`** · budget **+1** · *this place was built hollow*
`terrainFeatureBonus = i >= 0.4 ? 1 : 0` (one extra feature slot per room, max 5) ·
`terrainDensityStep = i >= 0.7 ? 1 : 0` (sparse→balanced→dense, clamped).
Uses TILES.md's generator directly and is therefore gated on `validateRoomSafety` — a room that cannot
place the extra feature safely simply doesn't.

**`slow_fire`** · budget **0** · *time thickens near the burning parts*
`hazardDilation = { radius: round(lerp(72, 120, i)), speedMul: lerp(0.70, 0.45, i), projectileMul: lerp(0.85, 0.60, i) }`.
Within that radius of any **live** hazard tile (`~`, a firing `^`, a collapsing `%`, an armed `*`),
every entity's speed and every projectile's speed are multiplied down. **The player's dash is exempt.**
At 0.5: 96 px radius, ×0.57 speed, ×0.72 bolts.
This is the law I would ship for *feel*: hazards stop being walls and become slow-motion zones you
deliberately enter to get a clean shot off. Difficulty-neutral by design — it hurts your escape as much
as their approach.

**`sealed_halls`** · budget **+1** · *the doors here have opinions*
`splitRooms = true`. Every combat room gets a `D` sealing door or a `_`/`G` gate pair splitting it
(TILES.md T5/T6), and the exit is always on the far side. Every fight is staged.
Needs TILES T5; without it, degrade to "doors lock until cleared", which F2 is building anyway.

### Vision / look

**`long_dark`** · budget **+2** · *bring your own light*
`lightRadius = round(lerp(260, 170, i))`. Beyond that radius from **any living player**, the floor,
walls and dressing draw at **0.25 alpha** and enemies are **not drawn at all** (they still exist, still
telegraph audibly, still hit you). `lantern` props and `+` conduit tiles add **+60 px** locally.
At 0.5: **215 px ≈ 6.7 tiles**.
In co-op this is transformative — two light circles that must decide whether to stay joined. It is also
renderer-only: **zero simulation risk**, which is why it is in the one-night cut.
Isaac's Curse of Darkness limits visibility to "Isaac's aura" and, in Repentance, *widens the light
radius while deepening the dark around it* ([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Curses))
— worth copying: a bigger, harder-edged circle reads as better-lit and is easier to play than a soft
falloff, even when it shows you less.
**Forbidden in the final biome** — the Custodian's telegraphs must be readable (BOSS_FINALE §9).

**`mirror_halls`** · budget **+1** · *the map will not hold still*
`hideMinimap = true`. The minimap is hidden and a room's name is withheld until entered. On 3-room
worlds this is nearly free; on 5-biome floors it is a real law, and it directly raises the stakes of the
collapse-escape, which relies on the minimap (BOSS_FINALE §7.4).
Isaac's Curse of the Lost removes the map **and adds 4 rooms to the floor**
([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Curses)) — it charges you twice and is famously
the least-liked curse. Ours should pay *out*, not in: while `mirror_halls` is active, add **+1 lore
room** to every biome's `layout.specials`. Getting lost should at least mean finding something.
**Forbidden when `long_dark` is also chosen** — two information blackouts is not a law, it is a bug
report.

**`held_breath`** · budget **0** · *this world makes no sound it doesn't have to*
`muteTells = true` · `telegraphMul = lerp(1.20, 1.45, i)`.
Enemy telegraph audio is muted; in exchange every telegraph lasts **~32% longer** and draws at higher
contrast. Genuinely changes how you play — you must watch rather than listen — at roughly neutral
difficulty. The telegraph-design literature is explicit that tells are delivered through *redundant*
channels precisely so any one can be occluded
([bugnet](https://bugnet.io/blog/how-to-design-enemy-attack-telegraphs)); this law removes one channel
and pays for it in the other.

### 2.1 Considered and left out (and why), with the id reserved

Each of these is a real shipped mechanic and each is 5–20 lines. They are out of the 18 only because
the registry has to stay small enough that a model picks well from it.

| reserved id | precedent | why not now |
| --- | --- | --- |
| `one_lineage` | RoR2 **Kin** — one monster type per stage ([wiki.gg](https://riskofrain2.wiki.gg/wiki/Artifacts)) | Genuinely cheap (filter `enemyPool` to one id) and genuinely transformative, but it fights the encounter director's composition rules and the biome briefs' `enemyPool[1..5]`. Worth revisiting the day after. |
| `crossed_lines` | RoR2 **Chaos** — friendly fire | We have no player-vs-player damage path at all, and adding one to a co-op game at 3 a.m. is how you ship a griefing bug. |
| `long_fall` | RoR2 **Frailty** — fall damage doubled and lethal | Needs TILES.md's pits first, and "pits kill players" contradicts T2's deliberate never-lethal rule. If it ever ships it must be opt-in. |
| `wrong_door` | Isaac **Curse of the Maze** — entering a room occasionally puts you in the wrong one, with a screen-shake and a sound ([wiki.gg](https://bindingofisaacrebirth.wiki.gg/wiki/Curses)) | Needs the floor graph (F2), and it is actively hostile during the collapse-escape. Excellent law for a *world*, terrible law for a *demo*. |
| `blind_offer` | Isaac **Curse of the Blind** — item sprites hidden until picked up | Waits on the item system, which is D1b's doc and not built. |

## 3 · Guard-rails

The model proposes; the compiler disposes. None of this ever fails generation — it degrades.

### 3.1 Mutually exclusive pairs

```ts
export const LAW_CONFLICTS: ReadonlyArray<readonly [WorldLawId, WorldLawId]> = [
  ['few_and_terrible', 'the_many'],     // directly contradictory
  ['thin_air', 'tidal_drag'],           // both rewrite the dash; the result is undefined feel
  ['long_dark', 'mirror_halls'],        // two information blackouts
  ['long_dark', 'held_breath'],         // dark AND silent = unfair, not atmospheric
  ['glass_lattice', 'bleeding_light'],  // 48 HP with no healing is a demo-ending combination
  ['glass_lattice', 'unstable_matter'], // death explosions at 48 HP kill you from off-screen
  ['bleeding_light', 'restless'],       // no healing + enemies that come back = attrition death spiral
];
```

### 3.2 Difficulty budget

```
total = sum(LAW_INFO[id].budget for chosen laws)
accept if -1 <= total <= 3
```
If `total > 3`, drop the **highest-budget** law (ties → the later one in the array). If `total < -1`,
drop the **lowest**. Re-check. Terminates in ≤ 3 passes because dropping always moves `total` toward 0.

Additional caps: **at most 1** law from `combat`, **at most 2** from `enemies`, **at most 1** from
`vision`. A world is allowed to be strange in several directions but not chaotic in one.

### 3.3 Per-biome scaling

When floors lands, the same 2–3 laws apply to **the whole world** (one identity, five biomes) but their
`intensity` scales with depth: `effectiveIntensity = clamp(intensity * (0.7 + 0.15 * tier), 0, 1)`.
Biome 1 is a gentle version of the law; biome 5 is the law at full strength. This is free escalation
that needs no new content, and it means the crew *learns* the law before it is dangerous.

Exception: **budget ≥ +2 laws are clamped to `intensity ≤ 0.6` in biome 1**, so a world can never open
with its hardest face.

### 3.4 What the model is told

`provider.ts:74` already injects `TERRAIN_FEATURE_INFO` and `ATTUNEMENT_EFFECT_INFO` into the prompt.
Add `lawSummaries: Object.fromEntries(WORLD_LAW_IDS.map(id => [id, LAW_INFO[id].summary]))`.

Each `summary` is one sentence **with the number in it**, in the house style the registry already uses:

> `long_dark: 'Sight fails past ~215px; enemies outside that radius are invisible. Lanterns and conduits extend it.'`

The model needs the number to write an honest `description`, and the player will read that description
on the creation receipt. A law the player is surprised by is a bug; a law they were *told about* and
forgot is drama.

## 4 · Where each law is implemented

One table so an implementing agent never has to search. Every entry is a multiply or a branch on
`laws.*`, with `NEUTRAL_LAWS` making the un-lawed case identical to today.

| field | file · function | change |
| --- | --- | --- |
| `walkSpeedMul`, `attackMoveMul` | `sim/simulation.ts` `stepPlayer` (~line 697) | the speed expression already chains 4 multipliers; add 2 |
| `dashSpeedMul/DurationMul/CooldownMul` | `stepPlayer` dash branch | 3 multiplies |
| `playerMaxHp` | `makePlayer`, `REVIVE_HP` clamp | 1 constant |
| `playerDamageMul`, `firstStrikeMul` | `damageEnemy` (~line 285) | the `markMs` multiplier is already there |
| `abilityCooldownMul`, `ultChargeMul` | ability resolution, `ULT_CHARGE_*` | 2 multiplies |
| `abilityHealMul`, `relicHealHp` | `beacon.e.rally` branch, `discoverLore` | 2 branches |
| `enemyCountMul/HpMul/DamageMul`, `eliteFraction` | `spawnEnemies` + floorgen `director.ts` `rollEncounters` | multipliers on `encounter.count` and `ENEMY_INFO[..].maxHp` |
| `deathBlast` | `damageEnemy` where `hp === 0` | reuses TILES.md T1's `detonate()` |
| `reanimate` | new `RoomProgress.markers[]` + a step in `updateObjectives` | ~40 lines |
| `terrainFeatureBonus`, `terrainDensityStep` | `generation/compiler.ts` `applyTerrain` | 2 lines, then `validateRoomSafety` |
| `hazardDilation` | `stepPlayer`, `stepEnemy`, `stepProjectiles` | a `dilationAt(x, y)` helper |
| `splitRooms` | `applyTerrain` | forces a feature |
| `lightRadius` | `render/RoomScene.ts` (the `fog` graphics at `DEPTH.fog` already exists) | mask + per-enemy `setVisible` |
| `hideMinimap` | F3's `Minimap.tsx` | one prop |
| `telegraphMul`, `muteTells` | `stepEnemy` telegraph creation; audio layer | 1 multiply, 1 branch |

## 5 · Look variation — the bounded art parameters

The constraint is `ArtRecipeSchema`. Today the model controls a 10-colour palette, 1–4 motifs, a
skyline motif, `fog` and `glowIntensity` — and `paletteFamily` is a literal with one value. The renderer
turns `motifIds[0]` into a `FloorPattern` and a `MoteStyle` through two `Record<MotifId, …>` tables
(`dressing.ts:30,42`). That table-driven design is good; it is just too small.

### 5.1 Extended schema

```ts
export const PALETTE_FAMILY_IDS  = ['ink_neon','bleach','rust','bloom','monochrome','sodium'] as const;
export const FLOOR_MATERIAL_IDS  = ['plates','lattice','flagstone','grating','crystal','organic',
                                    'slabs','boards','sand','mosaic','ice','sheet_metal'] as const;
export const WALL_STYLE_IDS      = ['blockwork','panelled','hewn','overgrown','glass','girder'] as const;
export const LIGHTING_IDS        = ['overhead','rim','underlit','shafts','flat','stormlight'] as const;
export const ATMOSPHERE_IDS      = ['sparks','dust','flicker','glints','spores','ash','fireflies',
                                    'embers','rain','snow','drift','none'] as const;

export const ArtRecipeSchema = z.object({
  paletteFamily: z.enum(PALETTE_FAMILY_IDS),          // was z.literal('ink-neon')
  palette: PaletteSchema,                             // unchanged
  motifIds: z.array(MotifIdSchema).min(1).max(4),     // unchanged
  skyline: MotifIdSchema,                             // unchanged
  fog: z.number().min(0).max(1),                      // unchanged
  glowIntensity: z.number().min(0).max(1),            // unchanged
  // new:
  floorMaterial: z.enum(FLOOR_MATERIAL_IDS),          // overrides FLOOR_PATTERN[motifIds[0]]
  wallStyle: z.enum(WALL_STYLE_IDS),
  lighting: z.enum(LIGHTING_IDS),
  atmosphere: z.enum(ATMOSPHERE_IDS),                 // overrides MOTE_STYLE[motifIds[0]]
  atmosphereDensity: z.number().min(0).max(1),
  skylineDepth: z.number().min(0).max(1),
  grain: z.number().min(0).max(1),
});
```

Migration: every new field gets a `.default()` derived from `motifIds[0]` via the existing tables, so
the three fixtures and every legacy recipe parse unchanged and look identical until someone sets a
value. That is the same trick `RoomTerrainSchema` used when #16 added it as `.nullable().optional()`.

### 5.2 What each one costs and buys

Ordered by **visible difference per line of code** — this is the list to build down.

**1 · `paletteFamily` — 6 families · ~40 lines · the biggest lever by a distance.**
A family is a *trusted post-transform* applied to the model's 10 colours before anything draws.
`color.ts` already exports `mix`, `lighten`, `darken`, `shiftHue(hex, degrees, satBoost, lightBoost)` —
every family is a composition of those.

| family | transform | reads as |
| --- | --- | --- |
| `ink_neon` | identity (today's look) | dark, saturated, backlit |
| `bleach` | `shiftHue(c, 0, -0.35, +0.18)` on all but `hazard`/`accent`; `floor` lifted +0.22 | sun-bleached, overexposed, daytime |
| `rust` | hue pulled toward 25°, blues crushed (`satBoost −0.5` where hue ∈ [180,260]) | oxidised, industrial, warm |
| `bloom` | `+0.25` saturation, `glow` lightened +0.3, `glowIntensity` floored at 0.7 | wet, luminous, overgrown |
| `monochrome` | all colours mapped to greys on `accent`'s hue; **`hazard` left untouched** | stark, printed, graphic |
| `sodium` | everything toward 45° at low saturation; `accentSoft` becomes the dominant light | streetlight-at-night |

**Hard guard-rail, enforced in trusted code:** after any family transform, `hazard` and `accent` must
retain **≥ 4.5:1** contrast against `floor`, and `hazard` must stay ≥ 30° of hue from `accent`. If not,
the transform is partially unwound (lerp back toward identity in 0.1 steps until it passes). Readability
is not a stylistic choice — every hazard in TILES.md and every telegraph in BOSS_FINALE.md depends on it.

**2 · `lighting` — 6 modes · ~50 lines · second-biggest lever, and nobody expects it.**
`drawWalls` currently hardcodes a single light direction: the lit `cap`, then a front face drawn only
when there is floor *below* (`environment.ts` ~line 320), a 6 px dark band at the bottom and a 3 px
`wallEdge` rim. Changing *which* neighbour gets the face, how bright the cap is, and where the shadow
falls makes identical geometry read as a different building.

| id | cap | face drawn on | shadow | rim |
| --- | --- | --- | --- | --- |
| `overhead` | `mix(wall, text, 0.18)` | south (today) | 6 px bottom | 3 px |
| `rim` | `darken(wall, 0.10)` | south | 2 px | **5 px, full accent** |
| `underlit` | `darken(wall, 0.25)` | **north** | 6 px top | 3 px bottom, `glow` |
| `shafts` | today's, plus 3 vertical light bands at 0.06 alpha over the whole room | south | 8 px | 2 px |
| `flat` | `wall` itself | none | none | 1 px | *(reads as a blueprint; pairs with `monochrome`)* |
| `stormlight` | pulses ±0.08 on a 4.2 s cycle | south | 6 px, pulsing with the cap | 3 px |

`drawLightPools`' 5-ring falloff and the `DEPTH.fog` vignette both already exist and take a strength
argument, so `lighting` mostly re-parameterises code that is written.

**3 · `floorMaterial` — 12 ids (8 exist) · ~60 lines for 4 new cases.**
`drawTilePattern` is already a switch over 8 patterns with a `TileContext`. The four additions:
`sand` (drifted bands + grain dots), `mosaic` (4×4 sub-tiles, one in six tinted `accentSoft`),
`ice` (near-white base, two hairline fracture lines per tile, a specular dot), `sheet_metal`
(3 large plates with visible bolt heads and a diagonal brushed highlight).
Decoupling material from motif is the point: `crystals` + `boards` is a world nobody has seen.

**4 · `atmosphere` + `atmosphereDensity` — ~35 lines.**
`MOTE_STYLE`'s 8 variants already exist; add `rain` (fast vertical streaks + floor speckle),
`snow` (slow drift with horizontal wander), `drift` (large slow translucent shapes), `none`.
`atmosphereDensity` scales particle count `0 → 140` linearly. `none` at density 0 is a valid, and
striking, choice — the absence of motes in a game where every world has them is itself a look.

**5 · `skylineDepth` and `grain` — ~20 lines.**
`drawBackdrop` draws three silhouette bands (`far`/`mid`/`near`). `skylineDepth` scales their parallax
offset and alpha `0.3 → 1.0`; at 0 the world reads as interior, at 1 as a city on a cliff. `grain` adds
per-tile luminance noise (`±grain*0.04`) and a matching vignette texture — the cheapest way to make two
worlds feel like different *film stocks* rather than different colours.

### 5.3 What the model must not control

- **Contrast.** Guard-railed above. A world may not be illegible.
- **Entity colours.** `CLASS_THEME` (`registry.ts:125`) stays fixed. The crew must look the same in
  every world or the co-op HUD stops teaching.
- **Telegraph and hazard colours.** These come from `palette.hazard` *after* the contrast clamp, and the
  amber wind-up colour in BOSS_FINALE §9 is fixed. Danger has one visual language across all worlds.
- **Geometry.** Nothing here changes a tile's position, size or collision. Look is a pure function of
  `(ArtRecipe, RoomSpec)`, which keeps it off the simulation's critical path and out of co-op sync.

### 5.4 Test

A `presentation` test that renders **one fixed room** under 6 palette families × 6 lighting modes and
asserts the resulting draw-call colour histograms are pairwise distinct beyond a threshold. Plus a
manual screenshot sheet at 1280 px: 8 worlds, one image each, and the acceptance bar is *a teammate who
did not build them can tell them apart with the labels covered.*

## 6 · One-night cut — 6 items, in priority order

| # | item | why here | est. |
| --- | --- | --- | --- |
| 1 | **`WorldLawSchema` + `ResolvedLaws` + `NEUTRAL_LAWS` + `resolveLaws` + prompt injection** | The harness. Nothing else in this doc can land without it, and with `NEUTRAL_LAWS` it is provably a no-op on existing worlds. New file `shared/laws.ts`, so no conflicts. | ~120 lines |
| 2 | **`paletteFamily` widened to 6 families + the contrast clamp** (§5.2 item 1) | Renderer-only, zero sim risk, and it is the single change that makes two worlds unmistakable in a screenshot. This is the literal answer to "change up how things look". | ~60 lines |
| 3 | **`glass_lattice` + `long_echo` + `committed_strike`** | Three combat/movement laws that are 2 multiplies each on the harness from item 1. `committed_strike` in particular changes how the game *plays* without changing how hard it is. | ~30 lines |
| 4 | **`long_dark`** (§2 vision) | Renderer-only, visually the most striking thing in the doc, and in co-op it produces the "stay together or split the light" decision for free. | ~70 lines |
| 5 | **`few_and_terrible` / `the_many` pair** | Director-only multipliers on `encounter.count` and `maxHp`. Two laws for the price of one branch, and they make the *same room* play completely differently. | ~30 lines |
| 6 | **`lighting`, 6 modes** (§5.2 item 2) | Re-parameterises `drawWalls`, which is already written. The one people will not expect and the one that makes the geometry itself look different. | ~50 lines |

Deliberately **out** tonight: `restless` and `reanimate` (new runtime state), `hazardDilation` (touches
three step functions), `hollow_ground`/`sealed_halls` (gated on TILES.md's generator work),
`floorMaterial`'s 4 new cases, `atmosphere`'s 4 new cases, `grain`, `skylineDepth`, per-biome intensity
scaling (needs floors). `unstable_matter` is a 15-line freebie **if and only if** TILES cut #2 lands
first — take it opportunistically, not as a commitment.

## Needs a human call

- **Do laws go in the creation receipt?** They should — a law the player was not told about reads as a
  bug. But the receipt is the demo's social payoff moment and it is already dense. Someone must decide
  whether laws get a line there, a separate pre-portal card, or both.
- **Who owns `ArtRecipeSchema`?** Widening `paletteFamily` from `z.literal` to `z.enum` is a contracts
  change on the night F1b owns `contracts.ts`, and it invalidates nothing but touches the fixture
  validator. Sequence it into F1b's pass or it will conflict.
- **`long_dark` and the judges.** It is the best-looking thing in this doc and it hides most of the
  screen. If a judge's only exposure to RELAY is one world and that world is dark, we have shown them
  less game. Suggest excluding `long_dark` from the demo fixture worlds specifically.
- **Are 2–3 laws too many for a 5-minute run?** Hades' Pact stacks a dozen conditions, but across
  hundreds of hours. For a first-time player in one short run, **2 may be the honest maximum** — one
  they notice and one they discover. Worth a decision before the prompt is written, because the prompt
  has to ask for a number.
- **Laws vs attunements.** `ATTUNEMENT_EFFECT_IDS` (10 ids, all `status: 'planned'`) is an existing,
  unimplemented, model-facing system that overlaps with laws (`first_strike`, `hazard_ward`,
  `anchor_grace`). Shipping both means two ways for a world to change the rules. Either fold
  attunements into laws as the *player-chosen* half, or pick one and mark the other deprecated. Do not
  ship both half-built.
