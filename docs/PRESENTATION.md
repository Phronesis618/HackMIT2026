# RELAY presentation guide

> **Status at 08:45 ET Sunday (added by the overnight orchestrator after this guide was written).** main `overnight-v1` tag, 1,080 tests green. Floors + world laws are still **off by default** (`RELAY_FLOORS=1 RELAY_LAWS=1`, clients follow the server; or `?floors=1&laws=1`). Since this guide was written: the floors ENDING has been played in a browser from the final biome (`docs/QA_FULLRUN.md`: Custodian → ritual → collapse escape → carry one relic → hub; 13 runs, no crash, softlock or console error); live generation was observed end to end in the browser (49 s and 51 s to portal-ready, honest LIVE label); audio cues, the production bundle and a legacy solo run were checked. The risk with floors is **difficulty, not stability**: most bot runs died to the final Custodian, and one died in room 2 of Crystal Tide — tune `src/sim/tuning.ts` or demo biome 1 only. The **Render service serves a stale build** from before the flags existed: redeploy from main or use a laptop server / GitHub Pages. Everything else below still holds.


Written 20 Sept 2026 against `main` at `7a279d2`. Every claim about the game below points at a
file in this repo; every claim about HackMIT points at a URL or is marked **UNCONFIRMED**.
Scale of the night: `git log --since='14 hours ago' --oneline | wc -l` = **336 commits**
(218 by the Claude Code account, 67 by Jonathan, 21 by Devin, the rest by the team).

