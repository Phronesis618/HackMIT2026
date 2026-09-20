# ITEMS.md — three item systems, at increasing scope

**Owner of this doc:** D1b (design only). **Status:** the lead tunes this in the morning; no
code tonight beyond reserved enums. Three complete designs are given so the choice is a choice,
not a rewrite.

**Read `§0` first.** The single most valuable thing in this doc is that RELAY already ships a
closed, model-facing, ten-entry effect registry that nothing implements. Items are the cheapest
way to make it real.

---

## 0 · What already exists (ground truth)

| Thing | Where | State |
| --- | --- | --- |
| `ATTUNEMENT_EFFECT_IDS` — 10 ids, each with a `summary` and `status: 'planned'` | `src/shared/registry.ts` | **Closed set, model names and skins it already** via `AttunementSchema` / `recipe.attunements`. Zero sim implementation. |
| Skill tree — core spine + per-class tree + the world's attunement branch | `src/shared/skills.ts` | Every node `status: 'planned'`. Display only. |
| `resources` currency, `ROOM_CLEAR_REWARD = 3`, `ABILITY_UNLOCK_COST = 3` | `src/shared/conventions.ts`, `sim/simulation.ts:925` | Real and spent. Session-scoped, not persisted. |
| Room kinds `entrance · combat · elite · treasure · lore · rest · exit`, reserved `shop` | `src/shared/floors.ts:130` | Generator places treasure/lore/rest at dead ends; `BuiltRoom.focus` is the exact tile the thing goes on. `shop` is in the enum and never generated. |
| `lore_discovered` events with `kind: 'relic' | 'remains'` | `contracts.ts` | Already fires, already becomes a memory. |
| `PLAYER_MAX_HP = 100`, `DASH_COOLDOWN_MS = 800`, `ULT_CHARGE_MAX = 100` | `conventions.ts`, `registry.ts` | For all numbers below. |

**Design rule that falls out of this:** every item effect must resolve to an id in **one**
effect registry, and that registry must be a superset of `ATTUNEMENT_EFFECT_IDS`. Then the sim
implements each effect exactly once and *both* items and skill-tree nodes grant it. See §5.

---

## 1 · What the research says makes items create run variety

