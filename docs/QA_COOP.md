# Co-op verification (agent C1, branch `fix/coop-verify`)

**Question:** does co-op actually work?
**Answer:** yes. Two (and four) real browsers can join, pick classes, contribute, enter the same
world, fight, revive, collapse, return, clear all three rooms, beat the three-phase Guardian and
finish the three-relay Anchor ritual together, with every screen agreeing. Two real bugs were
found by playing (a tab reload duplicated the player; a lobby of disconnected "ghost" seats
locked the returning host out) and one menu keyboard trap; all three are fixed with tests.
What is **not** verified: two physical laptops over Wi-Fi, live (LLM) generation in co-op,
audio, and anything on a non-Chromium browser.

Everything below marked *verified-in-browser* was observed by `scripts/coop-e2e.mjs`: isolated
headless Chromium contexts driven with real keyboard and mouse input only, state read from the
DOM and the client's existing read-only `window.relay` handle, a screenshot per player per
checkpoint (opened and inspected where noted). Nothing was injected; no test hooks were added.

Architecture note (the brief said "host-authoritative"): the simulation is **server**-
authoritative. One Node process = one lobby = one `createSimulation()`; "host" is only the
player allowed to prepare a world, open the portal, return the crew and pick the biome.

## Results

Final pass on the merged branch (`930552e`), dev servers (Vite `:5973` → API/WS `:9587`),
fixture generation, macOS, headless Chromium with Metal GL. Evidence strings are the script's
own output (`results.json` of two invocations: `--only lobby,demo` and `--only reconnect,fullrun`).

