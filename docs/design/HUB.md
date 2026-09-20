# HUB.md — the Stillpoint, second pass

**Owner of this doc:** D1b (design only). **Implementer:** H1 (Wave 2), files
`src/shared/headquarters.ts`, `src/sim/headquarters.ts`, `src/client/render/headquarters.ts`,
`src/client/ui/HeadquartersStations.tsx`, `src/client/styles/headquarters.css`, new
`src/client/chronicle/hubState.ts`.

**This extends PR #16's Stillpoint. It does not replace it.** The room geometry, the four
wings, the four class stations, the archive, the training range, the observatory and the
departure gate all stay exactly where they are. Everything below is additive: new props, new
stations at empty tiles, a new device-local store, and one changed interaction.

**Hard constraint carried from `docs/PRODUCT.md`:** nothing in this hub may state an event that
did not happen. Every NPC line, every counter and every object on the relic shelf is derived
from a `GameEvent` the authority actually emitted, on this device.

---

## 1 · What the research says a hub is for

| Source | What it actually does | What we take |
| --- | --- | --- |
| [House of Hades](https://hades.fandom.com/wiki/The_Crossroads) · [why the hub matters](https://gamerant.com/hades-2-underworld-house-hub-area-relaxation-character-relationships-customization/) · [Hades meta-progression analysis](https://dms462fall2020.wordpress.com/2020/12/06/meta-is-etymologically-greek-right-meta-progression-in-hades/) | Hypnos comments on *how you died*; the hub changes after each run; the walk to the door is ~10 s past three NPCs. "Returning and hearing fresh dialogue directly related to the way you died reduces the meaninglessness of defeat." | **The quartermaster (§4) keyed to the last run's real events.** Failure produces a line, so failure produces content. |
| [Hades II Crossroads](https://www.thegamer.com/hades-2-crossroads-explained-mythology/) · [players comparing the two](https://steamcommunity.com/app/1145350/discussions/0/4358999171574091082/) | "More than twice as large and mechanically dense"; areas open over time. Also the common complaint: it is a place you pass through, and the density costs you the tight loop. | **Do not grow the room.** Add density as *objects and readouts*, not floor area. Walk to the portal stays ≈1.4 s. |
| [Hades weapon courtyard / Mirror of Night](https://hades.fandom.com/wiki/Mirror_of_Night) | Loadout selection is a *place*: you walk to the weapon, one button, the weapon is in your hand and visible. | **Armory rack (§5):** F equips instantly, weapon silhouette on the stand and on your operative. No panel, no confirm button. |
| [Dead Cells Prisoners' Quarters](https://deadcells.wiki.gg/wiki/Prisoners%27_Quarters) | Tiny. Its whole personality is *hanging glass flasks that fill up with what you have unlocked* — progress you read at a glance, as physical objects. | **Relic shelf (§6):** carried-out relics are physical props on a shelf. The shelf is the progress bar. |
| [Enter the Gungeon's Breach](https://enterthegungeon.wiki.gg/wiki/The_Breach) | Rescued NPCs physically move into the hub and open shops. The hub's population *is* the save file. | Same mechanic, honest version: an NPC/object appears only when the event that put it there is in the chronicle. |
| [Rogue Legacy manor](https://roguelegacy.wiki.gg/wiki/Upgrades) | Spend-gold-on-a-building meta screen. Pure menu; the building is a skin. | **Rejected.** A menu behind a wall is not a hub. Our records are plinths you stand at. |
| [Darkest Dungeon hamlet](https://darkestdungeon.wiki.gg/wiki/Hamlet) | Buildings visibly change from run-down to well-lit as you upgrade them. | **Lamp state (§6c):** the Stillpoint's lamps brighten by one step per anchor planted, capped. Cosmetic, device-local, zero gameplay effect. |
| [MH World Gathering Hub](https://monsterhunterworld.wiki.fextralife.com/The+Gathering+Hub) | Fails as a social space *because nothing requires you to be there* — you can start quests from anywhere. | **Ready-up must live at the portal tile (§7).** If the host can launch from a side panel with nobody standing at the gate, the hub is decoration. |

**The one-sentence thesis:** a hub earns its seconds by *reacting*. Ours reacts through four
channels only — an NPC line, a shelf of objects, a set of per-class numbers, and the lamps.

---

## 2 · Layout (tiles are **unchanged**)

`headquartersRoom.tiles` stays byte-identical to what is on main today. No collision change, no
spawn change, no exit change, and the six HQ tests in `tests/` stay green without edits.
Everything new is a `RoomProp` or a `HeadquartersStation` on an already-walkable tile.

Tile chars per `src/shared/registry.ts` (`#` wall, `.` floor, `P` spawn, `X` exit):

```
    0         1         2
    0123456789012345678901234567890
 0  ##############################
 1  #..........#.......#.........#
 2  #..........#.......#.........#
 3  #..........#.......#.........#
 4  #..........#.......#.........#
 5  #............................#
 6  #............................#
 7  #..........#.......#.........#
 8  #..........#.......#.........#
 9  #............................#
10  #..............P.............#
11  #............................#
12  #............................#
13  ######..###.........##..######
14  #..........#.......#.........#
15  #............................#
16  #............................#
17  #..........#.......#.........#
18  #..........#...X...#.........#
19  ##############################
```

Annotation overlay — **not tile chars**, a reading aid for the same grid. All overlay glyphs sit
on tiles that are `.` above. Lowercase = new this pass:

```
    0         1         2
    0123456789012345678901234567890
 0  ##############################
 1  #..........#rrrsrr.#.........#
 2  #..........#.......#.........#
 3  #...1...2..#.|...|.#.........#
 4  #..........#.......#....A....#
 5  #............................#
 6  #.............bqb............#
 7  #...3...4..#.......#...c.c...#
 8  #..........#.......#...cRc...#
 9  #............................#
10  #..............P.............#
11  #............................#
12  #............................#
13  ######..###.........##..######
14  #..........#.......#.........#
15  #............................#
16  #....T..................O....#
17  #..........#.......#.........#
18  #..........#...X...#.........#
19  ##############################
```

| glyph | tile(s) | what |
| --- | --- | --- |
| `1 2 3 4` | (4,3) (8,3) (4,7) (8,7) | class stands — Bastion, Shade, Beacon, Weaver (**unmoved**) |
| `r` | (12,1) (13,1) (14,1) (16,1) (17,1) | relic shelf brackets — 5 props, **new** |
| `s` | (15,1) | `relics` station, the reading lectern — **new** |
| <code>&#124;</code> | (13,3) (17,3) | existing pillars, kept: they frame the shelf |
| `b` | (14,6) (16,6) | returns bench (dressing) — **new** |
| `q` | (15,6) | **Quartermaster** NPC — **new** |
| `A` | (24,4) | Echo archive (**unmoved**) |
| `c` | (23,7) (25,7) (23,8) (25,8) | per-class record plinths — **new** |
| `R` | (24,8) | `records` station — **new** |
| `T` | (5,16) | Proving chamber (**unmoved**) |
| `O` | (24,16) | Observatory (**unmoved**) |
| `P` | (15,10) | spawn (**unmoved**) |
| `X` | (15,18) | Departure gate (**unmoved**) |

### Walk budget (PLAYER_SPEED 190 u/s, TILE_SIZE 32)

| From → to | Tiles | Seconds |
| --- | --- | --- |
| Spawn (15,10) → portal (15,18) | 8 | **1.35 s** ✅ (budget ≤ 6 s) |
| Spawn → quartermaster (15,6) | 4 | 0.67 s |
| Spawn → relic shelf (15,1) | 9 | 1.5 s |
| Spawn → nearest class stand (8,7) | ~8 | 1.4 s |
| Spawn → records plinths (24,8) | ~13 | 2.2 s |
| Spawn → observatory (24,16) | ~15 | 2.5 s |
| Full tour of all 11 stations → portal | ~58 | ~9.8 s |

The hub stays Dead-Cells-small. The reason to walk is that three of the new things
(quartermaster, shelf, plinths) are *on the spawn→portal spine or one step off it*.

### Station list (extends `HEADQUARTERS_STATIONS`)

`HeadquartersStationId` becomes
`ClassId | 'archive' | 'records' | 'observatory' | 'training' | 'portal' | 'quartermaster' | 'relics'`.

| id | tile | wing | action label | new? |
| --- | --- | --- | --- | --- |
| `bastion` | 4,3 | Armory | `Take the arc-blade` | changed action |
| `shade` | 8,3 | Armory | `Take the phase blades` | changed action |
| `beacon` | 4,7 | Armory | `Take the lantern staff` | changed action |
| `weaver` | 8,7 | Armory | `Take the plasma loom` | changed action |
| `quartermaster` | 15,6 | Returns hall | `Speak to the quartermaster` | **new** |
| `relics` | 15,1 | Returns hall | `Read the shelf` | **new** |
| `archive` | 24,4 | Records wing | `Read records` | unchanged |
| `records` | 24,8 | Records wing | `Read service record` | **new** |
| `training` | 5,16 | Training wing | `Inspect range` | unchanged |
| `observatory` | 24,16 | Navigation wing | `Plan expedition` | unchanged |
| `portal` | 15,18 | Transit hall | `Ready up` / `Open the gate` (host) | changed action |

`HEADQUARTERS_INTERACT_RANGE` stays 58 (≈1.8 tiles). Check the new coordinates against it:
nearest pair is `records` (24,8) to `archive` (24,4) = 128 u apart, so no ambiguous overlap.
The four class stands are 128 u apart on both axes — also unambiguous.
`nearbyHeadquartersStation` needs no change beyond the larger array.

### New props (all on walkable tiles, all `blocksMovement: false` except the shelf)

| prop | tiles | `PropId` | note |
| --- | --- | --- | --- |
| Relic shelf | (12,1) (13,1) (14,1) (16,1) (17,1) | `monolith_shard` ×5 | bracket *n* renders relic *n*, or an empty outline. `blocksMovement: true` is fine — the lectern at (15,1) is the approach tile |
| Class record plinths | (23,7) (25,7) (23,8) (25,8) | `terminal` ×4 | one per class, unlit until that class has ≥1 run |
| Returns bench | (14,6) (16,6) | `crate` ×2 | flanks the quartermaster; purely dressing |
| Existing pillars | (13,3) (17,3) | `pillar` | **keep**, they frame the shelf |

No new `PropId` is required. If H1 wants a distinct relic silhouette, that is one extra
renderer case, not a registry change (the shelf is drawn by `drawHeadquartersStations`, not by
the generic prop renderer).

---

## 3 · Events actually available (ground truth)

From `GameEventSchema` in `src/shared/contracts.ts`. **This is the complete set. Nothing
outside it may drive a line, a number or an object.**

| Event | Fields usable in the hub |
| --- | --- |
| `contribution_submitted` | `contributionId`, `playerId` |
| `world_prepared` | `worldId`, `worldTitle`, `source`, `playerIds` |
| `room_entered` | `worldId`, `roomIndex`, `roomId`, `roomName`, `playerIds` |
| `player_dashed` | `playerId`, `x`, `y`, `facing` |
| `player_attacked` | `playerId`, `hitEnemyIds[]` |
| `enemy_damaged` | `enemyId`, `byPlayerId`, `amount`, `remainingHp` |
| `enemy_defeated` | `enemyId`, `byPlayerId` |
| `player_damaged` | `playerId`, `amount`, `remainingHp`, `sourceEnemyId` (nullable) |
| `player_downed` | `playerId` |
| `player_revived` | `playerId`, `byPlayerId`, `hp` |
| `player_healed` | `playerId`, `byPlayerId`, `amount`, `remainingHp` |
| `ability_used` | `playerId`, `abilityId`, `hitEnemyIds[]` |
| `ability_unlocked` | `playerId`, `abilityId`, `cost`, `remainingResources` |
| `room_cleared` | `worldId`, `roomIndex`, `roomId`, `playerIds`, `reward` |
| `enemy_telegraphed` | `enemyId`, `telegraph` |
| `enemy_attacked` | `enemyId`, `hitPlayerIds[]` |
| `lore_discovered` | `playerId`, `fragmentIndex`, `kind` (`relic`\|`remains`), `title`, `source`, `text`, `x`, `y` |
| `exit_reached` | `playerId`, `roomIndex`, `toRoomIndex` |
| `anchor_planted` | `worldId`, `roomIndex`, `playerIds` |
| `run_ended` | `worldId`, `outcome` (`anchored`\|`collapsed`\|`aborted`), `playerIds` |

All events carry `id`, `tick`, `timeMs`.

**The one gap: no event carries `classId`.** Per-class records therefore cannot be reduced from
events alone. Two ways out:

- **(a)** add `classId` to `player_downed` / `enemy_defeated` / `run_ended` — an interface change
  owned by Agent A, conflicts with F1b tonight. ✗
- **(b) recommended:** the *client* adapter stamps it. `BrowserChronicle.ingest` already
  receives a context; H1 adds a sibling reducer `reduceHubState(state, events, { now, players,
  world, classByPlayerId })` where `classByPlayerId` is read from the live `GameSnapshot` at
  ingest time. Device-local, no contract change, no conflict. ✓

---

## 4 · The quartermaster

One NPC. Standing figure at (15,6), warm-lamp colour per `docs/ART_DIRECTION.md` ("warm lamp =
anything human"). No portrait art, no walk cycle: a 28×44 standing silhouette with a slow
2-frame idle bob is enough at this camera.

**Speech**: a mono 2-line box above the NPC. Appears when the local player is within
`HEADQUARTERS_INTERACT_RANGE`, persists 8 s or until the player leaves the radius, whichever is
first. Pressing `F` at the station pins the box and opens the station panel with the same lines
plus the evidence footer (see below). Lines never queue: one cue, up to 2 line slots.

### 4a · Cue engine

```ts
// src/shared/hubCues.ts — pure, testable, no randomness
export interface HubCueContext {
  lastRun: LastRun | null;          // §4b
  records: Record<ClassId, ClassRecord>;  // §6b
  totals: { runs: number; anchors: number; worldsVisited: number; relics: number };
  session: { classId: ClassId; classChangedSinceLastRun: boolean;
             worldPrepared: boolean; crewSize: number };
}

export interface HubCue {
  id: string;                       // stable; used for once-per-state suppression
  priority: number;                 // higher wins; ties broken by id, never by random
  slots: 1 | 2;                     // how many lines the writer may supply
  /** Pure predicate. MUST only read HubCueContext. */
  when(ctx: HubCueContext): boolean;
  /** The ONLY interpolation vars a line for this cue may use. */
  vars: readonly string[];
}

export function pickCue(cues: HubCue[], ctx: HubCueContext, suppressed: Set<string>): HubCue | null;
```

**Selection:** filter by `when`, drop anything in `suppressed`, take max `priority`. If nothing
matches, use `fallback_idle` (always true, priority 0). Deterministic — same state, same line,
every time. That matters: a player who walks away and back must not get a different "memory".

**Suppression:** a cue id is added to `suppressed` once shown, and cleared when `lastRun.endedAt`
changes. So one line per cue per run, and the whole set unlocks again after the next run.

**Linter contract (enforced by a unit test, not by review):** for every cue, every `{var}` in
every line template must be in that cue's `vars`. A line that names an enemy, a room, a
teammate or a number not in `vars` fails the test. This is the mechanical form of the honesty
rule. Lines themselves are written by W1 under `docs/WRITING.md`; the samples below are
placeholders showing register and length, not final copy.

### 4b · `LastRun` — derived once per `run_ended`

```ts
interface LastRun {
  worldId: string; worldTitle: string;
  outcome: 'anchored' | 'collapsed' | 'aborted';
  classId: ClassId;                 // stamped client-side (§3b)
  endedAt: number; durationMs: number;
  roomsEntered: number;             // count of room_entered with local in playerIds
  deepestRoomIndex: number;         // max room_entered.roomIndex
  roomsCleared: number;
  enemiesDefeated: number;          // enemy_defeated.byPlayerId === local
  damageDealt: number;              // Σ enemy_damaged.amount, byPlayerId === local
  damageTaken: number;              // Σ player_damaged.amount, playerId === local
  downs: number;                    // player_downed.playerId === local
  lastDownedByEnemyId: EnemyId | null;  // sourceEnemyId of the last player_damaged with
                                        // playerId === local strictly before the last
                                        // player_downed; null if sourceEnemyId was null
  revivesGiven: number; revivesReceived: number;
  loreRead: number;                 // lore_discovered.playerId === local
  abilityUnlocked: AbilityId | null;
  crew: Array<{ id: string; displayName: string }>;  // run_ended.playerIds, resolved
  worldSource: GenerationSource;
}
```

`lastDownedByEnemyId` resolves to a display name through `ENEMY_INFO[id].name`. If
`sourceEnemyId` is `null` (hazard floor, fall damage), the `downed_by` cue does **not** fire —
`downed_unattributed` does instead. Never guess the killer.

### 4c · Trigger table

`p` = priority. Sample lines are dry, concrete, no mysticism — three per cue, showing the shape.

| # | cue id | p | slots | Fires when (all from real events) | `vars` | 3 sample lines |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `first_visit` | 10 | 1 | `totals.runs === 0 && !session.worldPrepared` | — | "Nothing on the shelf yet. That's normal." · "Rack's on your left. Gate's behind me." · "You haven't been anywhere. Go somewhere." |
| 2 | `world_charted_no_departure` | 15 | 1 | `session.worldPrepared && (lastRun === null \|\| lastRun.worldId !== currentWorldId)` | `worldTitle` | "{worldTitle} is charted. The gate is open when you are." · "Destination's logged. I'd go before it shifts." · "{worldTitle}. Take the rack first." |
| 3 | `downed_by` | 70 | 2 | `lastRun.downs > 0 && lastRun.lastDownedByEnemyId !== null` | `enemyName`, `deepestRoomIndex`, `worldTitle`, `downs` | "A {enemyName} put you down in room {deepestRoomIndex}." · "{downs} times down, all of it to {enemyName}. It telegraphs. Watch the floor." · "{enemyName}, room {deepestRoomIndex}. Bring something with reach." |
| 4 | `downed_unattributed` | 65 | 1 | `lastRun.downs > 0 && lastRun.lastDownedByEnemyId === null` | `deepestRoomIndex`, `downs` | "Down {downs} times, and not one of them to anything I can name." · "Room {deepestRoomIndex} did it, not a creature. Mind the floor." · "The room killed you. Happens." |
| 5 | `anchored_clean` | 80 | 2 | `lastRun.outcome === 'anchored' && lastRun.downs === 0` | `worldTitle`, `durationMin`, `damageTaken` | "{worldTitle} is anchored and you never went down. Log says {damageTaken} damage taken." · "Clean. {durationMin} minutes, no revives." · "Anchored, no downs. Don't let it become a habit." |
| 6 | `anchored_costly` | 75 | 2 | `lastRun.outcome === 'anchored' && lastRun.downs > 0` | `worldTitle`, `downs`, `revivesReceived` | "{worldTitle} holds. It cost you {downs} downs." · "Anchored. You were picked up {revivesReceived} times getting there." · "It's standing. You're not, much." |
| 7 | `collapsed` | 60 | 2 | `lastRun.outcome === 'collapsed'` | `worldTitle`, `deepestRoomIndex`, `roomsCleared` | "{worldTitle} went down. You got to room {deepestRoomIndex}." · "{roomsCleared} rooms cleared before it folded. The record stands." · "It collapsed. The log doesn't." |
| 8 | `aborted` | 55 | 1 | `lastRun.outcome === 'aborted'` | `worldTitle`, `deepestRoomIndex` | "You came back early from {worldTitle}. No judgement, no anchor either." · "Pulled out. The gate doesn't mind." · "Aborted at room {deepestRoomIndex}." |
| 9 | `revived_ally` | 50 | 1 | `lastRun.revivesGiven > 0 && crew.length > 1` | `revivesGiven`, `crewNames` | "You stood {revivesGiven} of them back up. That's in the log too." · "{crewNames} owe you {revivesGiven}." · "Two hands, {revivesGiven} pickups." |
| 10 | `lore_heavy` | 40 | 1 | `lastRun.loreRead >= 3` | `loreRead`, `worldTitle` | "{loreRead} fragments off {worldTitle}. Shelf's fuller." · "You read {loreRead} things down there. Most don't." · "Reading pays. Keep it up." |
| 11 | `lore_none` | 35 | 1 | `lastRun.loreRead === 0 && lastRun.roomsEntered >= 3` | `roomsEntered` | "{roomsEntered} rooms and you read nothing." · "There was writing down there. You walked past it." · "Nothing recovered. The shelf stays where it is." |
| 12 | `class_changed` | 45 | 1 | `session.classChangedSinceLastRun` | `className`, `previousClassName`, `runsOnClass` | "{className} now. You've taken it out {runsOnClass} times." · "Off the {previousClassName}. Different reach, different range." · "{previousClassName} to {className}. Re-learn the ranges." |
| 13 | `new_class_first_run` | 48 | 1 | `records[session.classId].runs === 0 && totals.runs > 0` | `className` | "First time out with the {className} kit." · "New rack, new habits." · "{className}. You've never logged a run on it." |
| 14 | `ability_unlocked` | 42 | 1 | `lastRun.abilityUnlocked !== null` | `abilityName` | "{abilityName} is signed out to you now." · "You spent the salvage on {abilityName}. Use it." · "{abilityName} unlocked last run." |
| 15 | `deepest_yet` | 68 | 1 | `lastRun.deepestRoomIndex > previousBest(records[classId])` | `deepestRoomIndex`, `className` | "Room {deepestRoomIndex}. Furthest the {className} kit has been." · "New deepest. Room {deepestRoomIndex}." · "You went past your own mark." |
| 16 | `shelf_filling` | 30 | 1 | `totals.relics >= 3` | `relicCount`, `bracketsFree` | "{relicCount} things on the shelf now." · "Shelf's carrying {relicCount}. It was empty." · "{bracketsFree} brackets left." |
| 17 | `fixture_world` | 20 | 1 | `lastRun.worldSource !== 'live'` | `worldTitle` | "{worldTitle} came out of the offline set. Still counts as a run." · "That one wasn't written fresh. The log's the same." · "Fixture world. Noted in the receipt." |
| 18 | `fallback_idle` | 0 | 1 | always | — | "Rack's open. Gate's behind me." · "Nothing to report." · "Take what you need." |

Eighteen cues, one line slot each at minimum. **One-night cut: ship cues 1, 3, 4, 5, 6, 7, 8,
18** — eight cues, three lines each = 24 lines for W1, and every one of them is a reaction to a
real run outcome. The rest are pure additions later.

**Evidence footer (honesty, and it is also the best feature):** the station panel shows, under
the line, the exact derivation — `from: run_ended (anchored) · player_downed ×2 ·
player_damaged.sourceEnemyId = warden`. It is small mono text. It proves the game is not making
things up, which is the whole pitch.

### 4d · Optional second NPC — the Cartographer (cut line)

At the observatory (24,16). Her cues read a **different, non-overlapping** event source:
`contribution_submitted`, `world_prepared`, and the `CreationReceipt` lines (`used` / not used).
Four cues: `no_contributions`, `contributions_pending` (n signals, not yet generated),
`world_live` (n of m ideas shaped observable features — she names one), `world_fallback` (live
generation failed, the fixture is labelled). This is the receipt spoken aloud by a person, which
is exactly the emotional differentiator in `PRODUCT.md`. **Cost ≈ 30 min on top.** Ship only if
§9 items 1–5 are done.

---

## 5 · Class switching: shrines vs rack vs bench

| Option | Steps to switch | In-universe? | Co-op legibility | Cost |
| --- | --- | --- | --- | --- |
| **A. Today's shrines** (4 stations, F → panel → click "Attune Bastion") | walk + F + click = 3 | "Attune at a shrine" is mystical; `ART_DIRECTION` wants a *field terminal*, not a temple | none — a remote player's class is a coloured ring you must decode | 0 |
| **B. Armory rack, in place** *(recommended)* — same four tiles, stands hold the class *weapon*; `F` equips instantly, no panel, no confirm. Panel still opens on `Tab`/hold-F for the ability detail. | walk + F = 2 | yes — "take the arc-blade" | yes — each operative renders carrying their weapon, and the stand you took it from goes empty-bracket | **~25 min**: `action` strings, one branch in `activateHeadquartersStation`, weapon silhouettes in `drawStationSymbol` (already a switch on station id), one "CURRENT" tag |
| **C. Single loadout bench** — one station, radial 4-way picker | walk + F + pick = 3 | reads as a menu | worse — nothing physical to stand at | ~40 min, and it deletes three of the four things in the armory wing |
| **D. Walk-through auto-equip** (no F at all) | walk = 1 | yes | yes | risky: you cross the armory on the way to the archive and swap class by accident |

**Recommendation: B.** It is the Hades weapon courtyard, it costs the least, it changes no
coordinates so no test moves, and it is the only option that makes another player's class
readable across the room. Keep the existing panel as the *detail* view (ability descriptions,
E-unlock button) — it is good, it is just the wrong thing to require for a class swap.

Copy changes with it: `action` becomes `Take the arc-blade` / `Take the phase blades` / `Take the
lantern staff` / `Take the plasma loom` (weapon names already in `CLASS_THEME[].weapon`). The
wing label stays `01 / ARMORY`. Drop the word "attune" from the hub — "attunement" should mean
only the world-grown skill branch (`ATTUNEMENT_EFFECT_IDS`), not class choice. Two meanings for
one word is the actual confusion the lead is reacting to.

---

## 6 · Records, relics, lamps

### 6a · Relic shelf (5 brackets, tiles 14–18 at y=1)

**What a relic is, honestly, with today's events:** a `lore_discovered` event of
`kind: 'relic'` from a run whose `run_ended.outcome === 'anchored'`. One per world — the last
one read — so five worlds fill the shelf. When B1's "carry one out at the portal" lands, that
choice replaces the "last read" rule and nothing else changes.

```ts
interface HubRelic {
  id: string;              // `relic-${worldId}-${fragmentIndex}`
  worldId: string; worldTitle: string;
  title: string;           // lore_discovered.title, ≤40
  source: string;          // lore_discovered.source, ≤60
  text: string;            // lore_discovered.text, ≤520
  recoveredBy: Array<{ id: string; displayName: string }>;
  recoveredAt: number;     // event timeMs mapped to wall clock at ingest
  sourceEventIds: string[];  // same proof field the MemoryRecord carries
}
```

Cap 5 on the shelf (oldest scrolls off, still in the store, cap 24 total). Brackets render
newest-left. Standing at `relics` and pressing F opens a panel listing all held relics with the
full text and the "recovered by … in {worldTitle}" line. Empty brackets render as an outline —
Dead Cells' empty flasks, which is the whole point: you see how much you have not done.

### 6b · Records room — per-class plinths

Four `terminal` props at (23,7) (25,7) (23,8) (25,8), one per class, class-coloured, unlit until
that class has `runs > 0`. Station `records` at (24,8) opens a panel with four tabs.

```ts
interface ClassRecord {
  runs: number;              // run_ended, local in playerIds, stamped classId
  anchors: number;           // anchor_planted, local in playerIds
  collapses: number;         // run_ended outcome 'collapsed'
  aborts: number;            // run_ended outcome 'aborted'
  deepestRoomIndex: number;  // max room_entered.roomIndex
  roomsCleared: number;      // room_cleared, local in playerIds
  enemiesDefeated: number;   // enemy_defeated.byPlayerId
  damageDealt: number;       // Σ enemy_damaged.amount
  damageTaken: number;       // Σ player_damaged.amount
  timesDowned: number;       // player_downed
  revivesGiven: number;      // player_revived.byPlayerId
  revivesReceived: number;   // player_revived.playerId
  loreRead: number;          // lore_discovered.playerId
  abilityUseCounts: Partial<Record<AbilityId, number>>;  // ability_used.playerId
  nemesisCounts: Partial<Record<EnemyId, number>>;       // per §4b attribution
  longestRunMs: number;
}
```

Displayed per class, in this order, with these labels:

1. **Expeditions** `runs` · **Anchored** `anchors` · **Collapsed** `collapses`
2. **Deepest room** `deepestRoomIndex + 1`
3. **Rooms cleared** `roomsCleared` · **Hostiles down** `enemiesDefeated`
4. **Damage dealt / taken** `damageDealt` / `damageTaken`
5. **Times downed** `timesDowned` · **Picked up / picked up others** `revivesReceived` / `revivesGiven`
6. **Most used** `argmax(abilityUseCounts)` → `ABILITY_DETAILS[id].name` (omit if empty)
7. **Nemesis** `argmax(nemesisCounts)` → `ENEMY_INFO[id].name` (omit if empty)
8. **Fragments read** `loreRead`

Same honesty footer as the existing archive panel: *"Counts reflect events recorded on this
browser. They are not lifetime totals."* Reuse that exact sentence — it already exists in
`HeadquartersStationPanel`.

**If time is short:** make this a second tab inside the existing `archive` panel and skip the
`records` station and plinths. Saves ~10 min, loses the "room" feeling.

### 6c · Lamps

`lampTier = min(3, totals.anchors)`. Tier 0 → today's values. Each tier raises
`headquartersArt.glowIntensity` by 0.15 and the lantern radii by 8 %. Cosmetic only, device-local,
derived (not stored). Two lines in the renderer. It is the Darkest Dungeon "building gets
brighter" trick and it costs nothing.

---

## 7 · Co-op presence (2–4 players)

What players actually *do* together in this room, in the order they do it:

1. **See each other.** Remote operatives render in `neonViolet` per `ART_DIRECTION`, with a
   nameplate (`displayName`) and, new, the **weapon silhouette of their class**. That is the
   whole class-legibility payoff of §5B. Nameplates render in the hub only.
2. **Crew strip.** A single row at the top of the hub stage: `name · class · ready`, one chip
   per player, local chip outlined cyan. Reuses the existing `model.players` array; the only
   new field is `ready`.
3. **Split up.** Armory is west, observatory is east, and both are ≤2.5 s away. Four players
   doing four things at once in a 30×20 room is the Gathering-Hub feeling without the size.
4. **Ready up at the gate.** Standing on or within 58 u of the portal tile sets
   `ready = true`; walking away clears it. The gate renders `2 / 3 READY` and one filled arc per
   ready operative. **The host's "Enter portal" button stays the launch authority** (it is
   already host-gated), but it is `disabled` until every connected player is ready — that is the
   MH-World lesson: if the host can launch from a side panel while nobody is at the gate, the
   gate is decoration. Solo: `ready` is implicit, button behaves exactly as today.
5. **Leave together.** §8.

New snapshot field: `PlayerState.ready?: boolean` (hub phase only; the sim sets it from
proximity each tick, no new intent). New snapshot field:
`GameSnapshot.departureCountdownMs?: number | null`.

---

## 8 · Departure ritual (2.4 s, skippable)

Triggered by the host pressing Enter portal with everyone ready.

| t | Sim | Render | Audio |
| --- | --- | --- | --- |
| 0.0 s | `departureCountdownMs = 2400`; inputs locked; `ready` frozen | Portal ring brightens to 1.6× over 400 ms; hub lamps dim to 0.4 over 800 ms | one low tone |
| 0.4 s | — | Each operative gets a 1-tile cyan/violet tether line to the portal centre | — |
| 1.0 s | — | Quartermaster turns to face the gate (one sprite flip). **No line.** | — |
| 1.6 s | — | Ring collapses inward; white flash ramp starts | rising tone |
| 2.4 s | phase → `preparing`/`expedition`; `room_entered` fires here as today | full-screen white for 120 ms, then the first room | — |

Skippable with `F` or `Esc` → jumps to 2.4 s immediately. **Make it skippable from day one**; a
2.4 s gate you see thirty times in a demo rehearsal is a tax on the team, not a ritual.

On return, the reverse is 600 ms only: fade in at spawn (15,10), lamps up, and the quartermaster's
cue box is already showing when the fade finishes — the first thing you read on returning is a
reaction to what just happened. That ordering is the single most important detail in this doc.

---

## 9 · One-night cut — priority order, ~2 h for one agent

Each item is independently shippable and leaves the hub working if the next one is dropped.

| # | Item | Est | Done when |
| --- | --- | --- | --- |
| **1** | **Armory rack in place** (§5B): `action` strings → weapon names, `F` equips immediately with no panel gate, weapon silhouette on the stand + "CURRENT" tag on the equipped one, drop "attune" from hub copy | 25 m | Pressing F at any class stand changes class in one press; screenshot shows four distinct weapon silhouettes |
| **2** | **Hub state store** (§3b, §4b, §6a, §6b): `src/client/chronicle/hubState.ts`, key `relay.hub.v1`, Zod-validated, `classByPlayerId` stamped at ingest, salvage-on-corrupt like `localStore.ts` | 30 m | Unit test: a scripted event list → expected `LastRun` + `ClassRecord`; corrupt JSON loads as empty |
| **3** | **Quartermaster** (§4): NPC prop + `quartermaster` station + `hubCues.ts` with cues 1/3/4/5/6/7/8/18 + speech box + evidence footer | 35 m | Two scripted runs (anchored-clean, collapsed-with-warden) produce two different, correct lines; the var-whitelist test passes |
| **4** | **Per-class records** (§6b): plinths, `records` station, four-tab panel | 20 m | Panel shows non-zero numbers after one real run; unlit plinths for unplayed classes |
| **5** | **Relic shelf** (§6a): store slice, 5 brackets, `relics` station + read panel | 20 m | A run with a `lore_discovered` relic that ends `anchored` puts one object on the shelf |
| **6** | **Co-op ready-up** (§7 items 1, 2, 4): `ready` field, crew strip, gate readout, host button gating | 15 m | Two-context shot shows `1 / 2 READY`, host button disabled until both |
| **7** | **Departure ritual** (§8) + lamp tiers (§6c) | 15 m | 2.4 s sequence plays and is skippable |
| — | *Cut line* | | |
| 8 | Cartographer NPC (§4d) | 30 m | |
| 9 | Cues 2, 9–17 | 20 m | |

Total for 1–7: **2 h 40 m at these estimates**, so the realistic delivery is **1–5** in two hours
(the reactive hub) with 6–7 as stretch. If the co-op demo is the priority, swap 6 ahead of 5.

**Nothing here blocks or is blocked by floors.** Every item works on today's 3-room worlds
(`deepestRoomIndex` is just smaller) and keeps working on 5-biome worlds unchanged.

---

## 10 · Interfaces H1 needs

```ts
// src/shared/headquarters.ts
export type HeadquartersStationId =
  | ClassId | 'archive' | 'records' | 'observatory' | 'training'
  | 'portal' | 'quartermaster' | 'relics';

// src/shared/contracts.ts — additive, both optional, no schema break
PlayerStateSchema.shape.ready            // z.boolean().optional()
GameSnapshotSchema.shape.departureCountdownMs  // z.number().nullable().optional()

// src/shared/ui.ts
interface UiModel {
  headquarters?: {
    nearbyStationId: HeadquartersStationId | null;
    activeStationId: HeadquartersStationId | null;
    cue: { id: string; lines: string[]; evidence: string } | null;
    relics: HubRelic[];
    records: Record<ClassId, ClassRecord>;
    crew: Array<{ id: string; displayName: string; classId: ClassId; ready: boolean; isLocal: boolean }>;
    departureCountdownMs: number | null;
  };
}
interface UiActions {
  toggleReady?(): void;       // solo: no-op
  skipDeparture?(): void;
}
```

**Persistence:** one new key, `relay.hub.v1`, device-local, same `KeyValueStorage` injection and
same quota-retry pattern as `relay.memories.v1`. `MAX_STORED` 24 relics. The existing "Clear"
button on the memory wall must clear this key too — the doc-level rule is *one erase clears
everything derived from events*, or the wall lies about what the device holds.

**Renderer:** everything new lives inside `drawHeadquartersStations` (it already owns the
graphics layers and the label helper). Additions: `drawShelf`, `drawQuartermaster`,
`drawPlinths`, `drawGateReadout`, plus three cases in the existing `drawStationSymbol` switch.
Remote-player weapon silhouettes go in the entity renderer, not here. Keep the `previous`-key
dirty check pattern — the cue box must not re-layout every frame.

---

## Needs a human call

1. **One NPC or two?** The Cartographer (§4d) is the single strongest piece of the "our ideas
   made this world" pitch, and it costs 30 min that the hub does not strictly need.
2. **Is the evidence footer (§4c) on by default, or behind a toggle?** It is the honesty proof
   and it is also mono text under every line. I say on; it may read as debug output on stage.
3. **Class switching mid-crew in co-op** — right now any player can swap at any time. Should the
   rack lock once the host has a world charted, so the crew composition at the gate is the one
   that departs?
4. **Does "Clear memories" also wipe relics and per-class records?** I recommend yes (one
   erase, one meaning). It also destroys the shelf a judge just watched fill.
5. **Ready-up strictness:** host button hard-disabled until all ready (my recommendation), or
   enabled with a "2 / 3 ready — go anyway?" confirm? Hard-disabled can strand a demo if a
   client desyncs.
