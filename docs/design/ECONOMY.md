# ECONOMY.md — currency and shops

**Owner of this doc:** D1b (design only). **Status: the human tunes every number in this file.**
Nothing here is built tonight beyond the reserved `shop` room kind that already exists.
Depends on `docs/design/ITEMS.md` (what a shop would sell).

---

## 1 · What exists today

| Thing | Value | Where |
| --- | --- | --- |
| `resources` — one currency | earned `ROOM_CLEAR_REWARD = 3` per room clear; players start with exactly `ABILITY_UNLOCK_COST = 3` | `conventions.ts`, `simulation.ts:267,925` |
| Its only sink | `ABILITY_UNLOCK_COST = 3` → unlock the E ability | `simulation.ts:1089` |
| Lifetime | **session-scoped.** Not in any persisted store; a new session starts at 3 again. | `simulation.ts:267` |
| `shop` room kind | in `ROOM_KINDS`, `shop: no enemies` in the director, **never generated** | `floors.ts:130`, `FLOORS.md §4, §6` |
| `room_cleared.reward` | already on the event, already flows to the chronicle | `contracts.ts` |

So RELAY already has a one-currency in-run economy with exactly one sink. The question is only
whether to add sinks, add a second currency, and generate the reserved room.

---

## 2 · Research, compressed