| Source | Finding | Consequence here |
| --- | --- | --- |
| [Dead Cells loadout](https://www.kokutech.com/blog/gamedev/design-patterns/flow-state/dead-cells) · [mutations](https://mygamingtutorials.com/2025/06/13/comprehensive-mutations-guide-for-dead-cells/) | Four slots (2 weapons, 2 skills) plus mutations; "when additions are meaningfully different — sword versus bow range — each one multiplies playstyles exponentially". A mutation slot opens after each of the first three biomes. | **Slots beat piles.** Few slots, each filled with something behaviourally different, beats 700 passives. Our biome count (5) gives a natural slot-unlock cadence. |
| [Isaac items & synergies](https://tboi.com/synergies) · [transformations](https://en.wikipedia.org/wiki/The_Binding_of_Isaac:_Rebirth) | Unlimited passives that stack; **one** active at a time; "synergies occur when two or more items combine to a result greater than the sum"; three thematic items → a transformation. | Keep the **one-active** rule (it forces a decision). Add **4 hand-authored synergy pairs** — cheap, and they are what players talk about. Do not attempt emergent synergy; it needs a priority system we do not have time for. |
| [Hades boons / duo boons](https://hades.fandom.com/wiki/Duo_Boons) | Which *slot* you reinforce (Attack/Special/Cast/Dash) defines the run. 28 duo boons across 8 gods are the strongest effects. | Our slots are already in the kit: basic attack, Q, E, R, dash. Relic effects should attach to those verbs, not to raw stats. |
| [Risk of Rain 2 stacking](https://riskofrain2.wiki.gg/wiki/Item_Stacking) | Duplicates stack; the whole power curve is stacking. | **Do not stack in v1.** Stacking demands balancing an exponential curve; a 5–7 minute demo has no room for it. Reroll duplicates instead. |
| [Slay the Spire relics/potions](https://sts2front.com/potions/) | Relics are permanent-for-the-run and always-on; potions are the "get out of this specific fight" valve. Potions stop a run from being lost to one bad room. | The **flask + throwables** in Design A are that valve. Ship them first, whatever else gets cut. |

**Conclusion that decides the recommendation:** with ≈2 hours of implementation, the highest
variety-per-minute is *consumables (a valve) + a small closed set of always-on relics attached to
verbs the player already uses*. Weapon variants are more exciting and cost more, because they
live in the attack resolver in `sim/simulation.ts` — the file F2 owns tonight.

---

## 2 · Design A — consumables only

**Scope:** one flask with charges, four throwables. No passives, no weapons.
**Implementation surface:** `PlayerState` + 2 HUD slots + 4 effect handlers + pickups on `focus`.
**Est: ~70 min.**

### A.1 Schema

```ts
// src/shared/items.ts (new file — no conflicts)
export const CONSUMABLE_IDS = [
  'flask', 'charge_pack', 'snare_mine', 'coolant_burst', 'mark_flare',
] as const;
export type ConsumableId = (typeof CONSUMABLE_IDS)[number];

export interface ConsumableInfo {
  id: ConsumableId;
  baseName: string;         // engine name; the world may re-skin it (§6)
  slot: 'flask' | 'throw';  // key 1 / key 2
  maxStack: number;
  /** Engine-authored, always shown. Never model-written. */
  effect: string;
}

// PlayerState additions (both optional → no schema break)
flaskCharges?: number;                    // 0..flaskMax
flaskMax?: number;                        // 3 by default
throwId?: ConsumableId | null;
throwCount?: number;                      // 0..2
```

### A.2 Exact numbers

| id | slot | Effect | Numbers |
| --- | --- | --- | --- |
| `flask` | 1 | Restore Integrity | **35 HP** (35 % of `PLAYER_MAX_HP`), 0.35 s arm then instant, **3 charges**, 0.8 s internal cooldown. Refilled to `flaskMax` on entering any `rest` room and on every biome `exit` clear. |
| `charge_pack` | 2 | Thrown 240 u, 1.0 s fuse, blast | **45 dmg**, radius **90**, destroys a `B` breakable wall outright (`BREAKABLE_WALL_HP = 36`), knockback 180 |
| `snare_mine` | 2 | Drops at your feet, arms in 0.5 s, triggers on the first hostile within 60 | **root 2.0 s**, 15 dmg, 12 s live before it expires |
| `coolant_burst` | 2 | Instant, self-centred | radius **120**, refunds **40 %** of all ability cooldowns, clears burn/slow on you and allies in radius |
| `mark_flare` | 2 | Thrown 280 u, instant | marks every hostile in radius **150** for **6 s** (+30 % damage taken — identical to `beacon.q.flare`'s mark, so it reuses that status) |

`maxStack` is **2** for throwables, **1 slot** — picking up a different throwable while holding
one prompts swap-or-leave (hold F 0.4 s to swap). One active, Isaac's rule.

### A.3 Where they drop (floor graph)

Room kinds from `ROOM_KINDS`; the drop goes on `BuiltRoom.focus`.

| Room kind | Drop | Rate |
| --- | --- | --- |
| `rest` | Flask refill fixture on `focus` | 100 % (this is what a rest room *is*) |
| `treasure` | 1 throwable, random from the 4 | 100 % |
| `elite` | 1 throwable on clear, spawned at the elite's death position | 60 % |
| `exit` | 1 throwable on gatekeeper death | 100 % |
| `combat` / `lore` / `entrance` | nothing | — |

**On today's 3-room legacy worlds** (no treasure/rest rooms exist): room 0 clear drops
`charge_pack`, room 1 clear drops one random throwable, and the player starts with a full flask.
Stated explicitly because the demo may ship on 3-room worlds.

### A.4 UI

Two square slots immediately left of the ability bar, same 48 px cell as `AbilityIcon`:
`[1] FLASK ×3` and `[2] CHARGE PACK ×1`. Empty slot = dashed outline. On pickup, a 1.2 s toast
above the bar: the item name, then the engine effect line beneath it in mono. Player never has to
open a menu to know what they have.

### A.5 Co-op

**Personal, instanced.** Each pickup is claimed independently by each player who touches it; the
prop stays until everyone has taken it, then despawns. Rationale: in a 5–7 minute demo, two
players racing for one flask is a bad story to tell on stage. Flask charges are always personal.

### A.6 How the LLM names and skins them

```ts
// WorldRecipe addition
consumableSkins: Array<{
  consumableId: ConsumableId;   // MUST be in CONSUMABLE_IDS — Zod enum, unknown ids fail validation
  name: string;                 // ≤24 chars
  flavor: string;               // ≤90 chars, one sentence
}>  // max 5, duplicate-free
```

The model chooses **name and flavor only**. It cannot invent an id, a number or an effect.
The UI renders `name` as the title and **always renders the engine's `effect` string beneath
it** — the player is never told a false thing about what an item does. Both strings go through
W1's prose linter (`src/shared/prose.ts`) like any other world text, and follow the item rule
from `OVERNIGHT_PLAN.md §3b`: *effect first, then one fact about the owner.*

---

## 3 · Design B — A + passive relics *(recommended)*

**Scope:** everything in A, plus 14 passive relics drawn from one closed effect registry, with
4 hand-authored synergies. **Est: A (70 m) + 60 m = ~2 h 10 m.**

### B.1 The effect registry — the load-bearing idea

```ts
// src/shared/registry.ts — ADDITIVE
export const RELIC_EFFECT_IDS = [
  ...ATTUNEMENT_EFFECT_IDS,   // the existing 10, unchanged, same ids
  'salvage_eye', 'flask_wide', 'second_wind', 'overcharge',
] as const;
export type RelicEffectId = (typeof RELIC_EFFECT_IDS)[number];
```

`ATTUNEMENT_EFFECT_IDS` is a **prefix** of `RELIC_EFFECT_IDS`, so nothing that already emits an
attunement id breaks. One sim function resolves both sources:

```ts
// src/sim/effects.ts
export interface EffectSet { has(id: RelicEffectId): boolean; count(id: RelicEffectId): number; }
export function effectsFor(player: PlayerState): EffectSet;   // relicIds ∪ unlocked skill nodes
```

### B.2 The 14 relics, with exact numbers

Rarity weights in brackets. Effects attach to verbs the player already presses.

| # | `RelicEffectId` | Engine name | Effect (exact) | Rarity |
| --- | --- | --- | --- | --- |
| 1 | `hazard_ward` | Sealed Boots | Damage from `~` hazard floor and area denial **−40 %** | common [10] |
| 2 | `bolt_ward` | Deflection Weave | Enemy projectile damage **−25 %** | common [10] |
| 3 | `melee_ward` | Impact Plating | Melee and charge damage **−25 %** | common [10] |
| 4 | `relic_mend` | Reader's Draught | Reading a lore relic restores **25 HP** | common [8] |
| 5 | `remains_charge` | Grave Tap | Recovering remains grants **+40 ult charge** | common [8] |
| 6 | `clear_surge` | Clearance Bonus | Clearing a room: **4 s** haste (+30 % move, +20 % attack cadence) | uncommon [6] |
| 7 | `first_strike` | Opening Cut | First hit on an untouched enemy deals **×2** | uncommon [6] |
| 8 | `guardian_bane` | Breaker's Mark | Guardian and elite enemies take **+20 %** from you | uncommon [6] |
| 9 | `dash_echo` | Burn Trail | Dash leaves a 1.5 s trail dealing **8 dmg/s** | uncommon [6] |
| 10 | `anchor_grace` | Fast Ritual | Anchor plant time **×0.5** | rare [3] |
| 11 | `salvage_eye` | Salvage Optic | **+2** resources per room cleared (on top of `ROOM_CLEAR_REWARD` 3) | common [8] |
| 12 | `flask_wide` | Shared Line | Your flask also heals allies within **200** for **20** | uncommon [5] |
| 13 | `second_wind` | Kinetic Recycler | Dash cooldown **−25 %** (800→600 ms), i-frames **+50 ms** (150→200) | uncommon [6] |
| 14 | `overcharge` | Overcharge Cell | Ult charge cap **100 → 130**; casting above 100 also stuns **1 s** in radius 150 | rare [3] |

Effects 1–10 are *verbatim the existing `ATTUNEMENT_EFFECT_INFO` summaries*. Implementing them
flips ten `status: 'planned'` flags to `'implemented'` across the registry and the skill tree.

**Stacking: none in v1.** A duplicate roll is rerolled at generation time; if the player somehow
holds a duplicate it converts to **5 resources** on pickup. (Risk of Rain's curve is great and it
is not a two-hour feature.)

**Cap: 8 relics per run.** After the 8th, treasure rooms pay **12 resources** instead.

### B.3 Synergies — 4 pairs, hand-authored

Checked at pickup with four `if`s. Each announces itself with a named toast (Isaac's
transformation moment, at 1/100th the cost).

| Pair | Name | Bonus |
| --- | --- | --- |
| `first_strike` + `dash_echo` | **Opening Line** | The burn trail also applies first-strike, so anything it touches takes ×2 from your next hit |
| `clear_surge` + `salvage_eye` | **Scavenger's Tempo** | Room-clear haste **4 s → 7 s** |
| `relic_mend` + `flask_wide` | **Field Medic** | Reading a lore relic heals every crew member within 200 for 25 |
| `guardian_bane` + `overcharge` | **Breaker** | Ultimate damage **+25 %** against guardian and elite |

### B.4 Schema

```ts
export const RELIC_IDS = [/* 14 stable ids, e.g. 'sealed_boots', … */] as const;
export type RelicId = (typeof RELIC_IDS)[number];

export const RELIC_INFO: Record<RelicId, {
  effectId: RelicEffectId;
  baseName: string;
  /** Engine-authored. Always displayed. Never model-written. */
  effect: string;
  rarity: 'common' | 'uncommon' | 'rare';
  weight: number;
}>;

// PlayerState addition
relicIds?: RelicId[];      // ≤ 8

// Room-side: two offers on the treasure room's focus tile
export const RelicOfferSchema = z.object({
  x: TileCoord, y: TileCoord,
  relicIds: z.array(z.enum(RELIC_IDS)).length(2),   // choose 1 of 2
  takenBy: z.string().nullable(),
});
```

### B.5 Where they drop

| Room kind | Drop | Rate |
| --- | --- | --- |
| `treasure` | **Choose 1 of 2** relics on two pedestals at `focus` (Hades' boon choice — agency is the point) | 100 % |
| `elite` | 1 relic, no choice, at the elite's death position | 100 % |
| `exit` | 1 relic on gatekeeper death | 100 % |
| `rest` | flask refill only (A) | — |
| `lore` / `combat` / `entrance` | nothing | — |

Per `FLOORS.md`, a biome has ≤2 treasure and ≤4 elite rooms, plus one exit. Expected relics per
biome **2–4**; the 8-per-run cap binds around biome 3. On legacy 3-room worlds: room 0 clear and
room 1 clear each offer a 1-of-2 choice.

### B.6 UI

A **relic row in the right rail**: up to 8 chips, 28 px, icon + name, hover/focus shows the
engine effect line. Synergy pairs draw a hairline bracket linking the two chips (the
`--hair` frame treatment already in `app.css`). The 1-of-2 pedestal choice is an in-world
interaction — walk to a pedestal, `F` — not a modal. Two pedestals 2 tiles apart, the unchosen
one dissolves.

### B.7 Co-op

**Shared pick, everyone receives it.** The first player to press `F` at a pedestal chooses for
the crew; all four get the relic. Rationale: four players arguing over two pedestals for three
seconds is the best social moment available in a 5-minute demo, and it costs one UI and one
code path. Cost: builds converge. **Alternative** (note for the morning): each player gets their
own independent 1-of-2 roll — more build variety, 4× the pedestals to render, and a silent room.
Recommend shared.

### B.8 LLM naming and skinning — safe by construction

```ts
relicSkins: Array<{
  relicId: RelicId;   // Zod enum; unknown id → validation failure → repair loop
  name: string;       // ≤24
  flavor: string;     // ≤90, one sentence, per the Souls rule: effect first, one owner fact
}>  // max 8, duplicate-free
```

Four guarantees, all mechanical:

1. **The model cannot create an effect.** It selects from a fixed enum; the effect and every
   number are engine-side.
2. **The truth is always on screen.** The card renders `name` (world voice) and `RELIC_INFO
   [id].effect` (engine voice) together. A world may call `guardian_bane` "the Tidewarden's
   Ledger"; the card still reads "Guardian and elite enemies take +20 % from you."
3. **Both strings pass the W1 prose linter** — same rules, same ban-lists, same repair loop as
   room and lore text.
4. **Unskinned relics fall back to `baseName`.** A failed or partial generation degrades to a
   plain-English item, never to a missing one.

---

## 4 · Design C — B + weapon variants per class

**Scope:** B plus 3 weapons per class (12 total), changing *behaviour*, not percentages.
**Est: B (2 h 10 m) + 70 m = ~3 h 20 m.** **Not tonight.**

### C.1 The 12

| Class | Default | Variant 2 | Variant 3 |
| --- | --- | --- | --- |
| Bastion | **Arc-blade** — 18 dmg, 420 ms, range 78, arc 1.4 rad | **Breaker maul** — 30 dmg, 720 ms, range 66, arc 1.0, knockback 220, one-shots a `B` wall | **Pike** — 14 dmg, 380 ms, range 128, arc 0.5, pierces 2 |
| Shade | **Twin phase blades** — 11 ×2, 300 ms, range 62 | **Cutthroat** — 26 dmg, 520 ms, range 52, **×2 from behind** | **Ribbon** — 8 dmg, 190 ms, range 90, arc 1.9 |
| Beacon | **Lantern staff** — 16 dmg, 500 ms, range 240 bolt | **Scatter lamp** — 3 × 7 dmg cone, 560 ms, range 150 | **Long lens** — 24 dmg, 780 ms, range 380, pierces 1 |
| Weaver | **Plasma loom** — 12 dmg + 1 s slow, 440 ms, range 200 | **Coil** — 9 dmg chaining to 2 extra targets within 120, 560 ms | **Anchor line** — 15 dmg, pulls the target 60 u toward you, 640 ms |

### C.2 Schema and cost

```ts
export const WEAPON_IDS = [/* 12 */] as const;
export const WEAPON_INFO: Record<WeaponId, {
  classId: ClassId; baseName: string;
  damage: number; cadenceMs: number; range: number; arcRad: number;
  pierce: number; knockback: number; breaksWalls: boolean; behindMultiplier: number;
}>;
// PlayerState: weaponId?: WeaponId
```

Acquired two ways: **at the armory rack in the hub** (ties directly to `HUB.md §5` — each stand
holds its class's three weapons, walk and press F, which is exactly the Hades weapon courtyard),
and as a "field kit" on 20 % of `treasure` rooms.

**Why it is not tonight:** every variant reads in the basic-attack resolver inside
`src/sim/simulation.ts` — the hot file F2 owns for floors integration. Colliding there is the
one merge conflict that can cost the night. **Reserve `WEAPON_IDS` and the `weaponId` field
tonight; wire it after floors flips.**

---

## 5 · How this makes the skill tree and attunements real

Today `src/shared/skills.ts` says, in its own header comment, that *every node is
`status: 'planned'`* and the tree is "real design data a future pass hooks up". Design B **is**
that pass, and it costs almost nothing extra because relics and skill nodes grant the *same*
effect ids.

**The one function:**

```ts
function effectsFor(player: PlayerState): EffectSet {
  return fromIds([
    ...(player.relicIds ?? []).map((r) => RELIC_INFO[r].effectId),
    ...(player.unlockedSkillNodeIds ?? []).flatMap((n) => nodeEffectId(n) ?? []),
  ]);
}
```

**The eight sim hook points** — implement each once and both systems light up:

| Hook | Site (today's code) | Effects read |
| --- | --- | --- |
| 1 | player takes damage | `hazard_ward`, `bolt_ward`, `melee_ward` |
| 2 | player deals damage | `first_strike`, `guardian_bane` |
| 3 | room cleared | `clear_surge`, `salvage_eye` (`simulation.ts:925`, already the reward site) |
| 4 | dash start / end | `dash_echo`, `second_wind` |
| 5 | ult charge gain / cast | `remains_charge`, `overcharge` |
| 6 | anchor plant tick | `anchor_grace` |
| 7 | lore relic read | `relic_mend` |
| 8 | flask use | `flask_wide` |

**What flips as a result:**

- `ATTUNEMENT_EFFECT_INFO[*].status`: `'planned'` → `'implemented'` for all ten.
- `skills.ts` attunement branch nodes: `'planned'` → `'implemented'`, so the world-grown branch
  the model already writes (`recipe.attunements`) becomes a thing you can actually buy.
- `core.salvage` maps to `salvage_eye`, `core.wind` maps to `second_wind` — two core nodes go
  live for free, with the tree's own numbers already matching (`salvage_eye` "+1" in the tree
  vs "+2" here — **pick one; I recommend +2 and update `skills.ts`'s string**).
- Skill points: spend `resources` (the currency that already exists), at the hub, at the armory
  rack. Node costs in `skills.ts` are already 2/3/4/5/8.

**Do this in Design B or don't do it at all.** Implementing relics on a *separate* effect
registry would double the sim work and leave the tree planned forever.

---

## 6 · Recommendation

**Ship Design B.** Order of implementation, cut from the bottom:

| Order | Piece | Est | Cut impact |
| --- | --- | --- | --- |
| 1 | Flask (A) | 20 m | Without it, one bad room ends a demo run. Never cut. |
| 2 | `RELIC_EFFECT_IDS` + `effectsFor` + hooks 1, 2, 3 | 35 m | The spine. |
| 3 | 8 relics using hooks 1–3 (`hazard/bolt/melee_ward`, `first_strike`, `guardian_bane`, `clear_surge`, `salvage_eye`, `anchor_grace`) | 30 m | Run variety starts here. |
| 4 | Treasure-room 1-of-2 pedestals + relic row UI | 30 m | Without it relics drop invisibly. |
| 5 | 3 throwables (`charge_pack`, `snare_mine`, `mark_flare`) | 25 m | |
| 6 | Hooks 4–8 + the other 6 relics | 25 m | |
| 7 | 4 synergies | 15 m | |
| 8 | `relicSkins` / `consumableSkins` in the recipe + linter pass | 20 m | Drops to `baseName`; still fully playable. |

**"B-minus" (1 h 15 m) = items 1–4.** Flask, spine, 8 relics, choose-1-of-2 pedestals. That is
already a real item system with real run variety and it flips eight `planned` flags.

**Do not ship C tonight.** Reserve `WEAPON_IDS`.

**Do not ship A alone.** Consumables without passives give a safety valve and no build identity;
two runs feel the same, which is the exact complaint items are meant to fix.

---

## Needs a human call

1. **Shared or personal relic pick in co-op (§B.7).** Shared = one loud social moment, converged
   builds. Personal = variety, silence, 4× the pedestals. I recommend shared; it is a taste call.
2. **8-relic cap and the 12-resource overflow (§B.2).** Both numbers are guesses; nobody has
   played a 5-biome run yet.
3. **`salvage_eye` is +1 in `skills.ts` and +2 here.** Pick one and make the other match.
4. **Does the world get to skin relics at all in the demo?** It is the strongest "our ideas made
   this" beat outside the receipt, and it is one more thing the live generation can fail at on
   stage.
5. **Weapon variants (C) — hub-only or drops too?** Hub-only is safe and ties to `HUB.md §5`;
   in-run drops are the Dead Cells feeling and touch the floor generator.
