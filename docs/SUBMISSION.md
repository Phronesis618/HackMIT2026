# RELAY — submission answers

Draft for the Devpost/Plume long-form fields. Every number here points at a file in this repo;
anything unmeasured says so. Track: **Entertainment**. Repo:
https://github.com/Phronesis618/HackMIT2026

Two things need a human before this is pasted:

1. The `curious-droid` GitHub account committed 275 of the 423 commits as the Claude Code
   orchestrator. **Individual Contributions** below names it as "the orchestrator" rather than a
   person — put the right name in.
2. Because of (1) the **team size** is ambiguous in the repo: five committing human identities,
   but `docs/TEAM_PLAN.md` says three humans. The text below deliberately avoids stating a
   number. Say the real one.

---

## Project description (short blurb)

**RELAY — Worlds end. Your stories don't.**

A co-op roguelike where you and your friends build the world before you fight through it. You
stand together in a shared headquarters, each of you types one sentence about the place you want
to go, and about fifty seconds later Claude has written that world — its history, five biomes of
it, the physical laws that will bend the fight, the boss and the names of its three phases. A
creation receipt puts *your friend's name* next to the thing their words became. Then you walk
through the gate together and find out what you made.

Everything that happens in there — who went down, who picked them up, what you carried out —
comes home as memories on the headquarters wall. Not a score. The actual run.

The model never writes a line of code. It fills a strict schema and picks IDs from closed
registries; our code builds the rooms. The multiplayer is server-authoritative at 60 Hz, and the
world you explore is built from a seed on each machine rather than shipped over the wire.

---

## Inspiration

We wanted the feeling of a place that belongs to *your group* specifically.

Everyone has had the good version of this at a table: somebody says "okay but what if the library
is underwater and the books are still talking," and everyone leans in, and for the next three
hours that is where you all live. Nothing in games does that. You get a level designer's world, or
you get procedural noise, and either way you and your friends are tourists in it. The most
personal thing multiplayer usually offers you is a lobby.

So the question became: what if the thing you explore together is the thing you came up with
together — not as a mod, not as a level editor you spend a weekend in, but as *one sentence each,
typed in thirty seconds, in the room with your friends, right before you go in?* And what if the
run left something behind, so a month later the hub still shows the world Ravi's idea made and the
night Sam went down twice in the same corridor?

Two engineering annoyances pointed the same direction. AI-generated worlds are *vague* — "an
ancient, forgotten archive where whispers echo" could be anywhere, which means it is nobody's, and
certainly not yours. And the usual way to let a model shape a level is to let it emit code or
free-form data, which is an attack surface and a crash surface at the same time. We wanted to
prove that a world could be genuinely model-authored, deeply personal to the people who asked for
it, and still never require us to trust a single token it produced.

That is the whole product: **worlds end, your stories don't.**

---

## What it does

### The part that matters: you make the place, together

You spawn in **Stillpoint**, a walkable headquarters you share with up to three friends. You can
see each other. You take a weapon from one of four class stands — Bastion, Shade, Beacon, Weaver —
and then everyone types an idea into the terminal. One sentence. The ideas go up on the wall
*with each person's name attached*, and everyone sees everyone's on their own screen as they
arrive.

Then somebody hits **Prepare world**, and the crew watches their sentences become a place.

What comes back is not a reskin. Claude writes a **world bible** first — a premise, one collapse
with a named person and a date attached to it, three or four people, five to seven dated events,
three in-world authors with distinct voices. Then, from that bible, it writes everything a player
reads: the title, the biome names, the lines that print when you walk into a room, the world's
laws, the lore fragments lying on the floor, the boss's name and the titles of its three phases.

And then the **creation receipt** opens, and this is the moment the whole game is built around:
each contributor's name, next to the feature their words actually became. In a verified live run,
one player typed *"a signal lamp somebody wired to the handrail"* and the receipt read back:
**lantern, in "Signal Lamp Post 3."** That is their lamp. It is in the world now, and everyone at
the table can see whose it was. If an idea could not be used, the receipt says so instead of
pretending — *"recorded · not used in this world."*

You walk onto the departure gate, everyone stands on it, and the crew goes through together.

### The part you play

On the other side is a route five biomes deep — 10, 15, 20, 25 and 30 rooms — with a choice of two
next biomes at every exit, so where you go is a decision the crew makes out loud. Doors seal while
a room has hostiles. There is a minimap with fog of war and a full floor map on hold-`M`. Rooms
come in kinds: combat, elite, treasure, lore, rest, exit.