- **Hades** — dual: **obols** are in-run and lost on death, spent at Charon's shop on boons,
  healing and other currencies; **darkness/gems/keys** persist and buy permanent upgrades at the
  House. Risk lives in the in-run currency; comfort lives in the meta one.
  ([Hades](https://en.wikipedia.org/wiki/Hades_(video_game)), [how Hades deviates](https://www.fivestarjournal.com/arts-entertainment/0xwl49cpfjdreksvswtdswfu7bkqky))
- **Dead Cells** — single: **cells** are spent *during* the run at the Collector to permanently
  unlock blueprints, and **lost entirely on death**. One currency doing both jobs, with the
  tension that you must decide when to bank it.
  ([Dead Cells](https://en.wikipedia.org/wiki/Dead_Cells), [Prisoners' Quarters](https://deadcells.wiki.gg/wiki/Prisoners%27_Quarters))
- **Isaac** — coins are in-run and trivial; the interesting "shop" is the **devil deal**, priced
  in *health*, not money. The best roguelike price is sometimes not currency.
  ([Isaac items](https://tboi.com/rebirth))
- **Spelunky / the shopkeeper tradition** — the shopkeeper is a character with agency; you can
  rob him and he will kill you. "Having a shopkeeper character at all is part of the roguelike
  tradition." Charon was made fightable on purpose.
  ([PCGamesN on violent vendors](https://www.pcgamesn.com/hades/roguelike-shopkeeper-boss-fights))
- **Rogue Legacy** — gold is spent on the manor between runs and you must spend it all (Charon
  takes the rest). Forces the meta purchase, removes hoarding.
  ([Rogue Legacy upgrades](https://roguelegacy.wiki.gg/wiki/Upgrades))

**The pattern:** a second currency is only worth its UI when it buys a *different kind of thing*
on a *different timescale*. If both currencies buy power, one of them is noise.

---

## 3 · Option 1 — one in-run currency *(recommended)*

Keep `resources`. Give it a display name — **Salvage** — and more than one sink.

**Earn rate** (tune here):

| Source | Salvage | Note |
| --- | --- | --- |
| `combat` room cleared | **3** | today's `ROOM_CLEAR_REWARD`, unchanged |
| `elite` room cleared | **7** | |
| `exit` room cleared (gatekeeper) | **10** | |
| `lore_discovered` | **1** | a small reason to read |
| duplicate relic picked up | **5** | per `ITEMS.md §B.2` |
| 9th+ treasure room (relic cap hit) | **12** | per `ITEMS.md §B.2` |

A 20-room tier-2 biome: ~13 combat × 3 + 3 elite × 7 + 1 exit × 10 + ~3 lore ≈ **73 salvage**.

**Sinks:**

| Sink | Price | Where |
| --- | --- | --- |
| Unlock E ability | **3** (unchanged) | hub armory rack |
| Skill-tree node | **2 / 3 / 4 / 5 / 8** (already in `skills.ts`) | hub armory rack |
| Consumable | **8** | shop |
| Relic | **18** | shop |
| Heal 40 HP | **10** | shop |
| Flask refill | **6** | shop |
| Reroll the shop's other two slots | **4**, once | shop |

**Lifetime:** salvage resets at the start of each run, as today. Unspent salvage at
`run_ended` is **lost** (Dead Cells' rule). This is the tension that makes a shop a decision.

**Why this and not two:** every extra currency is a HUD element, a tooltip, a tutorial sentence
and an explanation on stage. RELAY's demo is 5–7 minutes and the currency is the least
interesting thing in it. One currency, more sinks.

---

## 4 · Option 2 — two currencies (Salvage + Marks)

Everything from Option 1, plus a **meta currency, device-local, cosmetic only**.

```
Mark: +1 per run_ended with outcome 'anchored'.   +0 otherwise.
Stored in relay.hub.v1 (see HUB.md §10). Never syncs, never crosses devices.
```

**Spent only on hub cosmetics** — per `HUB.md §6c`, things that change how the Stillpoint looks
and nothing else:

| Cosmetic | Marks |
| --- | --- |
| Warm the armory lamps | 1 |
| Relic shelf brass plaque (shows your deepest room) | 2 |
| Crew banner over the gate | 3 |
| Second lamp tier on the whole hub | 5 |

**Hard rule if this ships: marks must never buy power.** The moment a meta currency buys damage,
the first ten minutes of the game are objectively worse than the fortieth, and RELAY's
non-goals (`PRODUCT.md`) already rule out cross-device progression — so a power meta-currency
would be device-local power, which is worse than none.

**Verdict:** worth ~30 min *after* the hub's one-night cut is done, because it gives the hub a
visible reason to change. Not worth it before.

---

## 5 · Shops — where the reserved room kind slots in

`shop` is in `ROOM_KINDS` and the director already excludes it from enemy placement. To turn it
on:

- **Placement.** One shop per biome at **tiers 1–4** (never tier 0 — the player has no salvage
  yet). It takes the **shallowest unused dead end**, so it is found early enough to matter.
  This is a one-line change in the dead-end dealing order in `floorplan.ts` (`FLOORS.md §4.5`
  currently deals treasure/lore/rest to the *deepest* dead ends round-robin; shop takes the
  shallowest).
- **Budget interaction.** A shop consumes one dead-end special slot. The dead-end cap is
  `floor(budget/4)+1` = 3/4/6/7/8 by tier, so a tier-1 (15-room) biome giving up one of four
  slots is real but affordable. Alternative: raise the cap by 1 when a shop is placed.
- **Contents.** 3 slots, seeded from `(worldSeed, biomeId, 'shop')` so it is deterministic and
  co-op-safe: **1 consumable (8) · 1 relic (18) · 1 service (heal 40 for 10, or flask refill
  for 6)**, plus a **reroll of the other two for 4**, once.
- **The shopkeeper.** One NPC prop, one interact, one 3-slot panel. **No haggling, no theft, no
  shopkeeper fight.** Spelunky's robbable shopkeeper is the best thing in this space and it is a
  whole enemy AI; note it as a post-hackathon idea.
- **Co-op.** Salvage is **per-player** (it already is — `PlayerState.resources`). The shop's
  three slots are **shared stock**: first buyer takes the item. That is a real decision between
  four people and costs no extra UI.
- **Legacy 3-room worlds.** No shop. Do not retrofit one; the demo path must not depend on it.

**Estimated cost of the whole shop feature:** ~50 min on top of `ITEMS.md` Design B (placement
10 m, deterministic stock 10 m, NPC + panel 25 m, tests 5 m). It should be built **after**
items, never before — a shop with nothing worth buying is worse than no shop.

---

## 6 · Recommendation

1. **Ship Option 1 (one currency, more sinks) and rename it Salvage in the UI.** Zero new
   systems; it just gives the existing currency somewhere to go.
2. **Turn on the `shop` room only after `ITEMS.md` Design B is real.** It has no stock otherwise.
3. **Hold Option 2 (Marks) until the hub's one-night cut is finished.** Cosmetic-only, forever.
4. **Every number in §3 is a guess.** Nobody has played a full 5-biome run yet, so the earn rate
   and the prices are placeholders chosen so a biome affords roughly one relic *or* two
   consumables and a heal. Tune after the first end-to-end run.

---

## Needs a human call

1. **One currency or two?** I recommend one, with Marks as a cosmetic-only stretch.
2. **Is unspent salvage lost at `run_ended`?** Losing it (Dead Cells) creates the shop decision;
   keeping it makes runs feel cumulative. Cannot have both.
3. **Does a shop eat a dead-end special slot, or raise the cap by 1?** Eating a slot means a
   tier-1 biome may show no treasure room at all.
4. **Shopkeeper as a character or as a terminal?** A character needs a name, a voice and lines
   that pass the W1 linter; a terminal needs none of that and is less memorable.
5. **Price of a relic (18) vs the whole biome's income (~73).** That ratio decides whether the
   shop is a treat or the main source of items.
