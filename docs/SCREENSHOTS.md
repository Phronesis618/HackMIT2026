# Headless screenshots (`scripts/shot.mjs`)

A dependency-free (from the repo's point of view) headless screenshot tool so an AI agent can
*see* the running game without a display. Plain ESM JS — no TypeScript, no changes to
`package.json` or the lockfile.

## Quick start

```sh
# One-off, against a dev server you already have running on :5173/:8787:
node scripts/shot.mjs --url "/?world=fixture&autoenter=1" --out /tmp/relay-shots/room1.png

# Same, but let the script start/stop `npm run dev` for you:
node scripts/shot.mjs --start-dev --url "/?world=fixture&autoenter=1" \
  --keys "d:500,j,j,wait:300,j" --out /tmp/relay-shots/combat.png

# Standard audit set (hub, combat, menu, final room × 1280/1440/1920 widths):
node scripts/shot.mjs --start-dev --preset audit --out-dir /tmp/relay-shots/audit

# Co-op: two isolated browser contexts, alice + bob, same session:
node scripts/shot.mjs --start-dev --coop --out /tmp/relay-shots/coop.png
# -> writes /tmp/relay-shots/coop-a.png and /tmp/relay-shots/coop-b.png
```

Output goes under `/tmp/relay-shots/` by convention — **never commit PNGs**.

## How dependencies work

Playwright is intentionally **not** a project dependency. On first run, `shot.mjs`:

1. `npm install playwright@1.61` into an isolated temp dir (default `/tmp/relay-shot-deps`,
   override with `--deps-dir`) and `require()`s it from there via `node:module`'s
   `createRequire`. Nothing is written to this repo's `package.json`/`package-lock.json`.
2. Runs `npx -y playwright@1.61 install chromium` once (marked by a `.chromium-installed` file
   in the deps dir) to download the Chromium binary into Playwright's normal global cache
   (`~/Library/Caches/ms-playwright`, shared across projects/versions).

Both steps are cached — subsequent runs skip straight to launching the browser.

## CLI reference

```
--url <path|url>     Path (joined to --base) or full URL. Default: /
--out <file.png>     Output PNG. Required unless --preset is used.
--width <n>          Viewport width. Default: 1440
--height <n>         Viewport height. Default: 900
--wait <ms>          Extra settle time after the canvas appears. Default: 2500
--keys "<seq>"       Key sequence, comma-separated. See below.
--click "x,y"        Click viewport coordinates x,y (after --keys).
--full-page          Full-page screenshot instead of viewport-only.
--base <url>         Base URL. Default: http://localhost:5173
--start-dev          Spawn a dev server if nothing answers at --base; kill it on exit.
--port <n>           Client (Vite) port for --start-dev (see "Ports" below).
--server-port <n>    Server (API/WS) port for --start-dev + --port. Default: --port + 3614.
--coop                Open two isolated contexts at ?mode=coop&as=alice / &as=bob.
--preset audit        Capture hub / combat / menu / final-room at 1280/1440/1920 widths.
--out-dir <dir>       Output dir for --preset. Default: /tmp/relay-shots/audit
--deps-dir <dir>      Temp install dir for playwright. Default: /tmp/relay-shot-deps
--help
```

### `--keys` syntax

Comma-separated tokens, run in order. The canvas/page is focused (`.stage` element, via
`.focus()` — not a click, so it doesn't trigger the game's attack-on-click handler) before the
first token runs.

- `key` — tap (key down ~90ms, then up)
- `key:ms` — hold the key for `ms` milliseconds, then release
- `wait:ms` — pause only, no key event

Example: `"w:600,j,shift,wait:500,Tab"` — hold W (move) for 600ms, tap J (attack), tap Shift
(dash), wait 500ms, tap Tab (open the game menu).

Key names map onto the game's `KeyboardEvent.code` bindings (`src/shared/conventions.ts`
`INPUT_BINDINGS`) the same way Playwright's keyboard layer already does: single letters (`w`,
`j`, `q`, `e`, `r`, `f`) → `KeyW`/`KeyJ`/etc., plus aliases `shift`, `space`, `tab`, `esc`,
`enter`, `up`/`down`/`left`/`right`, `ctrl`, `alt`. Anything else (e.g. `ArrowUp`, `F1`) is
passed straight to Playwright.

### Useful URLs

- `/` — headquarters hub
- `/?world=fixture&autoenter=1` — straight into room 1 (offline fixture world, no server needed)
- `/?world=fixture&room=2` — final room (0-indexed; room 2 = the 3rd/last room)
- `/?mode=coop&as=alice` — co-op, per-tab identity `alice` (needs the WS server, see `--coop`)

## Ports

`--start-dev` (no `--port`) runs `npm run dev` **verbatim**: client on `:5173`, server on
`:8787`, per the repo's `vite.config.ts` / `src/server/config.ts` defaults, and waits for both
to answer before proceeding.

**Limitation:** the repo's `npm run dev` is a fixed
`concurrently "npm:dev:server" "npm:dev:client"` — it does not forward CLI args to Vite, so you
cannot get a different *client* port through it. `vite.config.ts` also hardcodes
`server.port: 5173` (with `strictPort: false`, so Vite will silently rebind to a random free
port if `5173` is busy — which breaks a script that assumes `:5173`).

When you pass **`--port <n>`**, `shot.mjs` sidesteps `npm run dev` and instead spawns the exact
two processes it would have (`vite --port <n> --strictPort` and
`tsx watch src/server/index.ts`), both with `PORT=<serverPort>` in their environment — the same
env var `src/server/config.ts` already reads for the server's own port *and* that
`vite.config.ts` reads to pick its `/api` + `/ws` proxy target. This is how multiple worktrees
can run `shot.mjs --start-dev --port <n>` in parallel without colliding. `--server-port`
overrides the derived server port directly (default: `--port + 3614`, mirroring the repo's own
`8787 - 5173` gap).

If `--start-dev` finds something already answering at `--base` (and, for `--coop`, the server's
`/api/health` also answers), it reuses that instance and spawns nothing.

If you're not using `--start-dev` at all, just point `--base`/`--url` at whatever port your
already-running dev server is actually on.

## Phaser / headless-Chromium gotcha

Headless Chromium has no real GPU, so Phaser's `Phaser.AUTO` renderer can fail to get a WebGL
context (or, worse, silently render a black canvas) unless Chromium is launched with a software
rasterizer:

```
--use-gl=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader --disable-gpu-sandbox
```

`shot.mjs` always launches with these flags. It also waits for `.stage canvas` to appear and,
after the screenshot, checks the canvas's bounding box is non-zero, printing a `WARNING` to
stderr if the game apparently failed to mount. It does **not** pixel-sample the PNG for
"is it actually black" — that check was done manually (`Read`-ing the generated PNGs) while
building this tool; if you're not sure the game rendered, look at the PNG.

All `console.error`-level messages and uncaught page errors are printed to stderr, prefixed
`[console:error]` / `[pageerror]`, so a caller piping this script's output can tell rendering
problems apart from a successful run.

## Verified

`--preset audit` was run and every PNG (hub / combat / menu / final-room × 1280/1440/1920 = 12
images) was inspected with the `Read` tool: the game canvas renders visibly (not black), the top
bar, right-side panel (hub) / HUD + ability bar (in-room), and the game menu (`Tab`) all show up
correctly at every width. `--coop` was also verified against a real running server: both
`alice`/`bob` screenshots show `SHARED CREW 2/4`, confirming the two isolated contexts are
genuinely talking to the same WebSocket session.
