# RELAY — submission answers (paste-ready)

Short enough for a submission form. Every figure points at a file in this repo. Track:
**Entertainment**. Repo: https://github.com/Phronesis618/HackMIT2026

Two things need a human before this is pasted: **(1)** the `curious-droid` account committed 275
of the 423 commits as the Claude Code orchestrator — put the right name in below. **(2)** Team
size is ambiguous in the repo (five committing human identities, but `docs/TEAM_PLAN.md` says
three), so the text avoids stating a number. Say the real one.

The long version of every answer below — with full netcode internals, the generation pipeline
stage by stage, and the measurement tables — is preserved in git history at commit `ed1e1ae`.

---

## Elevator pitch / short description

**RELAY — Worlds end. Your stories don't.**

A co-op roguelike where you and your friends build the world before you fight through it. Each of
you types one sentence in a shared headquarters; fifty seconds later Claude has written that world
— its history, five biomes, the physical laws that bend the fight, the boss and its three phases —
and a receipt shows your friend's name next to the thing their words became. Then you go in
together. What happens in there comes home as memories on the headquarters wall: who fell, who
picked them up, what you carried out. The model never writes a line of code — it fills a strict
schema and picks IDs from closed registries, and our code builds the rooms.

---

## Inspiration

Everyone has had the good version of this at a table: someone says "what if the library is
underwater and the books are still talking," everyone leans in, and for the next three hours
that's where you all live. No game does that. You get a level designer's world or procedural
noise, and either way you and your friends are tourists in it — the most personal thing
multiplayer usually offers you is a lobby.

So: what if the place you explore together is the place you came up with together — not a mod or
a weekend in a level editor, but one sentence each, typed thirty seconds before you walk in? And
what if the run left something behind, so a month later the hub still shows the world your
friend's idea made?

Two engineering annoyances pointed the same way. AI-generated worlds are *vague* — "an ancient,
forgotten archive where whispers echo" could be anywhere, which means it's nobody's. And the usual
way to let a model shape a level is to let it emit code or free-form data, which is an attack
surface and a crash surface at once. We wanted a world that is genuinely model-authored, specific
to the people who asked for it, and never trusted for a single token it produced.

---

## What it does

You spawn in a walkable headquarters you share with up to three friends. You take a weapon from
one of four class stands, and everyone types an idea — one sentence. The ideas go up on the wall
with each person's name on them, visible on everyone's screen.

Someone hits **Prepare world**, and the crew watches their sentences become a place. Claude writes
a world bible first — a premise, one collapse with a named person and a date, three or four
people, dated events, three in-world authors — then writes everything you read: the title, biome
names, room lines, the world's laws, the lore on the floor, the boss's name and phase titles.

Then the **creation receipt** opens, and this is the moment the game is built around: each
contributor's name beside the feature their words became. In a verified live run, someone typed
*"a signal lamp somebody wired to the handrail"* and the receipt read back **lantern, in "Signal
Lamp Post 3."** That's their lamp, and it's in the world now. If an idea couldn't be used, the
receipt says so rather than pretending.

You all stand on the departure gate and go through together. Beyond it: five biomes deep —
10/15/20/25/30 rooms — with a choice of two next biomes at every exit, doors that seal while a
room has hostiles, fog-of-war minimap, and rooms that come in kinds (combat, elite, treasure,
lore, rest, exit). The world's **laws** are real modifiers the simulation enforces and the HUD
prints with actual numbers — `the_many` makes enemy groups 1.8× bigger at 0.53× health;
`long_dark` cuts vision to 206 px, so you and your friends genuinely can't see the same room.

At the end waits the **Custodian**, a three-phase boss the world named and chose the moves for.
Beat it, charge three relays, plant the Anchor — and the world starts collapsing with you still
inside. You walk back out and carry exactly one relic home. When someone goes down they aren't
out: a teammate stands over them and holds `F`.

Back at the hub, the memory wall, relic shelf and Quartermaster lines are derived only from game
events that actually happened. Nothing there is invented, and it lives in your browser, not on our
server. The run ends; the thing you made together is still on the wall.

---

## How we built it

One TypeScript repo, one Node process, 33,564 lines across 138 source files. Vite + React for the
shell, Phaser for the canvas, a **pure** simulation importing nothing from Phaser/React/DOM/HTTP,
Zod at every trust boundary. Two subsystems carried the weight, and both are about doing something
expensive cheaply.