| # | Checkpoint | Result | Observed (script evidence, both screens) |
| --- | --- | --- | --- |
| 1a | two players join; host/guest roles | **PASS** · verified-in-browser | alice badge="co-op · host · connected" bob badge="co-op · crew · connected"; alice first-connected isHost=true |
| 1b | crew list matches on both screens | **PASS** · verified-in-browser | alice sees "Shared crew · 2/4" "alice · bob"; bob sees "Shared crew · 2/4" "alice · bob" |
| 1c | third and fourth join (4/4) on every screen | **PASS** · verified-in-browser | all four screens: ["Shared crew · 4/4","carol · alice · dave · bob"] |
| 1d | fifth player is refused cleanly | **PASS** · verified-in-browser | eve connection="offline" badge="co-op · crew · offline" notice="Failed to start: The lobby is full (maximum four players)."; host still sees "Shared crew · 4/4"; eve page errors=0 |
| 1e | departed players leave the crew list | **PASS** · verified-in-browser | back to "Shared crew · 2/4" "alice · bob" after 33.7 s (server grace 30 s); bob sees "Shared crew · 2/4" |
| 2 | each picks a different class; both see both | **PASS** · verified-in-browser | alice screen ["alice:shade","bob:weaver"] \| bob screen ["alice:shade","bob:weaver"] (alice via quick-control chip, bob walked to the Weaver shrine [reached=true] and pressed F) |
| 3a | both ideas appear on both screens | **PASS** · verified-in-browser | both screens list: ["alice a lighthouse that hums in the fog","bob moths made of glass"] |
| 3b | guest cannot press Prepare world | **PASS** · verified-in-browser | guest Prepare disabled=true, host disabled=false; forced guest click produced world=false |
| 3c | host prepares; same title, provenance label, receipt on both | **PASS** · verified-in-browser | 1.0 s; both screens: {"title":"Vantage Spire","provenance":"OFFLINE FIXTURE","receipt":["alice “a lighthouse that hums in the fog”recorded · not used in this world","bob “moths made of glass”recorded · not used in this world"],"worldId":"world-vantage-spire-shxfoh"} |
| 4a | host walks onto portal; both land in room 1 of the same world | **PASS** · verified-in-browser | both screens: {"phase":"expedition","roomIndex":0,"roomId":"vantage-spire-room-0","telemetry":"Vantage Spire · room 1","caption":"Threshold Concourse"} |
| 4b | positions sync both ways; latency measured | **PASS** · verified-in-browser | key-down -> visible on the OTHER screen: 84 ms, 117 ms, 120 ms, 127 ms (median 120 ms, localhost, includes 50 ms snapshot cadence); resting positions on both screens: [["alice",132,262],["bob",116,240]] vs [["alice",132,262],["bob",116,240]] |
| 5b | enemy deaths, room clear and reward agree | **PASS** · verified-in-browser | fight results ["cleared","cleared"]; both screens: {"cleared":true,"enemies":["husk:dead:0"],"resources":["alice:6","bob:6"]} |
| 5c | E unlock by one player is per-player and agrees on both | **PASS** · verified-in-browser | alice clicked "Unlock" (button present=true); both screens: ["alice:E=true:res=3","bob:E=false:res=6"] |
| 7a | guest reaches the exit; the whole crew moves to room 2 together | **PASS** · verified-in-browser | both screens: {"roomIndex":1,"roomId":"vantage-spire-room-1","caption":"Cable Gallery","players":2} |
| 5a | each player damages an enemy; HP agrees on both screens | **PASS** · verified-in-browser | alice struck husk#0-0: 30 -> alice's screen 0 / bob's screen 0; bob struck sentinel#1-0: 60 -> alice's screen 32 / bob's screen 32 (screens read ~10 ms apart while enemies keep fighting) |
| 6a | a downed player shows as downed on both screens | **PASS** · verified-in-browser | both screens: ["alice:up","bob:down"]; bob HUD: "expedition" |
| 6b | hold F revives; both see the revive | **PASS** · verified-in-browser | alice cleared the room (cleared), walked to bob and held F: revived after 2100 ms (design 2000 ms), max progress seen on bob's screen 0.98; both screens: ["alice:100","bob:40"] |
| 7b | host leads the crew into the final room | **PASS** · verified-in-browser | both screens: {"roomIndex":2,"final":true,"enemies":["guardian"]} |
| 6c | both downed -> collapse debrief on both screens | **PASS** · verified-in-browser | both screens: {"phase":"debrief","ui":"debrief","title":"Vantage Spire","outcome":"alice and bob watched the world collapse."} |
| 6d | only the host can return the crew | **PASS** · verified-in-browser | host Return disabled=false; guest Return disabled=true |
| 6e | host returns crew -> both back in HQ; memories on each device | **PASS** · verified-in-browser | both screens: {"phase":"headquarters","ui":"headquarters","telemetry":"Vantage Spire · sanctuary","hp":["alice:100","bob:100"]}; memory records alice=6 bob=6 (each browser context has its own localStorage) |
| 8a | guest reloads mid-room -> same operative, state restored | **PASS** · verified-in-browser | before: id=player-ozd8z1khpy x=175 hp=86 resources=6; after reload host sees 1 "bob" operative(s) [["player-ozd8z1khpy",175,86,6]]; lobby="alice,bob"; bob's own id=player-ozd8z1khpy ui.phase=expedition sees self at 175 |
| 8b | guest closes browser, rejoins with same as= -> lands in the running room; old seat expires | **PASS** · verified-in-browser | while away host lobby="alice,bob(off)"; right after rejoin host sees 2 "bob" operative(s) [["player-oxjqdsepmu",93,100],["player-ozd8z1khpy",175,86]] lobby="alice,bob(off),bob"; bob ui.phase=expedition world="Vantage Spire"; ghost seat gone after 29 s=true (new browser profile = new identity by design) |
| 8c | host closes mid-room -> guest becomes host and keeps playing | **PASS** · verified-in-browser | bob badge="co-op · host · connected" isHost=true; bob moved x 93 -> 45 after the host left; lobby="alice(off),bob" |
| 8d | old host rejoins as crew, lands in the running room | **PASS** · verified-in-browser | alice badge="co-op · crew · connected" ui.phase=expedition world="Vantage Spire"; both screens: {"phase":"expedition","roomIndex":0,"host":"player-oxjqdsepmu"}; lobby="alice(off),bob,alice" |
| 7c | two players clear three rooms, boss phases and the three-relay ritual | **PASS** · verified-in-browser | furthest: room 3; loop outcome=debrief; boss phases seen=[1,2,3]; ritual stages seen=["relays:0","relays:1","relays:2","core:3","discharging:3"]; both screens: {"phase":"debrief","anchor":"planted","title":"Vantage Spire","outcome":"bob and alice returned with the world anchored."} vs {"phase":"debrief","anchor":"planted","title":"Vantage Spire","outcome":"bob and alice returned with the world anchored."} |

Status legend: **verified-in-browser** = seen on both screens in the run above ·
**unit-tested-only** = covered by Vitest but not reached in a browser · **unverified**.

### Measured sync latency

Key-down on one browser → the mover's position visibly changed in the **other** browser's
snapshot (polling every ~4 ms; includes client input flush ≤16 ms, 60 Hz server tick and the
50 ms snapshot broadcast cadence):