The world's **laws** are not flavour text; they are real modifiers the simulation enforces and the
HUD prints with their actual numbers. `the_many` makes enemy groups 1.8× bigger at 0.53× health.
`glass_lattice` lowers your maximum integrity outright. `long_dark` cuts your vision to 206 pixels,
so you and your friends genuinely cannot see the same room at the same time.

At the end of the route is the **Custodian** — a three-phase boss whose name, phase titles and
three moves the world chose and wrote for itself. Beat it, charge three relays, plant the Anchor,
and the world starts collapsing with you still inside it. You walk back out through rooms you have
already fought through, and you carry exactly one relic home.

When someone goes down, they are not out — a teammate stands over them and holds `F`. That
particular two seconds is the most social thing in the game, and it is also a thing the Chronicle
records by name.

### The part that survives

Back at the hub, the memory wall, the relic shelf and the Quartermaster's lines are all derived
from `GameEvent`s the authority actually emitted. Which room. Who fell. Who revived whom. What
came out with you. Nothing on that wall is invented; memories from a fixture world say they came
from a fixture; and it lives in your own browser's storage, not on our server.

The run ends. The thing you made together is still on the wall.

---

## How we built it

One TypeScript repo, one Node process, **33,564 lines across 138 source files**. Vite + React for
the DOM shell, Phaser 3.90 for the canvas, a **pure** TypeScript simulation that imports nothing
from Phaser, React, the DOM, HTTP or timers, Zod at every trust boundary, Vitest for tests.

Two subsystems carried the weight, and both of them are about doing something expensive cheaply.

### 1. The netcode: authoritative simulation, 60 Hz, no trust in the client

Multiplayer is **server-authoritative** (`src/server/network/realtime.ts`). One Node process owns
the only real simulation. It steps at a fixed **60 Hz** on an accumulator loop and broadcasts full
`GameSnapshot`s at **20 Hz** (every 50 ms), plus extra snapshots on the moments that must not lag
— phase changes, room entry, run end, identity changes. Game *events* travel on a separate,
ordered, sequence-numbered channel rather than inside the snapshot, which is what makes replay on
reconnect possible.

Clients send nothing but intent. A `PlayerIntent` is a handful of numbers and booleans
(`src/shared/contracts.ts`) flushed on a **16.67 ms** timer, and three details make it feel right:

- **Edge-triggered buttons are OR-merged** on both ends until a tick consumes them. A press that
  lands between two ticks is not lost — a real problem in a 60 Hz sim with a 20 Hz wire.
- **Intents carry a monotonic sequence number** and the server rejects replays outright, so a
  client cannot resend its way into extra attacks.
- **A 250 ms staleness cutoff on both ends.** A client that stops sending stops acting; a stale
  intent never gets applied. An idle tab does not keep swinging.

There is **no client-side prediction, no interpolation and no rollback**, and that is a deliberate
call we can defend. Prediction is where co-op action games go to die on a hackathon timeline — it
is a week of desync bugs. Instead we spent the budget on making the authoritative path cheap
enough that you do not need prediction at LAN distance. Measured end to end (`docs/QA_COOP.md`),
keypress to the other player's screen was a **~65 ms median over a real LAN IP** and 62–120 ms on
localhost. At the distance this game is designed for — a couch, a table, one venue — that is under
the threshold where it reads as lag.

The resilience work is the part we are quietest about and proudest of. Each tab holds a
**resume token in `sessionStorage`**, so reloading mid-run puts you back in *your own operative*
rather than a new one. The server holds a disconnected seat for a **30-second grace**, marks that
player as disconnected in the snapshot so their friends can see it, and on reconnect **replays
exactly the events that player missed** from their last acknowledged sequence number — flagging
`historyTruncated` honestly if they were gone long enough to roll off the 2,048-event history.
Reconnection retries five times with backoff. If the host's tab closes, **host succession** elects
the next connected member within a second and the run continues. Crew size is capped at 4 with
ghost-seat eviction; the departure gate waits for everyone to be ready and gives the host a
12-second override so one AFK friend cannot hold the run hostage.

All of this was found and fixed by *playing it*: `scripts/coop-e2e.mjs` drives two to five real
browser contexts with real keyboard and mouse input and passes 24/24 checkpoints including
reconnect, host succession, revive and a full boss fight.