**Netcode.** Multiplayer is server-authoritative: one process owns the only real simulation,
stepping at a fixed **60 Hz** and broadcasting full snapshots at **20 Hz**, with game events on a
separate ordered, sequence-numbered channel. Clients send nothing but intent, flushed every
16.67 ms, with edge-triggered buttons OR-merged on both ends so a press landing between ticks
isn't lost, monotonic sequence numbers rejecting replays, and a 250 ms staleness cutoff so an idle
tab stops acting. There is **no prediction, interpolation or rollback** — a deliberate call.
Rollback is a week we didn't have, so we spent the budget making the authoritative path cheap
enough not to need it: measured **~65 ms median keypress-to-other-screen over a LAN IP**. Reload
mid-run and a resume token puts you back in *your own* operative; the server holds a disconnected
seat 30 seconds, shows your friends you're offline, and replays exactly the events you missed. If
the host's tab closes, host succession elects a new one within a second.

**World generation — 100 rooms of world, one room on the wire.** Generation is a staged pipeline,
not one giant prompt: call 1 writes the bible, then **five stages fire in parallel** (rooms, laws
and look, relics, remains, attunements) plus four more producing biome briefs — ten calls under a
hard 75-second budget. Flattening call 1's schema alone took first-room median from **69.9 s to
47.3 s**.

The model doesn't build levels. It writes a *brief* per biome — motifs, enemy pool, hazards, how
linear, how branchy — and a seeded Isaac-style generator assembles rooms from 17 hand-made
templates, **deterministic to the byte**: the same `(seed, brief, tier, roomId)` yields an
identical room on any machine, in any order. So a five-biome world **ships one room** — the
entrance, plus a seed, a route and eight briefs — and every client builds the other ~99 rooms
itself. We don't compress the world to send it; we send the recipe.

**Nothing generated is trusted.** Every ID must exist in closed registries (8 enemies, 9 props,
16 tiles, 18 laws, 11 boss patterns); strings are length-capped and screened for markup, URLs and
expressions; a deterministic compiler validates every room for reachable spawn and doors, fuzzed
over 1,000 rooms; the client validates again on arrival. Rooms arrive as immutable growing
prefixes — a world you've walked into can't be rewritten underneath you. A prose linter built from
a researched house style runs in the test suite *and* in the live repair loop, sending a failing
line back with only the rule it broke.

**The team.** Each of us drove a coding agent — Claude Code, Devin, Cursor, with Codex on the
first generation slice. `AGENTS.md` made it survivable: disjoint owned paths per agent, one owner
for shared contracts, and a green `npm run check` before any merge. 423 commits, 336 in one
fourteen-hour window.

**Measured, not estimated:** 1,075+ tests across 88 files; first room p50 **47.3 s** at ~**$0.31 a
world**; 8/8 live worlds passed the prose linter with zero hard failures; two live worlds played
end to end in a browser at 49.2 s and 51.2 s to portal-ready; 24/24 co-op checkpoints driven by
two-to-five real browsers pressing real keys. `docs/QA.md` records box by box what was *observed*,
what is *unit-tested only*, and what is *unverified*.

---

## Individual Contributions

Each of us pointed a different coding agent at a different part of the system; `AGENTS.md` defined
who owned which paths, and `docs/evidence/` records what each tool actually did.

- **Jeffrey Li (`Phronesis618`) — Agent A / Cursor, integration owner.** Shared contracts, the
  pure simulation, client controller and transport, server assembly, the WebSocket realtime layer,
  CI and deploy, and merge backstop for everyone else. Built the offline composer, the operator
  generation transport, the generation overlay and reveal card, party frames, and the world
  dressing layer.
- **Jonathan He (`jonapplehe`) — Agent B then C, driving Devin.** Wrote the original deterministic
  world-recipe compiler by hand, then ran the Devin sessions behind the live generation provider,
  the Claude/OpenAI switch, the Chronicle, the hub, the Render blueprint and most browser QA — and
  found a lot of the night's real bugs by playing it.
- **Charles Zhang (`Charles1729`).** Skill tree, audio, new enemies and attack patterns, lore, and
  two passes on the right-side HUD.
- **`4dalols`.** Review and merge of the Devin PR train, and the Anthropic provider config.
- **The Claude Code orchestrator (`curious-droid`, 275 commits)** — *[name the human who ran
  this]* — the overnight build: floors generator and route graph, world laws, terrain, the
  Custodian and collapse finale, the writing pipeline and prose linter, onboarding, and the e2e
  harnesses.

Everything an agent wrote was read, reviewed and merged by a human, and every human wrote the
briefs their agent worked from.

---

## Challenges we ran into

**Co-op without prediction had to be fast enough not to need it.** Rollback netcode is a week we
didn't have, and a half-finished prediction layer is worse than none — so the work went into
making the authoritative round trip cheap. The genuinely hard part wasn't the happy path; it was
reload, disconnect and host migration, which we only got right because two real browsers were
playing and reloading tabs mid-run.

**Sending a hundred rooms isn't an option, so we sent a seed.** Making the floor generator
deterministic to the byte — same room from the same seed on any machine, in any order — is what
let a five-biome world ship as one room plus a recipe. Getting determinism *actually* true rather
than true-looking meant order-independence and per-room caching, pinned by tests across 12 seeds
and a 1,000-seed fuzz.

