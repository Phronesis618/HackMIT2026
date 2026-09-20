# Release candidate: making floors + laws the default game

**Branch:** `release/floors-default` · **Status: the default flip is NOT in this branch.**
Written 2026-09-20 by the QA agent, for the humans who own FOLLOWUPS J1.

This branch was cut to turn the headline feature — floors (5 biomes of 10–30 rooms) plus world
laws — into the default game. It carries the parts that are **verified**. It deliberately does
**not** carry the default flip itself, because that could not be verified inside the time box, and a
half-verified default flip must not ship. The flip is preserved, complete, on
`wip/floors-default-flip` for you to finish.

Nothing in this document changes what `main` does today: **on `main`, floors and laws are still OFF
by default.**

---

## 1. What is on this branch

| Change | Files | Verified |
| --- | --- | --- |
| The demo tuning preset, merged | `src/sim/tuning.ts`, `docs/TUNING.md`, 4 test files | `npm run check` green |
| Crystal Tide laws softened so the fixture is demo-viable | `fixtures/worlds/crystal-tide.json` | `npm run check` green, difficulty report, co-op e2e 28/28 |
| The evidence for both | `docs/TUNING_DEMO_PRESET.md` §5 | — |
| This document | `docs/RELEASE_FLOORS_DEFAULT.md` | — |

### Merge command

```sh
git fetch && git merge --no-ff origin/release/floors-default
```

This is a constants-and-one-fixture change. It alters difficulty; it does not alter defaults,
flags, or which code path runs.

---

## 2. Evidence, per step

### Step 1 — demo tuning preset merged — **PASS**

`git merge origin/tuning/demo-preset` (constants only, plus the six test files that came with it).
`npm run check` green: typecheck, 1080 tests, build.

### Step 2 — Crystal Tide made demo-viable — **PASS on survival, SHORT on the boss**

Full tables in `docs/TUNING_DEMO_PRESET.md` §5. Headline numbers, 10 seeds × 4 classes × 3 fixtures:

- **Biome-1 survival ≥ 90 % for every class on all three fixtures — MET.** Crystal Tide is 100 %
  for all four classes; the worst cell anywhere is 90 % (Vantage Spire bastion).
- **Solo Custodian ≥ 60 % for every class — NOT MET.** Overall improved 78 % → 83 % and the worst
  class/fixture improved 20 % → 40 %, but Crystal Tide bastion (50 %) and beacon (40 %) are short.

The target is unreachable by editing that fixture's laws, and the report proves it: with the
authored laws stripped entirely, Crystal Tide still measures beacon 30 % and shade 40 %. The
residual difficulty is in the tier-4 encounter and the finale bot, not in `crystal-tide.json`.
**Practical consequence for the demo:** biome 1 — the part a demo actually plays — is 100 % safe on
every fixture. Drive a *solo* finale on Vantage Spire or Root Archive (90–100 % every class), or run
the Custodian in co-op.

### Step 3 — flip the defaults — **REVERTED, on `wip/floors-default-flip`**

The change itself is written and complete. It is not here because of what `npm run check` said:

> **50 failing tests across 16 files** pin the flags-off default.

`tests/integration/`: `server-flags` (4), `provider-config` (6), `local-session-readiness` (11),
`streaming` (4), `readiness-controller` (5), `offline-memory` (2), `chronicle-readiness` (1),
`headquarters-controller` (1), `server` (2). `tests/sim/`: `laws` (1), `gameplay` (5), `effects` (3),
`pits` (1), `finale-patterns` (1). `tests/generation/floors-service` (1).
`tests/presentation/hub-state` (2).

Every one of those needs the flags set **OFF explicitly** rather than relying on the default, and
new tests are owed for the new defaults and for the off switches. That work plus the step-4 release
verification did not fit in the time box.

### Step 4 — release verification — **partly run, against what this branch actually ships**

Because the flip is not in the branch, the floors-on half of the matrix could not be run. What was
run is the verification of the change that *is* shipping — the preset plus the Crystal Tide laws —
on the legacy path that `main` serves today:

| Check | Result |
| --- | --- |
| `npm run check` after the preset merge | **PASS** |
| `npm run check` after the Crystal Tide change | **PASS** — 89 files, 1080 tests |
| `npm run check` after merging `origin/main` | **PASS** — 89 files, 1080 tests |
| `node scripts/coop-e2e.mjs` default groups (lobby, demo, reconnect) | **PASS — 28/28 checkpoints, 0 skipped, exit 0** |
| `node scripts/solo-e2e.mjs` default groups (hub, biome, attune, deep) | 15/21, exit 1 — **no regression; see below** |

The co-op run covers the lobby (4-player cap and refusal), class pick, shared idea board, the
host-only Prepare and portal gate, the 2/2 READY gate, position sync (median 56 ms), damage/HP
agreement, room clear and rewards, per-player E unlock, downed/revive (2049 ms against a 2000 ms
design), the collapse debrief, host-only Return, and all four reconnect cases including host
migration. Screenshots and `results.json` in `/tmp/relay-shots/r1/coop-default`.

**About that solo run.** `scripts/solo-e2e.mjs` sets `RELAY_FLOORS=1 RELAY_LAWS=1` itself (line 98)
unless `--legacy`, so this *was* a floors run, and it happened to prepare **Crystal Tide** — the
fixture this branch edits. That makes it worth being explicit about what failed:

- **PASS** — the whole hub and biome-1 half: floors world delivered (`floors=true`, 8 biomes), laws,
  look, custodian and terrain skins present, minimap on screen, hold-`M` full floor map, doors
  sealing while a room is hostile, more than one room kind entered, terrain tiles present. **`E1`
  no uncaught page errors over the whole session — PASS.**