### 2. World generation: ~100 rooms of world, one room on the wire

This is the piece we would most want a judge to look at.

**The model is on a tight leash, and that is what makes it fast.** Generation is a **staged
pipeline** (`src/server/generation/pipeline.ts`), not one giant prompt. Call 1 writes the bible and
the header. Then **five stages fire in parallel** — rooms, laws and look, relics, remains and
attunements — plus **four more parallel calls** producing two biome briefs each. Ten content calls
for a full floors world, under a hard **75-second wall-clock budget**, with any call-2 work still
outstanding at the deadline aborted and filled deterministically rather than allowed to stall the
crew. Flattening the first call's schema alone took the first-room median from **69.9 s to 47.3 s**.

**The model does not build levels — and this is the efficiency trick.** It writes a *brief* per
biome: motifs, enemy pool, prop pool, hazards, how linear, how branchy, how many special rooms.
A seeded Isaac-style generator (`src/shared/floorgen`) then builds the floor graph and assembles
rooms from **17 hand-made templates**. The generator is deterministic to the byte: the same
`(seed, brief, tier, roomId)` produces an identical room on any machine, in any order, tested
across 12 seeds and a 1,000-seed safety fuzz.

Which means a floors world **ships one room**. The entrance `RoomSpec`, a seed, a route graph and
eight briefs — and every one of the up to **100 rooms** (10/15/20/25/30 across five biomes) is
built lazily and cached on whichever machine needs it, *including every client*. Your friend's
laptop and the host build byte-identical rooms independently. We are not compressing the world to
send it; we are sending the recipe for it. That is what makes a 100-room co-op world feasible in
one night and on venue Wi-Fi.

**Nothing generated is ever trusted.** Every ID must exist in the closed registries in
`src/shared/registry.ts` — 8 enemies, 9 props, 16 tile characters, 8 motifs, 9 terrain features,
18 world laws, 11 boss patterns. Strings are length-capped and screened for markup, URLs and
expressions. A deterministic compiler places everything and validates each room for a reachable
spawn, reachable doors and no hazard under a spawn point, fuzzed over a thousand generated rooms.
Anything that fails Zod gets one bounded repair and then a clearly labelled fallback. The client
validates the whole thing *again* on arrival. There is no path by which generated HTML, JS, SVG, a
URL or an expression reaches a player.

**Rooms are delivered in immutable prefixes.** The world streams to the client as **NDJSON over
HTTP** (or as world messages over the WebSocket in co-op), cancellable via `AbortController`, in
growing prefixes so the crew can be standing in room 1 while the rest of the world is still being
delivered. Both ends enforce that a prefix may only *extend*: the server refuses to publish a
world that changes an already-committed room, and the client's `parseWorldPrefix` requires
committed rooms to be byte-identical and the world identity and provenance unchanged. A world you
have already walked into cannot be rewritten underneath you.

### 3. Making the writing not sound like a machine

`docs/WRITING.md` is a house style researched from Souls, Hades, Dead Cells, Caves of Qud,
NetHack, D&D boxed text and Magic flavour text, plus the published AI-slop word catalogues: every
sentence needs a physical noun and a checkable fact, names come only from the bible, no mood
vocabulary, no "not X but Y", no closing morals. `src/shared/prose.ts` is a **linter that runs both
in the test suite** — over every static UI string in the product — **and inside the live repair
loop**, where a failing line goes back to the model with only that line and the rule it broke, and
the replacement is kept only if it strictly improves the score.

### 4. Offline is a first-class path, not a panic button

Three hand-authored fixture worlds, plus an **offline composer** (`src/server/composer/`) that
builds a valid world out of the crew's actual ideas with **no model call at all** — sixteen
themes, the players' own words in the title and room names, one or two real laws, eight biome
briefs. It is labelled `COMPOSED`, never `LIVE`, and it is what a failed or unconfigured live call
falls back to, so nobody's ideas ever get silently replaced by a canned fixture.

The provenance badge reads `LIVE · claude-sonnet-4-6`, `OFFLINE FIXTURE`, `FALLBACK FIXTURE (live
attempt failed)` or `COMPOSED · relay-composer`. It cannot say anything else, it is mounted
outside the run branch so it is always on screen, and it never lies about which one happened.