| Setup | Samples (ms) | Median |
| --- | --- | --- |
| Dev (Vite proxy), localhost, three runs | 67, 83, 51, 62 · 76, 61, 61, 60 · 84, 117, 120, 127 | 62–120 (the slow run was under a machine load average of ≈25 from other agents' browsers) |
| Production bundle via LAN IP `10.29.220.135:9611` (same machine) | 81, 37, 80, 51 | ~65 |

Resting positions matched to the pixel on both screens after each move. This is one machine:
real Wi-Fi adds its RTT/2 and jitter on top. There is no client-side prediction or
interpolation, so on a bad network remote (and local) motion will look steppy at 20 Hz; on a
LAN it should be fine. Not measurable here.

### Scenario 10 — LAN sanity on one machine (verified-in-browser)

`npm run build && HOST=0.0.0.0 PORT=9611 npm start`, then
`node scripts/coop-e2e.mjs --base http://10.29.220.135:9611 --only lobby,demo` (LAN IP, not
localhost; production bundle served by the Node server; no Vite). Lobby (4/4, fifth refused,
leavers pruned) and the whole demo path passed; 6b (revive) was skipped in that run because the
lone fighter died before she could revive (it passed in the dev runs). The WebSocket URL is
derived from `location` (`ws://<host>:<port>/ws`), so a non-default port works with no
configuration. `wss:` is chosen automatically under `https:` (not exercised).

### Scenario 9 — Floors mode, `RELAY_FLOORS=1` (verified-in-browser, F2's code, no fixes needed)

`node scripts/coop-e2e.mjs --floors --full-run-minutes 12` (the flag is passed to the spawned
server through the script's env passthrough; `--env KEY=VALUE` adds more):

| # | Checkpoint | Result | Observed |
| --- | --- | --- | --- |
| 9a | `snapshot.floor` present and identical on both screens | PASS | biome, room, tier, fog-of-war map, `doorsLocked` byte-identical |
| 9b | door traversal with two players | PASS | 11 traversals, alternating which player walks through the door; the crew always moved together; 10 rooms visited; floor state identical after every step |
| 9c | doors seal in combat on both screens | PASS | both screens `doorsLocked:true`; the guest pushed into a sealed door with real input and the crew stayed put; doors opened on clear |
| 9d | biome choice is host-only | PASS | at the biome exit (F at the gate) both saw the offer; guest pressed `1` → ignored; host pressed `1` → both screens moved to `biome-4` |

Floors issues seen (reported to F2/F3, **not** fixed here):

- ~~The info notice "The way on is open. The host chooses: [1] … [2] …" stays on the guest's
  screen after the host has chosen and the crew is already in the next biome (needs a manual
  Dismiss). `s9-floors-biome-bob.png`.~~ Fixed (Z1, A2/A3): that notice is gone — the choice
  screen says it all — and any `info` notice now ends when the crew changes room.
- ~~In a floors run the rail says "Room 1/1"~~ fixed (Z1, A1): the rail reads rooms visited of
  the biome's room budget and "Biome n/5". The world brief ("1/1 rooms") and the top bar
  ("room 1" in every room) still use the legacy `plannedRoomCount`/index labels.

## Bugs found by playing

### B1 — Reloading a tab mid-run duplicated the player (fixed, `b4842c4`)

Repro (before): two browsers in room 1; reload the guest tab. Observed on the host's screen:
two operatives named `bob` — the old one frozen in place as an untargetable-by-its-owner ghost
for 30 s, the new one at the spawn with fresh HP/resources/unlocks; lobby `alice,bob(off),bob`.
Cause: the resume token lived only in memory, so any page load was a brand-new player.
Fix: `RemoteSession` keeps `{playerId, token}` in an injected per-tab storage
(`sessionStorage`), resumes with it on the next load (asks for current state, not an event
replay), and silently joins fresh if the credential is stale or in use.
Test: `realtime.test.ts` "returns a reloaded tab to the same operative…". Browser: 8a PASS
(same id, same x, one `bob`).

Follow-up on main: Devin's PR #26 ("Preserve co-op seats across named and ordinary tab
reloads") builds on this fix — the credential is validated with zod and keyed by a stable
per-tab `resumeScope` instead of the (server-reassignable) player id. **It holds up in the real
two-browser test:** after merging `origin/main` (92d1393+) the lobby and reconnect groups were
re-run (`/tmp/relay-shots/coop-final3`): 1a–1e and 8a–8d all PASS — reload returns the same
operative (same id, x, HP 100, resources 6; exactly one `bob`), new browser profile lands in the
running room and the old seat expires after 30 s, host succession and the old host's return as
crew work, and the ghost-seat eviction (B2) is intact. Their *ordinary-tab* (no `?as=`) reload
path is unit-tested-only (`realtime.test.ts` "resumes both ordinary tabs…"); the script only
drives `?as=` identities.

### B2 — A lobby of ghost seats locked the returning host out (fixed, `1d79074`)

Repro (before): guest reloads once, closes and reopens once (two ghost seats), then the host's
browser closes and reopens within 30 s → "The lobby is full (maximum four players)" with only
one live player in the game. Fix: when the lobby is full a newcomer takes the
longest-disconnected seat; a fifth *live* player is still refused.
Test: `realtime.test.ts` "gives the longest-disconnected seat…". Browser: 8d PASS.

### B3 — Escape did not close the menu after buying E from it (fixed, `0ed11cb`)

Repro: in a run press Tab → 3 (Operative) → click "Unlock · 3 resources" → press Escape. The
focused button unmounts, focus falls to `<body>`, the key handler ignored it and the modal
stayed over the HUD (and later over the debrief's Return button). Not co-op specific; found in
the co-op run. Fix in `keyboardFocus.ts` + test in `readiness-keyboard.test.ts`.

### Open (documented, not fixed)

- **Ghost seats are invisible as such.** For 30 s after a disconnect the operative stands in the
  room, still listed in the crew rail with no "disconnected" mark, still targeted by enemies,
  and still counts as "living" — so if the only *connected* player is downed the run does not
  collapse until the ghost dies or is pruned. (`UiModel.players` has no `connected` flag.)
- **A new browser profile is a new player.** `?as=` identities live in `sessionStorage`; the
  normal identity lives in `localStorage` but the resume credential is per tab. Closing the
  browser and reopening rejoins the running room as a new operative (fresh HP/resources) while
  the old seat expires after 30 s. Verified (8b). Auto-reconnect after a network blip keeps the
  same operative (in-memory token; unit-tested-only).
- **A run outlives its players.** If everyone leaves mid-run the server pauses the sim and
  keeps it; the next person to join becomes host *inside the old room*. Workaround: host →
  Tab → Operative → Return, or restart the server before the demo. Ideas also accumulate for
  the life of the server process (24 max, same as solo) — restart before judging.
- **Input older than 250 ms is dropped by design**, on the client and the server. A laptop
  rendering below ~4 fps cannot move. Only seen with software GL under load; worth knowing if a
  demo machine is struggling.
- Players spawn overlapping in a tight cluster (names overlap until someone moves). Cosmetic.
- In dev, Vite full-reloads every tab when a source file changes — it looks like a mass
  disconnect. Not a product bug; don't edit/merge during a demo on the dev server (use
  `npm run build && npm start`).

One earlier pass of the reconnect group failed 8c/8d for a game reason, not a network one:
the crew stood idle in an uncleared room while the script waited out the 30 s seat grace, the
room's Sentinel killed both operatives, and the run (correctly) collapsed to the debrief on
both screens. The script now clears the room first.

## Not verified

- Two physical laptops / real Wi-Fi (checklist below).
- Live LLM generation in co-op (no API key here): streaming prefix commits to two clients are
  unit-tested-only (`realtime.test.ts`, `streaming.test.ts`).
- Network-blip auto-reconnect with the in-memory token: unit-tested-only.
- Four players *playing* a run (four were verified in the lobby only).
- Beacon/Bastion class kits in co-op (Shade + Weaver fought; the full run used two Bastions).
- Audio; Firefox/Safari; the `wss:` path behind HTTPS.
- Revive while enemies are still alive (the script revives after the room is cleared).

## Two-laptop checklist (5 minutes, human)

Laptop A is the server + host. Both on the same Wi-Fi (not a guest network with client
isolation — if step 3 fails, that is the first suspect; a phone hotspot works).

1. **A:** `git pull && npm ci && npm run build && HOST=0.0.0.0 PORT=8787 npm start`. Find A's IP:
   `ipconfig getifaddr en0` (macOS). Allow incoming connections if macOS asks.
2. **A:** open `http://<A-IP>:8787/?mode=coop` (use the IP, not localhost, so both are equal).
   Top-right badge must read `CO-OP · HOST · CONNECTED`.
3. **B:** open the same URL. Badge `CO-OP · CREW · CONNECTED`; both rails show
   `SHARED CREW · 2/4` with both names. If B never connects: firewall or client isolation.
4. **B:** walk to a shrine (top-left wing), press **F** → A sees B's class/colour change.
5. **Both:** type an idea, Enter. Both lists show both ideas. B's *Prepare world* is greyed out.
6. **A:** *Prepare world* → both see the same title, the same provenance badge and both ideas
   in the receipt. **A** walks onto the portal (bottom centre) → both land in room 1.
7. **B:** run in circles. On A's screen B should move smoothly with no visible delay (<0.2 s).
   Fight together; both HUDs show the same "Hostiles" count; both get +3 resources on clear.
8. **B:** stand in the enemies until downed. **A:** clear the room, stand next to B, hold **F**
   for 2 s → B is up with 40 HP on both screens.
9. **B:** press ⌘R mid-room → B comes back as the *same* operative (same place, same HP), and
   A never sees a second B. Then **A:** close the tab → B's badge flips to `HOST` within a
   second and B can keep playing; A reopens the URL and returns as `CREW` in the same room.
10. Both die → both see the collapse debrief; only the host's *Return to headquarters* is
    enabled → both are back in the sanctuary and each laptop's Memory wall count went up.

Before judging: restart the server (clean lobby, clean idea list) and keep it on
`npm start`, not `npm run dev`.