- **FAIL** — `A1`/`A2` (buy a world-written attunement with run resources) and `D1`/`D2`/`D3` (keep
  playing, reach the gatekeeper, choose a biome). `D4` SKIP.

**These are pre-existing and documented, not a regression from the law change.** `docs/QA.md:69`
records the biome gate and biome choice as reached **"in CO-OP, not solo"**; FOLLOWUPS `I4` records
room-kind notes as "never seen in a browser (bot couldn't reach a floors exit)"; FOLLOWUPS `K4`
records the solo full-run bot on floors managing "0 door traversals". The solo bot has never been
able to get deep into a floors run, and the attunement checks fail downstream of that because the
bot never banks the resources. The law change cannot be the cause in the other direction either:
biome-1 survival on Crystal Tide measures 100 % for all four classes.

Someone should still confirm it against `main` before merging, since the run was not baselined
here — that is the one loose end in this branch.

**Still owed before the flip can ship** (all of it needs step 3 present): co-op e2e with floors on,
co-op e2e with `RELAY_FLOORS=0 RELAY_LAWS=0`, solo e2e default groups with floors on, cold-profile
onboarding to first combat ≤ 45 s, the static Pages-style build booting offline into a floors world
with the OFFLINE FIXTURE label, the production bundle booting with floors on, and one live
generation in a two-context co-op session. **The live co-op generation has never been observed.**

### Step 5 — the stale Render deploy — diagnosed, fix on **`fix/docker-context`**

Kept off this branch on purpose so it can merge on its own as an ordinary bug fix. See §4.

### Step 6 — docs — this file

`docs/handoffs/OVERNIGHT_REPORT.md` and `docs/PRESENTATION.md` were deliberately **not** edited:
on `main` floors is not the default, and those documents are correct as they stand.

---

## 3. Finishing the flip (what `wip/floors-default-flip` contains)

```sh
git log --oneline -1 wip/floors-default-flip   # aad666a
```

- **`src/shared/flags.ts`** — `DEFAULT_SESSION_FLAGS = { laws: true, floors: true }` plus a shared
  `readFlagValue(raw, fallback)`: `0/false/off/no` → OFF, `1/true/on/yes` → ON, anything
  unrecognised → "nobody said", so a typo cannot silently disable the headline feature.
- **`src/server/config.ts`** — both flags read through it, so `/api/config` reports ON by default.
- **`src/sim/laws.ts`** (`lawsFlagEnabled`) and **`src/client/transport/worldProviders.ts`**
  (`floorsRequested`) — precedence is: an explicit `?laws=`/`?floors=` is that browser's own
  deliberate override and wins; otherwise the server decides for the whole session; otherwise the
  default applies. That last clause is what makes the **static GitHub Pages build**, which has no
  server, boot into a floors world offline.
- **`.env.example`** — documents `RELAY_FLOORS=0` / `RELAY_LAWS=0`.

### How to turn floors and laws back OFF (all still work)

| Scope | Switch |
| --- | --- |
| Whole server / session | `RELAY_FLOORS=0` , `RELAY_LAWS=0` |
| One browser | `?floors=0` , `?laws=0` |

The legacy 3-room path is unchanged and fully playable with the flags off; that is exactly what
those switches select.

### Remaining work, in order

1. Set the flags OFF explicitly in the 16 test files listed above (they pin legacy behaviour or
   byte-identity — they should not depend on a default either way).
2. Add tests for the new defaults **and** for each off switch.
3. Run the whole of step 4. Do not merge until it is green.

---

## 4. Render is stale — what a human must click

**The image is fine.** Emulated by hand (no docker on the machine): `npm ci`, the same `COPY` set,
the same build and start command, `NODE_ENV=production`. It builds, it starts, it serves
`/api/config` with the current shape. `tsx` is a real dependency, so it survives `npm prune
--omit=dev`; the Node base image exists.

**The service has simply never re-deployed since it was first created** — 305 commits on `main` with
zero deploys. The live bundle is a single monolithic asset with no `phaser` vendor chunk, i.e. it
predates the code-splitting commit. `autoDeployTrigger: commit` in `render.yaml` is a
**Blueprint-only** field: a service created from the dashboard ignores `render.yaml` entirely, and
even a Blueprint-managed service does not pick the field up until the Blueprint is **re-synced**.

Steps:

1. Service `relay-a3yv` → **Settings** — does it say it is managed by a **Blueprint**? That single
   check closes the question.
2. **Not Blueprint-managed:** set **Auto-Deploy = Yes**, confirm **Branch = `main`**; or delete and
   re-create via **New → Blueprint**.
3. **Blueprint-managed:** open the Blueprint and **Sync / Apply changes**.
4. Check Settings → Build & Deploy still has live GitHub authorization (a revoked install silently
   kills webhooks).
5. **Manual Deploy → Clear build cache & deploy** to get the fixed image out now.
6. Confirm `ANTHROPIC_API_KEY` is set in the service Environment — `render.yaml` does not declare it
   and live generation needs it.
7. Verify: `curl https://relay-a3yv.onrender.com/api/config` returns `floors` and `laws`, and `/`
   references a separate `assets/phaser-*.js`.

**Merge `fix/docker-context` first.** It fixes a real production bug that would have bitten the
moment the deploy unstuck: the runtime stage copied only `prompts/runtime`, but
`src/server/generation/exemplars.ts` reads `prompts/exemplars/` on every live generation. That
throws `ENOENT`, which generation *catches* — so the container would have reported
`liveGenerationAvailable: true` while silently serving canned fixture worlds forever. Worse than a
crash. That branch also adds `scripts/check-docker-context.mjs`, which fails if any path the server
reads at runtime is outside the image's `COPY` set.