### 5. How the team built it

One repo, one night, and each of us drove a coding agent — Claude Code, Devin and Cursor, with
Codex on the first generation slice. `AGENTS.md` is the contract that made that survivable: each
agent owns disjoint paths, one agent owns the shared contracts and root config, changes to anyone
else's territory go through an `[integration]` request, and `npm run check` — typecheck, full test
suite, production build — must be green before anything merges to `main`. 423 commits, 336 of them
in one fourteen-hour window, 21 PRs, about twenty-five Claude Code agents and fourteen Devin
sessions in their own worktrees.

**Verification is a build artifact here.** `npm run check` runs **1,075+ tests across 88+ files**.
On top of that, three harnesses — `scripts/solo-e2e.mjs`, `scripts/coop-e2e.mjs`,
`scripts/shot.mjs` — drive the real game with **real keyboard and mouse input only**, reading
state read-only from the DOM. Nothing is injected and there are no test hooks in the app.
`docs/QA.md` then records, box by box, what was *observed* in a browser, what is *unit-tested
only*, and what is *unverified* and why.

Measured, not estimated (`docs/design/WORLDGEN_EVAL.md`, `docs/QA.md`, `docs/QA_COOP.md`): 8 of 8
live worlds passed the prose linter with zero hard failures; first room at **p50 47.3 s**, max
49.9 s; ~56k input and ~10k output tokens at about **$0.31 per world**; two live worlds driven end
to end in a browser at 49.2 s and 51.2 s to portal-ready with the contributor's idea attributed to
a real feature; co-op input latency ~65 ms median over a LAN IP; 24/24 co-op checkpoints across
two to five browsers; twelve of twelve class × fixture survivability cells survived.

---

## Individual Contributions

One repo, and each of us pointed a different coding agent at a different part of the system.
`AGENTS.md` defined who owned which paths; `docs/evidence/` and `docs/handoffs/` record what each
tool actually did, commit by commit.