Contents: [1 Judging](#1-judging-what-we-could-confirm) · [2 The pitch](#2-the-pitch) ·
[3 Demo runbook](#3-demo-runbook) · [4 Judge Q&A](#4-judge-qa) · [5 Don't-miss checklist](#5-dont-miss-checklist)

If you read one thing: **section 3.4 (pre-demo checklist) and 3.5 (fallback ladder)**.

---

## 1 Judging: what we could confirm

Researched from a sandbox that could not open `hackmit.org`, `dayof.hackmit.org` or
`plume.hackmit.org` directly; everything here comes from search-engine snippets of those pages
and from prior years. **Check `dayof.hackmit.org` on the venue Wi-Fi first thing** and correct
this table; it is the one source that matters today.

### 1.1 Event and format

| Fact | Status | Source |
| --- | --- | --- |
| HackMIT 2026 is 19–20 Sept 2026, MIT campus, 1,000+ undergraduates | confirmed | https://plume.hackmit.org/ ("HackMIT 2026: Sep 19th-20th"), https://hackmit.org/ |
| Submission platform is Plume (HackMIT's own), not Devpost | likely; **UNCONFIRMED for 2026** | https://plume.hackmit.org/ hosts the 2025 and 2026 galleries; Devpost was used through 2023 (https://hack-mit-2023.devpost.com/) |
| Hacking ends around 11:45 Sunday; closing ceremony 18:00 in Kresge | 2025 figures; **UNCONFIRMED for 2026** | https://dayof.hackmit.org/ (2025 snapshot) |
| Judging format: science-fair expo, small groups of judges per table, a few minutes each, then a top cut presents to a panel | confirmed for past years; **UNCONFIRMED for 2026** | http://techx.io/hackmit-dayof/prizes ("present their projects for a few minutes at a time to small groups of judges in a science-fair format"); https://anishathalye.com/implementing-a-scalable-judging-system/ (Gavel pairwise judging, 90-minute expo, top 10 to a panel, 5-minute pitch + questions) |
| 2024 observer's account: round-1 judges spent about **10 minutes per table**; finalists got **up to 8 minutes + 2 minutes of questions** | one attendee's notes; **UNCONFIRMED for 2026** | https://sigagent.ai/ai/programming/tech/reviews/hack-mit/ |
| Pairwise judging (Gavel): each judge decides whether your project is better or worse than the one they saw immediately before | confirmed for past years | https://medium.com/hackmit-stories/gavel-an-expo-judging-system-a70d676712f3 |

What Gavel means for us: a judge arrives having just seen another project. The first 20 seconds
decide the comparison. Lead with the live thing (a world being written from the judge's own
words), not with the architecture.

### 1.2 Criteria

No 2026 rubric was found. The two most recent published forms:

| Year | Criteria | Source |
| --- | --- | --- |
| 2023 (Devpost) | Originality, Innovation & Impact 33% · Technology 33% · Learning & Collaboration 33% | https://hack-mit-2023.devpost.com/ |
| 2024 (attendee notes) | Innovation 30% · Technical Complexity 30% · Impact 30% · Learning & Collaboration 10%. Judges asked: did the demo work end to end, was there a real UI, did all members contribute | https://sigagent.ai/ai/programming/tech/reviews/hack-mit/ |

**2026 rubric: UNCONFIRMED.** Assume something like the above and cover all four: novelty
(the closed-registry world bible), technical depth (server-authoritative co-op, validated
generation, prose linter), impact (the honesty rules are the point, not a footnote), and
collaboration (three humans, three agents, one repo, 336 commits).

### 1.3 Entertainment track

The track exists in 2025 (Healthcare, Sustainability, Education, Entertainment:
https://archive.hackmit.org/2025/). The 2022 description, the last one a snippet returned in
full: "promotes the use of technology as a means of expression, encouraging hackers to explore
the ways that we create, consume, and share content … incorporating music, graphics, and other
creative mediums, as well as keeping the user at the forefront of design"
(https://archive.hackmit.org/2022/). Its prompts include "How can entertainment be used to
share a message?" and "How can we collaborate with non-technical hackers?" One track per
project; top project in the track wins the track prize (2024 rules, https://archive.hackmit.org/2024/).
**Whether Entertainment is a 2026 track: UNCONFIRMED** (README and PRODUCT.md assume it).

What to say to a track judge: the world is content three people made together in 30 seconds
of typing, and the memories are content the run made. Both are "create, consume, and share".

### 1.4 Sponsor and special prizes

Nothing for 2026 could be read. From 2025 (https://plume.hackmit.org/project/zhrtm-qodvf-vkiiy-gcpwo
lists a project's sponsor challenges; LinkedIn posts name winners):

| Prize (2025) | What it asked for (as far as known) | Our fit | 2026 status |
| --- | --- | --- | --- |
| **Anthropic: Best Use of Claude** | Projects built with Claude / Claude Code; 145 teams entered in 2025 (https://www.linkedin.com/posts/the-team-next-gen_join-the-claude-builders-club-activity-7379937562494230528-3U8U) | Strong. Runtime: `claude-sonnet-4-6` writes every world through a forced tool call (`src/server/generation/liveService.ts`). Build: Claude Code authored the majority of the night's commits. Say both, separately. | **UNCONFIRMED** |
| Warp: Best Financial Visualization Agent | Finance-specific | None | n/a |
| Windsurf Challenge, Rox Challenge | Unknown | Unknown | **UNCONFIRMED** |
| Modal sponsor track | Deployment on Modal | We deploy on Render; no fit unless redeployed | **UNCONFIRMED** |

"Best game", "best design", "best use of AI agents / dev tools": **no such HackMIT prize was
found for any year. UNCONFIRMED.** Do not put these on the slide. Read the challenge list on
Plume or dayof before submitting and enter every challenge whose sponsor's tool we actually
used (Anthropic is the only certain one; Devin is a Cognition product and Cursor was used, but
neither is known to be a 2026 sponsor).

---

## 2 The pitch

Three speakers: **S1** (product, hook and close), **S2** (drives the demo laptop), **S3**
(technical explanation, how it was built). Total 6:30, leaving time inside a 7-minute slot for
one question. Times are cumulative.

### 2.1 The 5–7 minute version

**0:00 Hook (S1, 15 s).** One sentence, said to the judge before anything is on screen:

> "You type one sentence; a Claude-written world you can fight through is ready in under a
> minute; and the game never lets the model touch a line of code."

If the judge repeats one thing to the panel, it should be "the model never writes code".

**0:15 The problem (S1, 45 s).**
AI content in games has two failures. It is vague: "an ancient, forgotten archive where
whispers echo", which could be any world, so it is nobody's. And it is unsafe: the easy way to
let a model shape a level is to let it emit code or free-form data, which is an attack surface
and a crash surface. Co-op has a third failure: the run ends and nothing of it survives except
a score. RELAY answers the three with one design.

**1:00 Live demo (S2 drives, S1 narrates, 2:30).** The exact clicks are in section 3.1. Beats,
in order, and what to say at each:

1. Hub. "This is headquarters. Walk to a stand, F takes a weapon." (10 s)
2. Ask the judge for a world idea. Type it verbatim. Type a second one yourselves. "Both ideas
   go on the wall with names on them." (20 s)
3. Prepare world. Point at the badge while it works: "It will say LIVE with the model name, or
   FIXTURE if it fell back. It cannot say anything else." (wait: 45–50 s live, section 3.5 if
   longer; fill the wait with the receipt from a previous prepared world if one is on screen,
   or with beat 4's explanation)
4. Receipt. Read the judge's name beside the feature their words became. (15 s)
5. Gate, first room, first fight. Let the onboarding prompts show. (30 s)
6. Hold M. "Ten rooms this biome; fog of war; five biomes deep." Clear to the exit if time
   allows, show the two doors and the biome cards. (30 s)
7. Back to the hub in the second browser or after the run: the memory wall and the
   Quartermaster line, both derived from events that just happened. (20 s)

**3:30 How it works in 60 seconds (S3).**
Players' ideas go to the server. Claude, through a tool call with a strict JSON schema, writes
a **world bible** first: premise, one collapse with a person and a date, 3–4 people, 5–7 dated
events, three in-world authors (`docs/WRITING.md` §2). Then, from that bible, it writes the
player-facing text and **chooses**, never invents: biome briefs, world laws, the look and the
boss's three moves are all picked by id from **closed registries** in `src/shared/registry.ts`,
`src/sim/laws.ts` and `src/shared/custodian.ts`. Trusted code then builds five biomes of
10/15/20/25/30 rooms from those briefs with a seeded floor-plan generator
(`src/shared/floorgen`, Isaac's algorithm, 17 hand-made room templates). Every room is
validated: reachable spawn, reachable doors, no hazard on a spawn. The model **never writes
code, HTML, URLs or geometry**; anything that fails the Zod schema is repaired once or dropped
for a labelled fallback, and the badge says LIVE, OFFLINE FIXTURE or FALLBACK FIXTURE. Every
sentence goes through a **prose linter** (`src/shared/prose.ts`) built from a researched house
style: banned mood words, "not X but Y", trailing -ing clauses, no sentence without a noun from
the bible. Failures go back to the model with only the failing line and the rule. Measured on
8 worlds (`docs/design/WORLDGEN_EVAL.md`): **8 of 8 live, 0 hard fails after repair, first
room in 47 s median (max 50 s), mean lint score 2.4 against a hand-written fixture baseline of
18.0, about 56k input / 10k output tokens, about $0.31 a world.** A blind read by an outside
reader (`docs/design/BLIND_READ.md`) caught 1 of 10 of our lines the first time and 7 of 10
with a stricter reader the second; the specific tells it named are fixed, and section 4 says
what still gives us away.

**4:30 What the run gives back (S1, 40 s).**
Memories are derived from real `GameEvent`s only: which room, who fell, who revived whom, what
relic came out. They live on your device and on the hub: the memory wall, the Quartermaster's
lines, the relic shelf and the lamps all read from those events and nothing else
(`docs/design/HUB.md`, `src/client/chronicle/`). Nothing on that wall is invented. A fixture
world's memories say it was a fixture.

**5:10 How it was built (S3, 60 s, honestly).**
Three of us, one repo, one night. Each human ran one coding agent: Claude Code, Devin, Cursor.
`AGENTS.md` gives each agent owned paths, a branch, and the rules (validate at boundaries,
closed registries, be honest in data and prose, `npm run check` before merging). We wrote
design briefs (`docs/design/*.md`, each with its research and sources), handed them to agents,
reviewed the PRs and the measurements, and merged. 336 commits in the last 14 hours; most were
written by an agent and read by a human. Devin's sessions ran QA with two real browsers and
wrote `docs/QA_COOP.md`; Claude Code wrote the floors generator, the writing pipeline and the
boss; humans made the calls in "Needs a human call" sections and tuned `src/sim/tuning.ts`.
What it looked like: a lot of reading, a lot of "that number is not measured, measure it", and
merge conflicts in files two agents both touched.

**6:10 Close (S1, 20 s).**
"Every world you saw was written for the people in the room, built by code we trust, and left
behind a memory that is true. Come type a sentence."

### 2.2 The 90-second expo version

Use when judges are at the table and the queue is long. Have a world already prepared and the
receipt on screen; do not generate live unless the judge offers an idea and you have 50 seconds.

1. (10 s) Hook sentence above.
2. (30 s) Receipt on screen: "These two sentences were typed here ten minutes ago. Claude
   wrote a world bible, then chose biomes, laws and a boss from fixed lists. Code built the
   rooms. The badge says LIVE and the model; if it had failed it would say FIXTURE."
3. (30 s) Walk through the gate; one fight; hold M for the map. "Five biomes, 10 to 30 rooms
   each, doors seal in combat, server-authoritative co-op up to four."
4. (20 s) "Median 47 seconds to the first room, about 30 cents a world, 8 of 8 worlds passed
   the prose linter, and every memory on the hub wall came from an event that happened. Built
   by three of us orchestrating Claude Code, Devin and Cursor overnight."

### 2.3 The 20-second hallway version

"RELAY is a co-op roguelike where you type one sentence and Claude writes the world, but it
only fills in a strict schema and picks from fixed lists; our code builds the rooms, so the
model never writes code. Five biomes, under a minute, and the run leaves real memories on the
hub. Table N."

---

## 3 Demo runbook

Server-side flags decide which game the judge sees. **Floors mode (5 biomes, minimap, biome
choice) is off by default** (`RELAY_FLOORS` unset gives the three-room legacy world;
`.env.example`, `docs/design/FLOORS.md` §9). The demo below assumes `RELAY_FLOORS=1` and
`RELAY_LAWS=1` on the server; the server reports both on `GET /api/config` and every browser
adopts them (`src/shared/flags.ts`), so no URL flag is needed for a browser that reached the
server.

### 3.1 Exact clicks and keys, hub to biome choice

Controls: move **WASD/arrows**, aim **mouse**, attack **J or left click**, dash **Shift or
Space**, class ability **Q**, unlocked ability **E**, stations/relays/Anchor **tap F**, read a
relic or revive **hold F**, floor map **hold M** (or click the minimap to pin it), menu **Tab**,
biome choice **1 / 2 or click a door**.

1. **Open** `http://<LAN-IP>:8787/?mode=coop` (co-op) or `http://localhost:8787/` (solo). Badge
   top-right must read `CO-OP · HOST · CONNECTED` or the solo equivalent. Provenance badge is
   in the top bar and never leaves the screen.
2. **Hub.** You spawn at the centre. On a fresh device the first prompt is `[W][A][S][D] Walk.`
   Walk **northwest** to the Armory: four class stands (Bastion, Beacon, Shade, Weaver). Stand
   at one; the floating caption reads `F · TAKE THE …`. **Tap F.** Your colour and kit change.
   Prompt: `Take a weapon. The stands are northwest.` retires itself.
3. **Idea.** Click the idea field in the right-hand rail (placeholder "e.g. a flooded archive
   where the books still whisper"), or walk **southeast** to the Observatory and tap F to focus
   it. **Release the movement keys before typing.** Type the judge's sentence, **Enter**. It
   appears on the wall with your display name. A second player types theirs; both show on both
   screens. Enter a display name in the rail first if you want the receipt to say something
   better than the default.
4. **Prepare.** Host only. Click **Prepare world** in the rail. Watch the badge: it flips to
   `LIVE · claude-sonnet-4-6` when the world arrives, or to `FALLBACK FIXTURE (live attempt
   failed)`. Live: 45–50 s measured, budget 75 s (`WORLDGEN_EVAL.md`); say the section 3.5 line
   if it is going long. Guests see the same title and badge.
5. **Receipt.** The creation receipt opens under the world title: each contributor's name
   beside the feature their idea became, and, for fixtures, the sentence "Your ideas are
   recorded, but did not shape this world." **Read the judge's line aloud.** World dossier
   (click the title) shows laws (with `· engine-chosen` if the engine picked them), biomes, and
   `generation details › Provenance notes`.
6. **Gate.** Walk **south** eight tiles onto the glowing departure gate at the bottom centre
   (or click **Enter portal** in the rail). Host only; guests get `The host opens the gate.`
   The crew moves together.
7. **First rooms (onboarding).** Biome 1, room `r00`, no hostiles: walk, swing at nothing. The
   first combat room seals its doors (`Doors hold until the room is clear.`). Prompts, one at a
   time, bottom-left, each dies when you do the thing: `[LMB] Attack. The mouse aims.` on the
   first live enemy; `[Shift] Dash. It passes through danger.` the first time you take damage;
   `[Q] Your class ability is ready.` after the first clear; `[Tab] Unlock a second ability on
   the Operative page.` when affordable. Laws, if the world has any active, announce one line
   each on entry. Only laws the sim enforces are announced (`docs/design/ONBOARDING.md` §4).
8. **Minimap.** Top-right during a run: fog of war, visited rooms, unvisited neighbours, `Hold
   M · map` / `Doors sealed`. **Hold M** for the full floor map with a legend; click the minimap
   to pin it. Third room discovered fires `[M] Hold for the floor map.`
9. **Rooms worth stepping into**, if they are on the map: rest (heals 40% once per run, says
   so), treasure (4x clear reward, no fight), lore (hold F on the relic: one author, one dated
   event), elite (a gatekeeper that performs one of the Custodian's moves slowly; `This move
   comes back at the end.`).
10. **Biome choice.** The exit room is the farthest dead end. Clear it (the gatekeeper is a
    one-phase Custodian preview), then **tap F at the focus**. Two cards: name, tagline, "Built
    from:" motifs, enemy pool, room count. Host presses **1** or **2** or clicks a door; guests
    see `Waiting for {host} to choose.` The crew moves together and cannot come back. Prompt:
    `Pick on the facts, not the name.`

Measured on a wiped profile with a scripted bot: page load to a prepared world 29 s on the
prompted path; **first room in 17 s** if the player takes the default weapon and skips the
idea (`ONBOARDING.md` §9).

### 3.2 If short on time: deep links and flags

| URL | What it does | Caveat |
| --- | --- | --- |
| `/?world=fixture` | Bundled offline fixture, no server needed. Badge: OFFLINE FIXTURE. | Solo only |
| `/?world=fixture&autoenter=1` | Straight into room 0 of the fixture | Skips the hub; `run.move` safety prompt fires |
| `/?world=fixture&room=1` / `&room=2` | Jump to a legacy room index | Inspection aid, not evidence of a run |
| `/?world=fixture&floors=1` | Upgrades the bundled fixture to a floors world (5 biomes) in the browser | Briefs are engine-derived (`fallbackBrief`), not model-written; say so |
| `/?floors=1&laws=1` | Force floors and derived laws/look when **no server answered** | If the server answered, its `/api/config` flags win; set `RELAY_FLOORS=1 RELAY_LAWS=1` on the server instead |
| `/?hints=reset` | Wipe this device's onboarding memory so a judge sees the prompts | Do it before each new judge, once |
| `/?hints=off` | No prompts, for a clean capture | |
| `/?mode=coop&as=<name>` | Named co-op identity in `sessionStorage` (one per tab) | Used by `scripts/coop-e2e.mjs` |
| `/?palette=&lighting=&floor=&wall=&atmo=&dark=<px>` | Dev look overrides | Not for judges |

**Boss / escape / relic finale via a saved game or deep link: there is none.** No save files,
no `?biome=` or `?boss=` parameter exists (`src/client/game/GameController.ts` reads only
`room`, `world`, `autoenter`). The finale is reached by playing: tier-4 exit room, three-phase
Custodian, three-relay ritual, timed collapse (165 s for a 5-biome return path, 75 s for a
3-room world, `BOSS_FINALE.md` §7.3), relic choice on a pedestal. Options if a judge must see
it: (a) the legacy 3-room world with `RELAY_FLOORS` unset reaches the Custodian in three rooms
(`?world=fixture&room=2` puts you in the final room of the fixture, solo, no server); (b) a
teammate keeps a second laptop parked at the tier-4 exit from a run started earlier; (c) show
the stills captured with `scripts/shot.mjs` (section 5.2). Say which one you are doing.

### 3.3 Co-op on two laptops

Verified only with isolated browser contexts on one machine (`docs/QA_COOP.md`). Real Wi-Fi is
the five-minute human checklist in `QA_COOP.md` §"Two-laptop checklist"; run it at the venue
before judging. Short form:

1. Laptop A: `HOST=0.0.0.0 PORT=8787 npm start` (after `npm run build`). Find the IP
   (`ipconfig getifaddr en0` on macOS, `ip addr` on Linux). Allow the incoming connection.
2. Both open `http://<A-IP>:8787/?mode=coop` (the IP, not localhost, on both). Badges:
   `HOST · CONNECTED` on A, `CREW · CONNECTED` on B; rail `SHARED CREW · 2/4`.
3. If B never connects: venue Wi-Fi client isolation or A's firewall. A phone hotspot works.
4. B takes a weapon, both type ideas, only A can Prepare and open the gate. A's biome pick moves
   both. Revive: stand over the downed player, hold F 2 s (40 HP).
5. Reloading a tab mid-run resumes the same operative; if A closes the tab, B becomes host
   within a second. A run outlives its players: **restart the server before judging** so the
   lobby and the idea list are clean.

### 3.4 Pre-demo checklist

Do this in order, 30 minutes before the first judge.

- [ ] `git pull && npm ci && npm run check` on the demo laptop (typecheck + tests + build; CI
      runs the same). Node `>= 20.19`; `.nvmrc` says 26.
- [ ] `.env` on the server laptop (never committed, never `VITE_`):
      `RELAY_GENERATION_MODE=live`, `RELAY_AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=<key>`,
      `ANTHROPIC_MODEL=claude-sonnet-4-6`, `RELAY_FLOORS=1`, `RELAY_LAWS=1`, `HOST=0.0.0.0`,
      `PORT=8787`. `RELAY_LAWS` is read by `src/sim/laws.ts` on the server and reported on
      `/api/config`; it is not in `.env.example`, add it by hand.
- [ ] Key present and paid: `curl -s localhost:8787/api/health` shows `ok: true` and
      `generation.effectiveMode: "live"`; `/api/config` shows the provider and flags. A 402 from
      Anthropic means credit, not code (`WRITING.md` §9 records one).
- [ ] `npm run build && HOST=0.0.0.0 npm start`. **Not `npm run dev`**: Vite reloads every tab on
      a file change and looks like a mass disconnect (`QA_COOP.md`).
- [ ] Restart the server right before the first judge (clean lobby, empty idea list; ideas
      accumulate for the process lifetime, 24 max).
- [ ] LAN IP written on a sticky note; firewall allows inbound on 8787; second laptop connects
      and shows `CREW · CONNECTED`.
- [ ] Prepare one live world now and leave it at the hub with the receipt visible: it is the
      fallback if the venue's network slows the next live call, and it is the 90-second version's
      opening screen.
- [ ] Audio on, laptop volume audible in a hall; sound starts after the first click. Mute state
      persistence was never checked (`QA.md`).
- [ ] Browser zoom **100%** (Cmd/Ctrl+0), window maximised, 1280×720 or wider. The prompt band
      and the minimap were placed for that.
- [ ] Open `/?hints=reset` once on each demo browser so the judge sees the prompts; also
      available under Tab → Field Notes.
- [ ] Memory wall (northeast Echo Archive) shows only runs that happened on this device.
      Delete nothing during a demo; if it holds test junk from the night, clear it **before**
      the first judge and then play one honest run so it is not empty.
- [ ] Render awake: open https://relay-a3yv.onrender.com/api/health (free instance sleeps after
      15 min, ~1 min to wake). Pages up: https://phronesis618.github.io/HackMIT2026/.
- [ ] Phone hotspot charged, as the Wi-Fi fallback.
- [ ] Anyone who pasted an API key into a chat, issue or agent session last night: **rotate it
      now** (section 5.5).

### 3.5 Fallback ladder

Say the fallback out loud every time. The product's rule is that fixtures are never presented
as live; the pitch's rule is the same.

1. **Live generation slow (past ~60 s) or failed.** The badge flips to `FALLBACK FIXTURE (live
   attempt failed)` and the receipt says "Live generation failed. Offline fixture 'X' instead."
   Say: "The live call did not come back in budget, so the game fell back to a hand-written
   fixture and it is telling you so. Your ideas are on the wall but did not shape this one." Then
   play the fixture. Show the earlier prepared live world's receipt for the LIVE half of the
   pitch. Do not retry more than once in front of a judge.
2. **Venue Wi-Fi blocks the second laptop.** Try the phone hotspot once (both laptops on it).
   If not, go solo on the server laptop: the same simulation, same badge, same receipt; say
   "co-op is verified with two browsers on one machine and not on this network".
3. **Laptop server dies.** Open https://relay-a3yv.onrender.com (full game: live generation if
   the key is set on Render, co-op over wss). Its state as of this morning is **unverified**
   (`QA.md`, "Render full-game service"); check `/api/health` in the pre-demo list and note the
   `effectiveMode`. If it says `fixture`, say so.
4. **Render down too.** https://phronesis618.github.io/HackMIT2026/ (or the older mirror
   https://client-gzffunxf.devinapps.com/): static solo fixture, OFFLINE FIXTURE badge, no
   generation, no co-op. `?world=fixture&floors=1` gives the five-biome structure with
   engine-derived briefs. Say: "This is the static build; the world is the bundled fixture and
   the badge says so."
5. **Everything down.** The stills from section 5.2 and the receipt screenshot from the
   rehearsal. Say what they are.

---

## 4 Judge Q&A

Honest answers. Where the honest answer is "unverified", say the word.

1. **What is AI-generated at runtime, what is authored, what did coding agents build?**
   Runtime (Claude, per world): the world bible, title and tagline, biome names/taglines/room
   lines, law names and descriptions, the three authors' relic and remains fragments, attunement
   text, boss name, phase titles, move names and tells, and the **choice** of biome briefs, laws,
   look parameters and boss moves from closed lists. Authored by us: the three fixture worlds,
   every registry entry (enemies, props, tiles, 18 laws, 11 boss patterns), the 17 room
   templates, all UI strings, the house style. Built by coding agents under human direction:
   most of the code, including the generator, the linter and the netcode; humans wrote the
   briefs, reviewed, tuned and merged (`AGENTS.md`, `docs/design/*.md`).
2. **How is model output kept safe?** It is data, never code. A forced tool call returns JSON
   against a strict schema (`src/shared/contracts.ts`, Zod); ids must exist in the registry;
   strings are length-capped and checked for markup, URLs and expressions; the compiler places
   everything and validates reachability (`validateRoomSafety`). Invalid output gets one
   bounded repair or is dropped for a labelled fixture. The client never receives a room it
   did not validate. Prompt injection was one of the eight eval idea sets: the instruction was
   ignored and only its noun (a lighthouse) was used (`WORLDGEN_EVAL.md`).
3. **Latency and cost per world?** Measured on 8 worlds, 20 Sept: first room p50 **47.3 s**,
   max 49.9 s, all under 60 s; call 1 p50 22.4 s; 9–17 calls; ~55.8k input and ~9.6k output
   tokens; **about $0.31** at Sonnet list price. The earlier run of the same script was 69.9 s
   p50 and $0.36 before the call-1 schema fix (`WORLDGEN_EVAL.md`). Venue network latency is
   not in those numbers.
4. **Why doesn't the text read as AI, and how did you measure it?** House style
   (`docs/WRITING.md`): a physical noun and a checkable fact in every sentence, names from the
   bible only, three authors with fixed registers, banned mood vocabulary, no "not X but Y", no
   closing morals. A linter enforces it and a repair loop returns only the failing line and
   rule. Mean lint score 2.4 vs 18.0 for our own hand-written fixtures. Blind read
   (`BLIND_READ.md`): an outside reader with no repo access labelled 20 unlabelled lines, 10
   ours and 10 from shipped games (DCSS, Magic, Souls). First read caught 1 of 10 of ours; a
   second, stricter reader caught 7 of 10 and also called 1 of 10 shipped lines AI. Those are
   two readers on two sample sets at n=10; **not a before/after**.
5. **What still reads as AI?** From `WORLDGEN_EVAL.md` and `BLIND_READ.md`: taglines cut by
   our own truncation code (56 of 64 were over the schema limit), law descriptions that state
   the fact and forget the rule, room lines that open on a count or a piece of furniture too
   often, the "handwriting" reflex with a name on it, and one remains fragment that reused an
   author's name. The two prompt changes meant to fix truncation are **unverified against the
   model**.
6. **Netcode model?** Server-authoritative. One Node process runs the simulation
   (`src/sim`, pure, no DOM/Phaser/timers) and streams snapshots and events over WebSocket;
   clients send input and `UiActions` only, and drop input older than 250 ms. Solo uses the same
   simulation locally. Measured sync latency and 4-player lobby are in `QA_COOP.md`.
7. **What was verified with two browsers vs on a real LAN?** Verified: two to four isolated
   Chromium contexts with real keyboard/mouse input (`scripts/coop-e2e.mjs`): lobby, classes,
   host-only prepare, combat and reward agreement, revive, tab reload resumes the same
   operative, host succession, floors co-op, production bundle over the LAN IP on a non-default
   port (one machine). **Not verified:** two physical laptops on real Wi-Fi, four players playing
   a run (four in the lobby only), Beacon/Bastion in co-op, Firefox/Safari, audio, `wss:`
   behind HTTPS, live generation in co-op with two clients (unit-tested only).
8. **What is unverified or cut?** Unverified: everything in Q7; the Render service's current
   state; the hosted Pages URL (the artifact was verified in a static emulation); a real OpenAI
   call. Not implemented: 8 of the 18 world laws (they resolve to numbers nobody reads; the
   panel labels them inactive and onboarding never announces them), `wallStyle`/`skylineDepth`/
   `grain`, per-biome intensity, secret rooms, per-biome template sets, TILES.md's second-pass
   terrain beyond the damaging `~` floor, the ready-up at the gate (PR #42, open), a `derived`
   marker on biome doors whose brief the engine wrote (disclosed only in the dossier's
   Provenance notes, `VISION_AUDIT.md` §2), and the skill tree page, which says it is a design
   preview.
9. **Balance caveats?** Measured solo, no items: Bastion beats the Custodian in 26 s, Beacon
   25 s, Shade 35 s, **Weaver loses**. Phase 1 runs 5–9 s against the 18 s design target; the
   health number (`bossHpBase` 1200, safe range 800–1800) is the open human call in
   `BOSS_FINALE.md`. Encounter numbers in floors are "untuned against real play"
   (`FLOORS.md` §8). Every knob is in `src/sim/tuning.ts` with a safe range (`docs/TUNING.md`).
10. **Is the fixture ever shown as live?** No. The source enum is shown to players and "must
    never lie" (`contracts.ts`); the badge is mounted outside the run branch and is always on
    screen; the receipt and every memory carry the label (`VISION_AUDIT.md` §1).
11. **Does the model write the rooms?** No. It writes a brief per biome (motifs, enemy pool,
    prop pool, hazards flag, linearity, branchiness, special-room counts). A seeded generator
    builds the floor plan and assembles rooms from hand-made templates; two machines build
    byte-identical rooms from the same seed (tested, `FLOORS.md` §1).
12. **Where do the memories come from?** Only from `GameEvent`s the authority emitted
    (`AGENTS.md` rule 4). Stored per device in `localStorage` (Zod-validated, salvaged entry by
    entry on corruption). Co-op shares the events; storage belongs to each browser. Nothing
    invents players, rescues or history.
13. **What happens with a hostile or silly idea?** The idea sets in the eval include silly,
    contradictory, one-word, non-English and prompt-injection inputs; all eight produced valid
    worlds in the last run. Injection text is treated as a noun source, never as an instruction.
    Unused or unusable ideas are shown as unused on the receipt.
14. **How did three people and three agents not collide?** `AGENTS.md`: owned paths per agent,
    contracts and root config owned by one agent, integration requests as issues, `npm run
    check` before merge, honesty rules in the same file as the git rules. Conflicts still
    happened in shared files; the merge owner resolved them.
15. **What did the agents get wrong?** Examples we can show: the phase-3 co-op split and the
    solo latch shipped with different numbers than the design (argued in code); an agent wrote a
    fix for a "leaked name" that was actually the seeded name pool working, checked, and
    reverted it (`WORLDGEN_EVAL.md` item "tested and found not to be a problem"); the first
    onboarding build put prompts bottom-centre, where every other overlay lives, and the
    screenshots caught it (`ONBOARDING.md` §5).
16. **Why Claude?** Forced tool use with a strict schema returned the bible's eight fields
    first time in 11 of 11 worlds once the schema was flat; the prose after the house-style
    prompt scored 2.4 on our linter. OpenAI `gpt-5-mini` is supported behind the same
    validation but a real call is unverified (`QA.md`).
17. **How much did the night cost?** The eval runs: 11 live worlds about $3.40, plus the
    earlier 8-world run, plus the blind-read worlds. Exact API spend for the night: **not
    tracked in the repo.** Say "a few dollars of API for evaluation" only if someone has the
    console number.
18. **What would you do next?** Tune the Custodian's health with real players; mark
    engine-derived briefs on the door; make the remaining 8 laws real; let players' ideas map
    to specific biomes (open gap in `FLOORS.md` §12); verify on a real LAN and on Render; a
    proper before/after blind read with one reader and n above 10.
19. **Can I play it now?** Yes: the static fixture build at the Pages URL on any laptop, or the
    Render URL for live generation if the key is set and it is awake. Say which is which.

---

## 5 Don't-miss checklist

### 5.1 Submission fields (Plume or Devpost; confirm which on dayof)

- [ ] Title: RELAY. One-line: "Worlds end. Your stories don't." (README).
- [ ] Track: Entertainment (one track only; **confirm it exists in 2026**).
- [ ] Sponsor challenges: Anthropic Best Use of Claude if offered; any other only if we
      actually used the sponsor's product.
- [ ] Repo URL: https://github.com/Phronesis618/HackMIT2026 (check it is **public**: repo
      Settings → General → Danger Zone → Change visibility; a judge cannot clone a private repo).
- [ ] Live URL(s): Render for the full game, Pages for the static fixture, each labelled as
      such in the description.
- [ ] Video: under the length limit the form states; section 5.2 shot list.
- [ ] Description: paste section 2.3 then section 2.1's "how it works", then the measured
      numbers with the file they come from. Say "fixture" wherever a screenshot shows one.
- [ ] Table number, once assigned.
- [ ] Team members and every AI tool used (section 5.4).

### 5.2 Demo video shot list

Capture stills headless so nothing is hand-cropped or faked; no binaries are committed to
the repo, keep them in `/tmp` or the submission form (`docs/SCREENSHOTS.md`):

```bash
node scripts/shot.mjs --start-dev --url "/?world=fixture&autoenter=1" --out /tmp/relay-shots/room1.png
node scripts/shot.mjs --start-dev --preset audit --out-dir /tmp/relay-shots/audit
node scripts/shot.mjs --start-dev --coop --out /tmp/relay-shots/coop.png
node scripts/coop-e2e.mjs --floors --only lobby,demo,floors   # per-checkpoint stills for two players
```

Shots, in pitch order: (1) hub with two ideas on the wall and names; (2) provenance badge
`LIVE · claude-sonnet-4-6` with the receipt (from a real live run; if you only have fixture
runs on that machine, the badge will say so and so must the caption); (3) first combat room
with a coach prompt visible; (4) full map held with M; (5) biome choice cards; (6) Custodian
phase 2 with the biome joining in; (7) relic pedestal choice; (8) memory wall after the run,
with the fixture/live label on a memory; (9) two laptops side by side, if the LAN check
passed. Screen-record the live prepare from click to receipt uncut, with the clock visible, so
the "under a minute" claim is on tape.

### 5.3 Clean-clone quick start

- [ ] On a machine that has never seen the repo: `git clone`, `npm ci`, `npm run check`,
      `npm run dev`, open http://localhost:5173, Prepare world, read OFFLINE FIXTURE. If any
      step in `README.md` "Quick start" is wrong, fix the README before submitting.
- [ ] README still says "fight through three rooms" and "three combat rooms" in the intro and
      "Current playable loop"; floors mode is behind `RELAY_FLOORS=1`. Either say so there or
      leave it and say so in the pitch. Do not claim five biomes as the default.

### 5.4 Credits for every AI tool

`docs/evidence/` has `codex.md` and `devin.md` only. Claude Code (the `Curious Droid`
account, 218 commits tonight) and Cursor (Agent A, operator mode) have no evidence file. Before
submitting, add a short dated entry for each stating what the tool did, which commits, and
what was verified, in the same table form as `codex.md`. Do not invent sponsor evidence
(`AGENTS.md`). Runtime model: Anthropic `claude-sonnet-4-6` via the Messages API with forced
tool use; OpenAI `gpt-5-mini` supported, unverified.

### 5.5 Licences, attribution, secrets

- [ ] The prose linter's word lists are a subset (roughly 15%) of `sam-paech/antislop-sampler`,
      **Apache-2.0**. The header of `src/shared/prose-data.ts` and `docs/WRITING.md` §9 cite it.
      Apache-2.0 requires the notice to travel with the code: confirm the repo carries a LICENSE
      or NOTICE that names it, and credit "Paech et al., Antislop (arXiv 2510.15061)" in the
      submission.
- [ ] Sources for the design research are cited in each `docs/design/*.md`; the blind-read's
      quoted game lines are under 15 words each with attribution and never become RELAY content.
- [ ] **Rotate any API key that was pasted into a chat, an issue, a PR, or an agent session**
      (`OVERNIGHT_PLAN.md` §7 asked for one in chat). Anthropic console → API keys → revoke,
      create a new one, put it only in `.env` on the server laptop and in Render's Environment
      tab. Check `git log -p -S 'sk-ant' -- .` returns nothing.
- [ ] `.env` is git-ignored; `grep -r VITE_ src/` returns nothing.

### 5.6 Things not to claim

- Anything in the "Not verified" lists of `docs/QA.md` and `docs/QA_COOP.md`: two physical
  laptops on Wi-Fi, four players in a run, a live OpenAI call, audio, Firefox/Safari, the
  Render service's current state, the hosted Pages URL.
- A fixture as live. If the badge says FIXTURE, the caption, the pitch and the video say
  FIXTURE.
- Invented runs, players, rescues or memories. Every memory on the wall in a screenshot
  happened on that device.
- "Indistinguishable from human writing." The measured statement is in Q4 and Q5.
- "The AI designs the levels." The model writes briefs and text and picks from lists; code
  builds rooms.
- Five biomes as the default game. It is `RELAY_FLOORS=1`.
- Any 2026 prize, track or rubric from section 1 that is still marked UNCONFIRMED at 8 am.