**Latency in front of a judge.** The first version took 69.9 s to a playable room, which is dead
air. Schema flattening plus nine parallel staged calls under a hard budget got it to 47 s.

**Making the prose not sound like a model.** Our first worlds were fluent and weightless — exactly
the problem we set out to solve. A researched house style, a linter enforcing it in tests *and* in
the live repair loop, and a bible-first prompt so the model has a named person and a date before
it writes anything. Mean lint score **2.4** for live worlds vs **18.0** for our own hand-written
fixtures. An outside reader blind-labelled 20 lines, 10 ours and 10 from shipped games; the first
reader caught 1 of our 10, a stricter second caught 7 of 10 and also flagged a real Dark Souls
line as AI. Two readers at n=10, not a before/after — and we say so.

**Several agents in one repo.** Merge conflicts in shared files, one agent "fixing" a bug that was
the seeded name pool working correctly, two agents implementing the same callback. Agents are also
confidently wrong in one specific way: they write "verified" next to things they only unit-tested.
The rule we enforced hardest was *that number is not measured, go measure it.*

---

## Accomplishments that we're proud of

- **We built the thing we wanted: a place that belongs to your table.** A judge types one sentence
  and fifty seconds later there's a receipt with their words next to a lantern in a room named
  after it — and then they walk in and the lantern is there.
- **A hundred-room co-op world that ships as one room and a seed.** Byte-identical deterministic
  floor generation is the most load-bearing decision in the project, and it's pinned by tests
  rather than asserted.
- **Server-authoritative co-op that survives reality.** Reload and you're still your own operative;
  disconnect and your seat is held while your friends see you greyed out; the host closes their
  laptop and someone else takes over in a second. 24/24 checkpoints, driven by real browsers.
- **A model authored the world and never got to touch the code.** Its entire influence is a JSON
  object of registry IDs and capped strings, compiled by trusted code, validated twice. Prompt
  injection was one of our eight eval idea sets: the instruction was ignored and only its noun
  (a lighthouse) reached the world.
- **The honesty rules held under demo pressure.** A fixture has never been shown as live; memories
  derive only from real events; `docs/QA.md` still has unticked boxes in it on purpose.

---

## What we learned

- **The personal part has to be mechanical, not decorative.** Showing contributors' names in a
  list meant nothing. The receipt line saying *this sentence became that lantern in that room*
  means something, because it's a claim the game can be wrong about. Attribution only lands when
  it's falsifiable.
- **Determinism buys more than correctness.** We made the generator deterministic for testability
  and found it had rewritten our networking problem: if every machine builds the same room from
  the same seed, you stop shipping worlds and start shipping recipes.
- **Not building prediction was right, and knowing why matters.** The question isn't "is
  authoritative-only worse" but "worse by how much, at what distance, measured how." 65 ms over a
  LAN answered it; we'd have spent three days fixing a problem we didn't have.
- **Constrain the model's output space, not its creativity.** Closed registries and a strict schema
  didn't make worlds blander — they moved the model's effort off structure it gets wrong and onto
  text it gets right. Forced tool use with a *flat* schema returned the bible's eight fields first
  time in 11 of 11 worlds; the nested version didn't.
- **Ownership is the multi-agent primitive** — disjoint owned paths, one owner for shared
  contracts, a green check as the merge gate. And **real input beats injected state**: every
  genuinely surprising bug came from a browser actually pressing a key.

---

## What's next for our project

- **Let each person's idea own a specific place.** The receipt maps a contribution to a feature,
  but in floors mode it still maps to legacy room slots rather than the biome the idea shaped.
  Closing that means walking into the third biome and recognising it as the one your friend asked
  for — the single biggest upgrade to what this game is about.
- **The relic should seed the next world.** Each contributor triggers their own idea once per run
  as an in-world artefact, and the relic you carry out becomes a prompt for the next world. That
  turns a night of runs into one continuous shared history.
- **Tune the ending with real players.** A solo boss win sits at ~53%; a measured constants-only
  preset lifts it to 78% without making it trivial. Every knob is in one file with a documented
  safe range. It needs playtests, not another bot run.
- **Push the netcode outward.** Everything is tuned for LAN distance; interest management and a
  modest interpolation layer would open it to friends who aren't in the same room.
- **Finish the verification list:** two physical laptops on real Wi-Fi, four players in an actual
  run rather than just the lobby, a live OpenAI call, and a proper before/after blind read.
- **Beyond the hackathon:** more classes and enemy behaviours, secret rooms, the items and economy
  systems that exist today only as design docs, and voice — cut on night one, and the obvious next
  step for a game whose best moment is four people arguing about which door to take.