**Jeffrey Li (`Phronesis618`) — Agent A / Cursor, integration owner.** Owned the shared contracts,
the pure simulation, the client controller and transport layer, the server assembly, the WebSocket
realtime layer, CI and deployment, and was the merge backstop for everyone else. Built the offline
composer (`src/server/composer/` — sixteen themes, keyword selection, players' words echoed into
the world, laws in each theme's voice, eight floors briefs), the operator generation transport,
the generation overlay and reveal card, party frames and the start screen, and the world-dressing
layer that makes each motif build the room differently instead of just tinting it. Also did the
unglamorous half of integration: retiring his own interim world-rules and skill-tree systems when
the team's versions landed, rather than stacking two modifier layers.

**Jonathan He (`jonapplehe`) — Agent B then Agent C, driving Devin.** Wrote the original
deterministic `WorldRecipe` compiler by hand, then ran the Devin sessions that produced the live
generation provider, the Claude/OpenAI provider switch, the Chronicle, the hub, the Render
blueprint, and most of the browser QA. A lot of the night's real bug finds are his: the debrief
showing the Guardian room as the "first arrival" thumbnail, held primary attacks only firing once,
hub memories from two worlds collapsing into one run, co-op reload duplicating the crew, stranded
runs not counting the world they saved.

**Charles Zhang (`Charles1729`).** Skill tree, audio, new enemies and attack patterns, lore, and
two passes on the right-side HUD.

**`4dalols`.** Review and merge of the Devin PR train (#5, #6, #7, #8, #10, #14, #15, #17) and the
Anthropic provider configuration.

**The Claude Code orchestrator (`curious-droid`, 275 commits)** — *[name the human who ran this]* —
ran the overnight build: the floors generator and route graph, the world-laws harness, the
terrain and tiles pass, the Custodian and the collapse finale, the writing pipeline and prose
linter, the onboarding system, the co-op and solo e2e harnesses, and the design docs under
`docs/design/`. Five review gates, where a separate model reviewed a branch before it reached
`main`, caught a 3× terrain-damage multiplier, a lost first-victory memory, an escape-route trap
and a production debug handle that should not have shipped.

Everything an agent wrote was read, reviewed and merged by a human, and every human wrote the
briefs their agent worked from.

---

## Challenges we ran into

**Co-op without prediction had to be fast enough to not need it.** The honest constraint was that
rollback netcode is a week we did not have, and a half-finished prediction layer is worse than
none. So the challenge became making the authoritative round trip cheap: a 60 Hz sim with a 20 Hz
snapshot cadence, intents flushed every 16.67 ms, edge-triggered buttons OR-merged so a press
between ticks survives, a 250 ms staleness cutoff on both ends. It landed at ~65 ms median over a
LAN IP, which is playable. The thing that made this *hard* to get right was not the happy path —
it was reload, disconnect and host migration, which we only got correct because we had two real
browsers playing the game and reloading tabs mid-run.

**Sending a hundred rooms is not an option, so we sent a seed.** The naive version of a five-biome
co-op roguelike ships every `RoomSpec` to every client and dies on the wire. Making the floor
generator deterministic to the byte — same room from the same `(seed, brief, tier, roomId)` on any
machine in any order — is what let us ship the entrance room plus a seed, a route and eight briefs
and have every client build the other ~99 rooms itself. Getting determinism *actually* true, as
opposed to true-looking, meant order-independence and per-room caching, and it is pinned by tests
across 12 seeds plus a 1,000-seed safety fuzz.

**Latency in front of a judge.** The first version took 69.9 s to a playable first room, which is
dead air. Flattening the first call's schema got it to a 47 s median; splitting the remainder into
nine parallel staged calls under a hard 75 s budget kept it there; and delivering rooms as
immutable growing prefixes means the crew can be *standing in room 1* while the rest arrives.

**Making the model's prose not sound like a model.** Our first worlds were fluent and completely
weightless — the exact "ancient, forgotten archive" problem we set out to solve. The fix was a
researched house style, a linter enforcing it in tests *and* in the live repair loop, and a
bible-first prompt so the model has a named person and a date before it writes a player-facing
line. We measured it: mean lint score **2.4** for live worlds against **18.0** for our own
hand-written fixtures. Then an outside reader blind-labelled twenty lines, ten ours and ten from
shipped games; the first reader caught 1 of our 10, a stricter second reader caught 7 of 10 and
also flagged a real Dark Souls line as AI. Two readers at n=10, not a before/after study, and
`docs/design/BLIND_READ.md` says exactly that.

**Truncation was silently eating the writing** — 56 of 64 taglines were over the schema limit and
being cut mid-sentence. We replaced truncation with regeneration and put the character budget into
the repair feedback.

**Several coding agents in one repository.** The ownership table in `AGENTS.md` is what made it
possible and it still was not free: merge conflicts in files two agents both touched, one agent
"fixing" a leaked-name bug that turned out to be the seeded name pool working correctly (checked,
then reverted), two agents independently implementing the same readiness callback. Agents are also
confidently wrong in a specific way — they write "verified" next to something they only
unit-tested. The rule we enforced hardest was *that number is not measured, go measure it.*

**Proving the ending actually plays.** A full route is five biomes and up to 100 rooms, and no
scripted bot had the patience or survivability to walk it in budget. We added a dev-only deep link
that positions a run at the final biome using the world's *own* route edges, and played the ending
from there with real input — thirteen runs through the Custodian, the relay ritual, the collapse
escape, the relic choice and the hub. One of thirteen got out alive. That is honest evidence of
the code path and honest evidence that difficulty is untuned, and `docs/QA.md` is careful about
which is which: the deep link gives the crew no attunements, no upgrades and uncleared rooms to
retreat through, so it is *harder* than the real game, not easier.

---

## Accomplishments that we're proud of

**We built the thing we actually wanted, which is a place that belongs to your table.** A judge
types one sentence, and fifty seconds later there is a receipt with their words next to a lantern
in a room named after it, and then they walk into the room and the lantern is there. Watching
someone realise the world is *theirs* is a different reaction than watching someone evaluate a
demo, and it is the reason the receipt comes before the gate instead of after the run.

**A hundred-room co-op world that ships as one room and a seed.** Byte-identical deterministic
floor generation across machines is the single most load-bearing technical decision in the
project: it is what makes five biomes feasible over a network, and it is pinned by tests rather
than asserted.

**Server-authoritative co-op that survives reality.** Reload mid-run and you are still your own
operative. Disconnect and your seat is held 30 seconds while your friends see you greyed out.
Come back and the server replays exactly the events you missed. The host closes their laptop and
someone else becomes host within a second. 24/24 checkpoints, driven by real browsers pressing
real keys.

**A model authored the world and never got to touch the code.** Not "we sanitized the output" —
structurally, the model's entire influence is a JSON object of registry IDs and length-capped
strings, compiled by trusted code, validated twice. Prompt injection was one of our eight
evaluation idea sets: the instruction was ignored and only its noun (a lighthouse) reached the
world.

**Ten parallel staged calls, 47-second median to a playable first room, $0.31 a world.** Fast
enough that nobody at the table stops talking while it works.

**The honesty rules held under demo pressure.** A fixture has never been shown as live. Memories
derive only from real events. `docs/QA.md` has unticked boxes in it on purpose, hours before
judging — including "is the escape fair for a human? unmeasured."

**The QA harnesses are real.** Two to five browsers actually playing, no injected state, no test
hooks in the app. They found bugs unit tests structurally could not: a thumbnail capturing the
wrong room, an attack that did not repeat when held, a crew that duplicated itself on reload.

---

## What we learned

**The personal part has to be mechanical, not decorative.** Our first instinct was to show
contributors' names in a nice list somewhere. It meant nothing. What means something is the
receipt line that says *this sentence became that lantern in that room*, because it is a claim the
game can be wrong about — and therefore a claim that lands when it is right. Attribution is only
moving when it is falsifiable.

**Determinism buys you more than correctness.** We made the floor generator deterministic for
testability and discovered it had rewritten our networking problem: if every machine builds the
same room from the same seed, you stop shipping worlds and start shipping recipes.

**Not building prediction was the right call, and knowing why matters.** The question is not "is
authoritative-only worse" — it is "worse by how much, at what distance, measured how." 65 ms over
a LAN IP answered it. We would have spent three days on rollback to fix a problem we did not have.

**Constrain the model's output space, not its creativity.** Closed ID registries plus a strict
schema did not make worlds blander; it moved the model's effort off structure it gets wrong and
onto text it gets right. Forced tool use with a *flat* schema returned the bible's eight fields
first time in 11 of 11 worlds. The nested version did not.

**Ownership is the multi-agent primitive.** Not orchestration, not prompts — a table of disjoint
owned paths, one owner for shared contracts, and a green `npm run check` as the merge gate.
Several agents in one repo collided surprisingly rarely because most of the time they were not
touching the same files.

**Agents report implementation as verification unless you force them to separate the two.**
Splitting every claim into *implemented / mocked / unverified* in every handoff changed what got
built, because "unverified" is uncomfortable to write and people go make it verified.

**Real input beats injected state.** Every genuinely surprising bug this weekend came from a
browser actually pressing a key, not from a test calling a function.

---

## What's next for our project

**Let each person's idea own a specific place.** Right now the receipt maps a contribution to a
feature, but in floors mode it still maps to the legacy room slots rather than to the biome the
idea actually shaped. Closing that gap is the single biggest upgrade to the thing the game is
about: walking into the *third* biome and having it be recognisably the one your friend asked for.

**The relic should seed the next world.** The proposal we most want to build: each contributor can
trigger their own idea once per run as an in-world artefact, and the relic you carry out becomes a
prompt for the next world. That turns a night of runs into a continuous shared history instead of
a set of disconnected ones — the premise made playable, and the loop nobody can copy without this
pipeline.

**Tune the ending with real players.** A solo Custodian win sits at about 53%; a measured
constants-only preset (`docs/TUNING_DEMO_PRESET.md`) lifts it to 78% without making it trivial.
Every knob is in one dependency-free file, `src/sim/tuning.ts`, with a documented safe range. It
needs human playtests, not another bot run.

**Make the rest of the laws real.** Nine of eighteen world laws are enforced by the simulation;
the unimplemented ones can never be offered to the model or shown to a player, but they should be
implemented rather than fenced off.

**Push the netcode outward.** Everything is tuned for LAN distance. Interest management on
snapshots and a modest interpolation layer would open it up to friends who are not in the same
room — which is, in the end, most people's friends.

**Verify what is still unverified.** Two physical laptops on real Wi-Fi, four players in an actual
run rather than just the lobby, a live OpenAI call, a proper before/after blind read with one
reader at n well above 10, and a redeploy of the hosted service from current `main`.

**Beyond the hackathon:** more classes and enemy behaviours, secret rooms, the items and economy
systems that exist today only as design docs, and voice — deliberately cut on night one, and the
obvious next step for a game whose best moment is four people arguing about which door to take.
