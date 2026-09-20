# RELAY — onboarding and just-in-time teaching

Owner: agent O1. Implementation: `src/client/onboarding/**`, `src/client/ui/CoachPrompt.tsx`,
`src/client/ui/FieldNotes.tsx`, `src/client/styles/onboarding.css`.

Contents: [1 The problem](#1-the-problem) · [2 What the research says](#2-what-the-research-says) ·
[3 Ten decisions](#3-ten-decisions-for-relay) · [4 The curriculum](#4-the-curriculum) ·
[5 The layer](#5-the-layer) · [6 The run teaches itself](#6-the-run-teaches-itself) ·
[7 Co-op](#7-co-op) · [8 What we deliberately do not teach](#8-what-we-deliberately-do-not-teach) ·
[9 The judge constraint](#9-the-judge-constraint) · [10 Sources](#10-sources)

## 1 The problem

Three audiences sit down in front of RELAY and none of them reads anything.

1. **A judge at HackMIT.** Three to five minutes, standing up, a queue behind them. They must be
   fighting fast and must leave understanding the pitch: *we wrote this world together*.
2. **A player on the public build.** Solo, no one to ask, no patience for a tutorial level.
3. **A co-op guest** who joined the crew halfway through and has never seen the hub.

The game is not small. As of tonight it has: a walkable hub with eleven stations, four classes
with five inputs each, five biomes of ten to thirty rooms, seven room kinds, nine terrain
features, eighteen world laws (nine live), doors that seal in combat, a fog-of-war minimap and a
hold-to-open floor map, a biome choice between two doors, three gatekeepers, a three-phase boss,
a three-relay ritual, a timed collapse escape and a relic choice on the way out.

If all of that were explained up front it would be a twenty-minute lecture, and the CHI 2012
tutorial study is blunt about the result: tutorials only paid for themselves in the most complex
of the three games tested, and even there the benefit was engagement, not comprehension
(Andersen et al. 2012). The 2022 Heliyon study is blunter: their surveyed players "tended to skip
tutorials to gain a better experience", and one participant dropped out of the study altogether
because the explicit tutorial was a waste of time. So the plan cannot be "explain it".

## 2 What the research says

**George Fan, GDC 2012, "How I Got My Mom to Play Through Plants vs. Zombies".** Ten techniques.
The ones that bind us:

1. *Blend the tutorial into the game* — "teach players without them ever even realizing they're
   being taught". Never use the word "tutorial".
2. *Better to have the player do than read* — the first level teaches by being played.
3. *Spread out the teaching of game mechanics* — money did not appear in PvZ until level 10.
4. *Just get the player to do it once* — "Once they see the results of their action, that's often
   all it takes for them to understand."
5. *Use fewer words* — "There should be a maximum of eight words on the screen at any given
   moment."
6. *Use unobtrusive messaging* — do not pause the game to say something.
7. *Use adaptive messaging* — tips for players who are struggling, not for everyone.
8. *Don't create noise* — the boy who cried wolf: a prompt that did not need to be there devalues
   the next one.
9. *Use visuals to teach* — the Peashooter's mouth says what it does.
10. *Leverage what people already know*.

**Nintendo's level grammar.** World 1-1 teaches jumping by making a Goomba walk at you in an open
corridor where the only survivable answer is a jump, and it never says so. Koichi Hayashida has
described Nintendo's level structure as *kishōtenketsu* — **ki** introduce the idea safely,
**shō** develop it, **ten** twist it, **ketsu** conclude — the four-part structure Wikipedia
traces from Tang poetry to *Super Mario 3D World*. This is the single most useful idea in this
document, because it is free: it is a constraint on *room order*, not a feature.

**Celia Hodent (GDC 2016, *The Gamer's Brain*).** Working memory in learning mode holds about
three items. Learning-by-doing beats reading because it is deep processing. Space repetition
across contexts. Do not punish early failure. Do not make the player multitask while learning.
Show the lock before you give the key.

**Progressive disclosure (Nielsen Norman Group).** Show the frequently-needed things first, defer
the rest behind an obvious, well-labelled door. More than two levels of disclosure and people get
lost. Our obvious door is the menu: **Controls** for bindings, **Field Notes** for everything the
world has shown you.

**Implicit beats explicit, with a caveat.** The Heliyon pilot (47 players) found implicit tutorials
rated 0.6/5 less *boring* (p=.002) — and also 0.69/5 less *helpful* (p=.017). Honest reading: hiding
the teaching improves the feel and costs some clarity. So the implicit path is the default, and
the explicit path (Controls page, Field Notes page) is always one key away for the player who
wants it. That is exactly the progressive-disclosure split, and it is why Field Notes exists.

**How the roguelikes we are adjacent to do it.**

- *Hades* has no tutorial level. The first room of the first escape is a fight; Zagreus comments;
  the House NPCs carry the rest. Teaching lives in characters and in the hub you return to.
- *Dead Cells* uses the first biome as the tutorial and shows a tooltip on the first pickup of a
  kind, once.
- *The Binding of Isaac* draws the controls on the floor of the first room and then says nothing
  for the rest of the game.
- *Hollow Knight* and *Celeste* put the prompt on screen at the moment the ability first matters
  and take it away the moment you use it.
- *Into the Breach* explains a rule in a tooltip on the object the rule is about.

All five put the words next to the thing, at the moment it matters, and take them away.

## 3 Ten decisions for RELAY

1. **No tutorial level, no tutorial mode, and the word "tutorial" never appears.** The Proving
   Chamber in the hub stays what it is — an optional range for someone who wants to practise —
   and is never the funnel.
2. **One prompt at a time, ever.** A second lesson waits in a queue behind a cooldown.
3. **Eight words on screen.** Fan's number. Key caps do not count toward it; they are visuals, not
   prose. Every string is linted by `lintProse(text, { kind: 'uiLabel' })` in a test.
4. **A prompt dies the moment the player does the thing.** Not on a timer, not on a click. Timers
   exist only as an upper bound.
5. **A prompt that was never needed is never shown.** If the player dashed before we thought to
   ask, the dash lesson is retired silently, for good, on this device.
6. **Adaptive, not scheduled, for anything about survival.** The dash prompt is triggered by taking
   damage, not by a clock. Fan's technique 7.
7. **Never during a telegraph.** No prompt appears while an enemy is winding up, while a boss
   pattern is live, or while a canister fuse is burning. A hint that gets you hit is worse than no
   hint.
8. **Never over the operative, the ability bar, the minimap or the HUD strip.** One reserved band
   at the bottom of the stage, and nothing else.
9. **Once per device for world facts, once per run for controls.** A world fact (what a vent is)
   is learned forever. A control prompt is cheap to re-offer to someone who put the game down for
   a month — but only if they have not already done it this run.
10. **Nothing we say may be a lie.** `docs/PRODUCT.md`'s honesty rules bind the hint layer exactly
    as they bind the Quartermaster: a first-visit greeting is fine, an invented history is not. The
    hint layer states rules and controls, never events. It never says "last time you…".

## 4 The curriculum

Ordered by when the player needs it. `[K]` is a key cap rendered beside the words, not counted in
the word budget. Dismissal is "the player does it" unless stated; the seconds are the upper bound.

### Minute 0 — the hub, 20 to 30 seconds

The hub has one written wayfinding line — "WASD / arrows to walk · approach a station · F to
interact" in `HeadquartersPrompt` — and **it is hidden by CSS** (`app.css:2019`, `app.css:2074`),
as is the rail's "Walk onto the glowing gate…" line (`app.css:2020`). A stranger therefore arrives
in a walkable room with no visible statement that it is walkable. What is visible is a floating
`F · TAKE THE ARC-BLADE` once you are already standing at a stand. So the hub curriculum is five
lines, and the first one is movement.

Spawn is tile (15,10). The armory is northwest (tiles 4–8, rows 3–7). The gate is tile (15,18) —
eight tiles straight south, about 1.3 seconds of walking.

| id | trigger | words | ends when |
| --- | --- | --- | --- |
| `hub.move` | first hub visit on this device, 1.5 s after the hub is live, nobody has moved | `[W][A][S][D] Walk.` | the operative moves, or 15 s |
| `hub.weapon` | the operative has moved (or 12 s), no weapon taken at a stand yet | `Take a weapon. The stands are northwest.` | a class is selected, or 25 s |
| `hub.idea` | a weapon has been taken (or 25 s at the hub), this device has never contributed | `Write one idea. It shapes the world.` | a contribution is submitted, or 30 s |
| `hub.prepare` | host, an idea is in, no world prepared | `Prepare the world. The gate needs one.` | `world_prepared`, or 20 s |
| `hub.gate` | a world is prepared | `The gate is south. Walk onto it.` | the phase leaves the hub |
| `hub.receipt` | a world exists and the crew is still at the hub, once per device | `The receipt names whose idea became what.` | 5 s |

`hub.receipt` triggers on a world *existing*, not on the `world_prepared` event, because the
event lasts one tick and the queue can be busy with `hub.prepare` when it arrives. `run.unlock_e`
waits for the first cleared room rather than for the resources, because resources already start
at the unlock cost: the honest reading of "when it first becomes affordable" is "in the first
second of the run", which is exactly the noise Fan warns about.

`hub.idea` is the whole product pitch in six words, placed at the moment the player can act on it.
`hub.receipt` is the payoff pointer: the creation receipt already exists and already names the
contributor beside the feature, so the note's only job is to make a stranger look at it. Neither
line claims anything the receipt does not show. If generation fell back to a fixture, the receipt
says so itself and the note is still true, because it says the receipt names, not that your idea
was used.

None of these blocks the gate. A judge who ignores all of them can still walk south and leave; a
judge who follows them arrives with a weapon, an idea on the wall and a receipt to read.

### Minute 1 — the first rooms

| id | trigger | words | ends when |
| --- | --- | --- | --- |
| `run.attack` | first expedition room with a live enemy, 1.2 s, never attacked this run | `[LMB] Attack. The mouse aims.` | `player_attacked`, or 12 s |
| `run.doors` | first room whose doors are sealed by a live encounter | `Doors hold until the room is clear.` | the room is cleared, or 5 s |
| `run.dash` | the first `player_damaged` of the run, if the player has never dashed | `[Shift] Dash. It passes through danger.` | `player_dashed`, or 12 s |
| `run.ability_q` | first room cleared, if `Q` has never been used | `[Q] Your class ability is ready.` | `ability_used` with the Q slot, or 12 s |
| `run.map` | the third room discovered on the floor | `[M] Hold for the floor map.` | the map is opened, or 6 s |

Movement is not on this list for the ordinary path: the hub taught it thirty seconds ago and the
player walked through a gate to get here, so re-teaching it would be Fan's noise. `run.move` is in
the registry as a safety net at 3 s for the two cases where the hub did not happen — a guest who
joined mid-run, and the `?world=fixture&autoenter=1` preview path that skips the hub entirely.

`run.attack` is the only prompt in the game that mentions aiming, and it does so in three words
because the cursor is already visibly an aim cursor.

`run.dash` is deliberately triggered by getting hurt rather than by entering a room. A player who
never takes a hit never needs it, and Fan's technique 7 says so; a player who takes a hit is
exactly the player who will read it.

### Minute 2 to 5 — as they come up

| id | trigger | words | ends when |
| --- | --- | --- | --- |
| `run.unlock_e` | first cleared room, with the unlock affordable and `E` still locked | `[Tab] Unlock a second ability on the Operative page.` | `ability_unlocked`, or 9 s |
| `run.ability_r` | ultimate charge first reaches 100% | `[R] Ultimate ready.` | `ability_used` with the R slot, or 10 s |
| `coop.revive` | a teammate is downed and the local player is up | `[Hold F] Stand over them to revive.` | `player_revived`, or that player stands, or 15 s |
| `floor.choice` | the first `biome_choice_offered` | `Pick on the facts, not the name.` | a biome is chosen, or 8 s |
| `floor.laws` | entering a world that has active laws, once per world | one line per law: the world's name, then the engine's plain effect | 4 s each, queued |
| `boss.gatekeeper` | first elite room entered | `This move comes back at the end.` | 8 s |
| `boss.ritual` | the ritual reaches the relay stage | *silent — recorded in Field Notes only* | — |
| `boss.collapse` | `collapse_started` | `[M] The map shows the way back.` | 8 s |
| `boss.relic` | the extraction offer appears | `One relic. It goes on the hub shelf.` | a relic is chosen, or 8 s |

Four of these are shorter than they want to be because the UI already says the long half.
`BiomeChoice` already prints "1 or 2, or click a door. The crew moves together and cannot come
back.", so `floor.choice` only adds the judgement — read the cards. `EscapeTimer` already prints
"Get back to the portal", so `boss.collapse` only adds the tool. `RelicChoice` already prints
"Stand on a pedestal to carry it out.", so `boss.relic` only adds where it ends up. And
`anchorInstruction` already drives the HUD strip through every stage of the ritual in full
detail, so `boss.ritual` shows **no prompt at all** and only writes itself into Field Notes. A
lesson that would duplicate live UI is a lesson that should be a reference entry.

### First-encounter notes — once per device, one line each

These are not control prompts. They are a single flat sentence about a thing that just came into
view, in the pattern *Dead Cells* uses for a first pickup. They never repeat, and a player who
never meets a vent never hears about vents.

**Room kinds**, on first entry to one of that kind. Combat and entrance rooms are not on the list,
because a room with enemies in it does not need a caption.

| kind | words | what the canvas already says at the feature |
| --- | --- | --- |
| `rest` | `Rest room. One heal waits here.` | `REST SITE · STAND HERE TO HEAL` / `FONT SPENT` |
| `treasure` | `Treasure room. No fight, one cache.` | `CACHE · WALK OVER TO TAKE` / `CACHE EMPTY` |
| `lore` | `Lore room. Reading fills the Codex.` | `HOLD F · READ` |
| `elite` | `Elite room. One hard fight, better reward.` | — |
| `exit` | `Exit room. Clear it, then pick a door.` | `GATE LOCKED · CLEAR THE ROOM` |

The canvas prompts fire when the player is standing at the feature. The room-kind note fires on
entry, from the doorway, and names the kind — which is what the minimap legend and Field Notes use
— so the two do not say the same thing at the same time.

**Terrain**, the first time a tile of that kind is in the room the player just entered. The line is
the world's own name for the feature (`recipe.terrainSkins[].name`, which nothing else in the
client reads yet) followed by the engine's plain effect. A world that named its hazard floor
"Deck plating" gets "Deck plating: the burn ramps while you stand in it." A world that named
nothing gets the registry's own name. The engine half is fixed, short, and never a number the
room might have retuned.

| feature | engine effect (the words after the name) |
| --- | --- |
| `hazard_floor` | `the burn ramps while you stand in it` |
| `canisters` | `one hit and it blows, both ways` |
| `pits` | `dash across, or knock something in` |
| `vents` | `it fires on a beat you can watch` |
| `cover` | `stops shots, not footsteps` |
| `breakable_walls` | `attack it to open a route` |
| `rubble` | `slows footsteps, not dashes` |
| `conduits` | `faster footsteps` |
| `bridges` | `a route over the wall` |

This does not duplicate the proximity caption `RoomScene` already draws over the player's head
when they stand beside a feature. That caption is the repeat teacher and it fires every time; the
first-encounter note fires once, on arrival, before the player is standing in the thing. Fan's
technique 4 — just get them to see it once.

**World laws**, on entering a world that has them. `UiWorldSummary.laws` already carries exactly
the triple we need per law — the world's `name`, the world's `description`, the engine's `effect`
string with this world's real numbers, and `active`, which is false for the nine laws the sim does
not apply yet. We show `name` and `effect`, one law per line, four seconds each, and **we skip any
law whose `active` is false**, because announcing a rule the simulation does not enforce is the
same lie as an invented memory. The full list, active and inactive with its honest label, stays in
the world panel where it already lives.

### Field Notes — the explicit half

A menu page listing every note this device has actually seen, grouped: Controls, Rooms, Terrain,
World laws, The end of a run. Notes that have not been seen are not listed at all — no greyed rows,
no "???", because a list of locked rows is a spoiler with extra steps. The page also holds the
global hint switch and a reset.

This is the deferred half of the progressive disclosure: a player who missed a prompt while
fighting has somewhere to find it, and nobody has to read it who does not want to.

## 5 The layer

Client-only. It reads the snapshots and events the client already receives, and it writes nothing
anyone else reads. No simulation change, no protocol change, therefore no desync risk, and no
merge surface with the agents working in `GameController` tonight: it mounts through the same
additive-bridge pattern `connectFloorsUi` already uses, from `main.tsx`.

```
session.onSnapshot ─┐
session.onEvents  ──┼─→ OnboardingEngine ─→ OnboardingStore ─→ <CoachPrompt/> (one band)
uiStore.subscribe ──┘         │                                └→ <FieldNotes/> (menu page)
                              └─→ localStorage `relay.onboarding.v1`
```

**Lesson registry** (`lessons.ts`). Each lesson is `{ id, group, keys?, text, trigger, satisfied?,
priority, scope, holdMs, anchor }`. `trigger` and `satisfied` are pure predicates over a context
object — the latest snapshot, the events of this tick, the UI model and the engine's own derived
facts (has the player moved, attacked, dashed this run; which rooms have been discovered). Pure
predicates are what makes every lesson unit-testable without a browser.

**Scheduler** (`engine.ts`). Every tick: retire satisfied lessons; drop the active prompt if it
is satisfied, expired, no longer triggered or blocked; then take the highest-priority triggered
lesson, after a 900 ms cooldown. A strictly higher priority preempts the live prompt and skips
the cooldown, because a downed teammate cannot wait behind a note about rubble; nothing flaps,
because showing a lesson retires it in the same tick. Order: revive (80) → hub (70) → move (67)
→ attack (66) → dash (64) → the other controls (60–62) → the finale notes (50) → terrain (46) →
rooms (44) → laws (30).

**Two rules that only a real room revealed.**

1. *Suppression has to be local.* The first version went quiet whenever any enemy anywhere was
   winding up. Two husks on a three-second attack cycle mean something is telegraphing almost
   all the time, so the layer was effectively mute: prompts appeared in the gaps and were killed
   a second later. `isBlocked` now counts only a wind-up whose origin is within its own `range`
   plus 48 px of *this* operative, and a canister fuse within its blast radius. A live boss
   pattern, the biome-choice overlay, the menu, the departure ritual and being downed still
   silence everything, because all of those are about the whole screen.
2. *A prompt that was interrupted was not taught.* A line cut off before `MIN_VISIBLE_MS`
   (1.8 s) goes back in the queue instead of being marked as shown — up to three interruptions,
   after which the layer stops trying rather than nagging. Its Field Notes entry stays, because
   it genuinely was on screen.

**Persistence** (`store.ts`). `relay.onboarding.v1`, a Zod schema, salvaged entry by entry on
corruption exactly like `chronicle/localStore.ts`: a bad record loses one lesson's memory, never
the file. Shape: `{ version, seen: Record<id, epochMs>, satisfied: Record<id, epochMs>, off }`.

**Flags.** `?hints=off` for a clean demo capture, `?hints=reset` for a cold start. The menu page
has the same two controls for people without a URL bar.

**Placement.** One band in the **bottom left** of `.stage-wrap`, 48 px up and 24 px in. The
first build put it bottom centre, and the screenshots killed that: almost everything this game
draws over the stage is centred — the HUD strip and the escape clock at the top, the Custodian's
name-and-health strip painted along the bottom of the canvas, the relic pedestal cards at stage
bottom + 96, and the operative themselves whenever the camera follows. The bottom-left lane is
free of all of them, and the ability bar, the minimap and the `Tab · menu` chip are outside the
stage entirely. `aria-live="polite"`, `pointer-events: none`, so a screen reader announces it
once and no click can land on it.

**Menu page.** `Field Notes` becomes the seventh page. `installMenuKeyboard` hard-codes six digit
codes (`keyboardFocus.ts:38`), so the digit list has to grow with it — a one-line change, and the
Controls page's "1 – 6" row grows to match. Nothing else in the menu moves.

## 6 The run teaches itself

The prompts are the smaller half. The larger half is the shape of the first biome, which B1 and F3
already built and which reads as *kishōtenketsu* without anyone having planned it that way:

- **Ki — introduce, safely.** The entrance room has no hostiles. A player can walk, dash and swing
  at nothing, and nothing punishes the ten seconds it takes.
- **Shō — develop.** The first combat room is small, the doors seal, and clearing it opens the
  exit. One rule, demonstrated once, with the consequence visible in the same room.
- **Ten — twist.** The first hazard tile appears where standing on it is a choice, not an ambush —
  `validateRoomSafety` already keeps dangerous tiles away from spawns, doors and objectives — and
  the first elite is a gatekeeper that performs, slowly, a move the Custodian will perform later.
  That is the game showing the lock before handing over the key, which is Hodent's phrasing.
- **Ketsu — conclude.** The biome's exit room, the two doors, and a choice made on information.

Two asks of the generator that this document is the reason for, both already true and both worth
keeping true: the first room of biome 1 must contain no hostiles, and the first combat room must
be a small one. If either stops being true the prompt layer cannot fix it.

## 7 Co-op

Onboarding is **per player and per device**. There is no shared hint state and no hint in the
protocol; a host who has played fifty runs does not silence a guest's first prompt, and a guest's
prompt is not a message the host has to relay.

- **A guest who joins at the hub** gets the hub curriculum, except that `hub.gate` is replaced by
  `coop.host_gate`: `The host opens the gate. Take a weapon.` Preparing a world and picking a biome
  are host-only; saying so once is kinder than a disabled button.
- **A guest who joins mid-run** — the case *It Takes Two* and *Overcooked* handle by never letting
  a second player be lost — gets the control prompts from wherever the crew currently is, because
  every control trigger is written against "has this player done it", not "how far into the run is
  the crew". Someone dropped into biome 3 still gets `[LMB] Attack` on their first live enemy and
  still gets `[Shift] Dash` on their first hit. First-encounter notes they missed are in Field
  Notes.
- **`coop.revive`** is the one lesson that needs another person, so it can only fire in co-op and
  fires the first time a *teammate* goes down while the local player is standing. The reverse case,
  being downed yourself, is already handled by the HUD.
- **`hub.guest`** is the guest's counterpart to the host's `hub.prepare`: same priority, and it
  arrives at the same moment, once the guest's own idea is in or the host has a world. The first
  version gated it behind taking a weapon and ranked it below the weapon and idea prompts, which
  meant a guest never saw it at all — found by running two real browser contexts against the
  co-op server, not by reading the code.
- **The biome choice** is host-only, and `BiomeChoice` already prints
  "Waiting for {host} to choose. The host's pick moves the whole crew." for a guest, so the
  layer adds nothing there.

## 8 What we deliberately do not teach

Each of these was considered and cut. The reason matters more than the list.

- **Aiming.** The cursor is visibly a reticle and the operative visibly turns to face it. Three
  words inside `run.attack` is already generous.
- **That enemies damage you.** The health bar moves and the screen reacts. Teaching this would be
  Fan's noise.
- **That a cleared room opens its exits.** It happens in front of you, in the room you are standing
  in, within a second of the last enemy dying. `run.doors` teaches the *seal*, once, because the
  seal is the surprising half.
- **What each enemy does.** The telegraph is the teacher and the Bestiary is the reference. A
  prompt here would compete with the telegraph for attention at the exact moment attention is
  expensive.
- **What the right-hand rail already says.** The hub rail prints "Pick a weapon, add an idea for
  the next world, then take the gate" and, for a guest, "The host prepares the world and leads
  portal entry". The band says the same things one at a time in the play area. This is the one
  deliberate overlap in the whole layer, and it is deliberate because the rail is a column of
  small text beside the canvas: a stranger looks at the game, not at the rail. Everywhere else,
  if a visible piece of UI already says it, we do not.
- **How to pick a biome, how to stand on a pedestal, how to run the relay ritual.**
  `BiomeChoice`, `RelicChoice` and the HUD strip already print the keys, in full, at exactly the
  right moment. Two sources for one fact is how a UI starts contradicting itself — the repo
  already has one of those, where the canvas says `HOLD F · CHOOSE THE WAY ON` and the simulation
  reads a tap. We add no more of them.
- **Terrain, in advance.** Nine features taught up front is nine facts nobody can hold; Hodent's
  limit is about three. Each arrives once, when it arrives.
- **The menu.** `.menu-hint` already sits in the corner saying "Tab · menu" and has since before
  this document.
- **The skill tree.** Its own page says it is a design preview and not wired to the simulation.
  Teaching an inert system is the boy crying wolf.
- **Numbers of any kind.** Cooldowns, damage, resource costs. They are on the ability tooltips and
  the world panel for whoever wants them, and they are the first thing to go under Fan's
  eight-word budget.
- **Anything about the story.** The lore is the reward for reading, not an onboarding step, and
  `docs/WRITING.md` already governs it.
- **The nine world laws the simulation does not apply.** Saying a rule out loud that the game does
  not enforce is the same failure as an invented memory.

## 9 The judge constraint

The target is **fighting within 45 seconds of the page loading**, for a judge who does exactly and
only what the prompts say, and who has seen none of this before.

The budget, measured with a scripted bot that follows only the prompts (`?hints=reset`, wiped
profile, port 6773):

Measured at 1280×720 against a wiped profile (`?hints=reset`), headless Chromium, a bot that
does only what the prompts say. Two paths, because the hub has an optional half:

| step | driven by | measured |
| --- | --- | --- |
| page load to the hub being walkable | boot | 1.8–2.2 s |
| walk northwest, take a weapon | `hub.move`, `hub.weapon` | 14 s |
| write one idea, submit | `hub.idea` | 9 s |
| prepare the world | `hub.prepare` | 4 s |
| **everything up to a prepared world** | | **29.3 s** |
| walk south onto the gate, first room | `hub.gate` | see below |

**The fast path — a judge who takes the default weapon and skips the idea — reaches the first
room in 17.1 s and gets `[LMB] Attack. The mouse aims.` at 17.2 s.** That is the number that
matters for the 45-second constraint, and it includes the page load, the generation call and the
walk to the gate.

The full prompted path is 29.3 s through "Prepare the world", plus the gate walk. The scripted
bot cannot be trusted for that last leg — the hub is four walled wings around an open cross and
the bot repeatedly pinned itself on a doorway — but the fast path measures the same walk from
the same spawn at about five seconds, which puts a human who follows every prompt at roughly
**35 s to the first room**, inside the target.

So the layer meets the constraint both ways, and the lever if it ever stops meeting it is
`hub.idea`: an idea is optional, the gate never waits for one, and a judge who ignores that
prompt is fighting in under twenty seconds.

The second judge constraint is comprehension, not speed: they must leave knowing that the world
came from what people typed. Two things carry that, and neither is a paragraph. `hub.idea` says it
in six words at the moment they are about to type, and `hub.receipt` points at the receipt, which
prints the contributor's name beside the feature their words became. If the run fell back to a
fixture, the receipt says that too, and the note still tells the truth.

## 10 Sources

- George Fan, "How I Got My Mom to Play Through Plants vs. Zombies", GDC 2012:
  https://www.gdcvault.com/play/1015541/ — ten techniques, summarised with quotes at
  https://www.gamedeveloper.com/design/gdc-2012-10-tutorial-tips-from-i-plants-vs-zombies-i-creator-george-fan
- Andersen, O'Rourke, Liu, Snider, Lowdermilk, Truong, Cooper, Popović, "The Impact of Tutorials on
  Games of Varying Complexity", CHI 2012:
  https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf
- Zhang et al., "Learning to play: understanding in-game tutorials with a pilot study on implicit
  tutorials", *Heliyon* 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC9676530/
- Celia Hodent, "The Gamer's Brain, Part 2: UX of Onboarding and Player Engagement", GDC 2016:
  https://celiahodent.com/gamers-brain-ux-onboarding/
- Jakob Nielsen, "Progressive Disclosure", Nielsen Norman Group:
  https://www.nngroup.com/articles/progressive-disclosure/
- Kishōtenketsu, and its adoption by Miyamoto and Hayashida for *Super Mario Galaxy* and
  *Super Mario 3D World*: https://en.wikipedia.org/wiki/Kish%C5%8Dtenketsu
- In-repo: `docs/PRODUCT.md` (honesty rules), `docs/WRITING.md` (house style, and
  `lintProse(kind: 'uiLabel')` which every string here passes), `docs/design/HUB.md`,
  `docs/design/FLOORS.md`, `docs/design/TILES.md`, `docs/design/WORLD_MUTATORS.md`,
  `docs/design/BOSS_FINALE.md`, `docs/design/UI_AUDIT.md`.

Hades, Dead Cells, The Binding of Isaac, Hollow Knight, Celeste and Into the Breach are cited from
play, not from a document; the claims about them in section 2 are about behaviour any player can
check in the first ten minutes of each game.
