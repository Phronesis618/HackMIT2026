#!/usr/bin/env node
/**
 * shot.mjs — headless screenshot tool for RELAY, so other (AI) agents can *see* the game.
 *
 * Plain ESM JS, zero project dependencies. Playwright is NOT a project dependency (per the
 * task constraints: no package.json / lockfile changes). Instead, on first run this script
 * installs playwright@1.61 into an isolated temp dir (default /tmp/relay-shot-deps) via
 * `npm install`, and requires it from there with node:module's createRequire. The Chromium
 * browser binary is installed once via `npx -y playwright@1.61 install chromium` (browsers are
 * cached by Playwright under ~/Library/Caches/ms-playwright, keyed by playwright version, so
 * this is shared across any project using the same pinned version).
 *
 * See docs/SCREENSHOTS.md for full usage, examples and gotchas.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_DEPS_DIR = '/tmp/relay-shot-deps';
const PLAYWRIGHT_SPEC = 'playwright@1.61';
// Headless Chromium has no real GPU; force the SwiftShader software rasterizer so Phaser's
// WEBGL/AUTO renderer actually draws instead of silently failing to create a context (which
// would otherwise leave the canvas black, or push Phaser onto an under-tested Canvas2D path).
const CHROMIUM_ARGS = [
  '--use-gl=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    url: '/',
    out: null,
    width: 1440,
    height: 900,
    wait: 2500,
    keys: null,
    click: null,
    fullPage: false,
    base: 'http://localhost:5173',
    startDev: false,
    coop: false,
    preset: null,
    outDir: null,
    port: null,
    serverPort: null,
    depsDir: DEFAULT_DEPS_DIR,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--url': args.url = argv[++i]; break;
      case '--out': args.out = argv[++i]; break;
      case '--width': args.width = Number(argv[++i]); break;
      case '--height': args.height = Number(argv[++i]); break;
      case '--wait': args.wait = Number(argv[++i]); break;
      case '--keys': args.keys = argv[++i]; break;
      case '--click': args.click = argv[++i]; break;
      case '--full-page': args.fullPage = true; break;
      case '--base': args.base = argv[++i]; break;
      case '--start-dev': args.startDev = true; break;
      case '--coop': args.coop = true; break;
      case '--preset': args.preset = argv[++i]; break;
      case '--out-dir': args.outDir = argv[++i]; break;
      case '--port': args.port = Number(argv[++i]); break;
      case '--server-port': args.serverPort = Number(argv[++i]); break;
      case '--deps-dir': args.depsDir = argv[++i]; break;
      case '--help':
      case '-h': args.help = true; break;
      default:
        console.error(`[shot] unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`shot.mjs — headless screenshots of the RELAY game

Usage:
  node scripts/shot.mjs --url "<path or full url>" --out <file.png> [options]
  node scripts/shot.mjs --preset audit --out-dir /tmp/relay-shots/audit [--start-dev]
  node scripts/shot.mjs --coop --out <file.png> [options]   # writes <file>-a.png / -b.png

Options:
  --url <path|url>       Path (joined to --base) or full URL. Default: /
  --out <file.png>       Output PNG path. Required unless --preset is used.
  --width <n>             Viewport width. Default: 1440
  --height <n>            Viewport height. Default: 900
  --wait <ms>             Extra settle time after the canvas appears. Default: 2500
  --keys "<seq>"          Key sequence, comma-separated. Tokens:
                            key       tap (down ~90ms, up)
                            key:ms    hold for ms then release
                            wait:ms   pause only
                          e.g. "w:600,j,shift,wait:500,Tab"
  --click "x,y"           Click viewport coordinates x,y after keys.
  --full-page             Full-page screenshot instead of viewport-only.
  --base <url>            Base URL. Default: http://localhost:5173
  --start-dev             Spawn \`npm run dev\` if nothing answers at --base; kill it on exit.
  --port <n>              Client (Vite) port to use with --start-dev (see docs/SCREENSHOTS.md
                          for why this bypasses \`npm run dev\` when set).
  --server-port <n>       Server (API/WS) port to use with --start-dev + --port.
                          Default: --port + 3614 (mirrors the repo's default 5173/8787 gap).
  --coop                  Open two isolated contexts at ?mode=coop&as=alice / &as=bob.
  --preset audit          Capture hub / combat / menu / final-room at 1280/1440/1920 widths.
  --out-dir <dir>         Output directory for --preset. Default: /tmp/relay-shots/audit
  --deps-dir <dir>        Temp install dir for playwright. Default: /tmp/relay-shot-deps
  --help                  Show this help.

Examples:
  node scripts/shot.mjs --start-dev --url "/?world=fixture&autoenter=1" \\
      --keys "d:500,j,j,wait:300,j" --out /tmp/relay-shots/combat.png
  node scripts/shot.mjs --start-dev --preset audit --out-dir /tmp/relay-shots/audit
  node scripts/shot.mjs --start-dev --coop --out /tmp/relay-shots/coop.png
`);
}

// ---------------------------------------------------------------------------------------------
// Dependency bootstrap (playwright + chromium), isolated from the repo's package.json/lockfile
// ---------------------------------------------------------------------------------------------

function execInherit(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function ensurePlaywright(depsDir) {
  const pkgDir = path.join(depsDir, 'node_modules', 'playwright');
  if (!fs.existsSync(pkgDir)) {
    await fs.promises.mkdir(depsDir, { recursive: true });
    const pkgJson = path.join(depsDir, 'package.json');
    if (!fs.existsSync(pkgJson)) {
      await fs.promises.writeFile(
        pkgJson,
        JSON.stringify({ name: 'relay-shot-deps', private: true, version: '0.0.0' }, null, 2),
      );
    }
    console.error(`[shot] installing ${PLAYWRIGHT_SPEC} into ${depsDir} (one-time)...`);
    await execInherit('npm', ['install', PLAYWRIGHT_SPEC, '--no-audit', '--no-fund'], { cwd: depsDir });
  }
  const require = createRequire(path.join(depsDir, 'package.json'));
  return require('playwright');
}

async function ensureChromium(depsDir) {
  const marker = path.join(depsDir, '.chromium-installed');
  if (fs.existsSync(marker)) return;
  console.error(`[shot] installing chromium via \`npx -y ${PLAYWRIGHT_SPEC} install chromium\` (one-time)...`);
  await execInherit('npx', ['-y', PLAYWRIGHT_SPEC, 'install', 'chromium'], { cwd: depsDir });
  await fs.promises.writeFile(marker, new Date().toISOString());
}

// ---------------------------------------------------------------------------------------------
// Dev server management
// ---------------------------------------------------------------------------------------------

async function isReachable(url, timeoutMs = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForCondition(fn, { timeoutMs = 45000, intervalMs = 500, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

function spawnTracked(cmd, args, opts, cleanupFns) {
  const child = spawn(cmd, args, { ...opts, detached: process.platform !== 'win32' });
  child.stdout?.on('data', (d) => process.stderr.write(`[dev:${cmd}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[dev:${cmd}] ${d}`));
  let killed = false;
  cleanupFns.push(() => {
    if (killed) return;
    killed = true;
    try {
      if (process.platform !== 'win32' && typeof child.pid === 'number') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  });
  return child;
}

/**
 * Ensures a dev server is reachable and returns the base URL to use.
 *
 * Port handling (see docs/SCREENSHOTS.md "ports" section for the full story):
 *  - No --port: spawns `npm run dev` verbatim (client :5173, server :8787, per the repo's
 *    hardcoded vite.config.ts / default config.ts). This is what the task asked for literally.
 *  - --port <n>: the repo's `npm run dev` script does NOT forward CLI args to Vite (it's a
 *    fixed `concurrently "npm:dev:server" "npm:dev:client"`), so a custom client port can't be
 *    obtained through it. Instead we spawn `vite --port <n> --strictPort` and
 *    `tsx watch src/server/index.ts` directly with PORT=<serverPort> — both are the exact
 *    commands `npm run dev` itself runs, just invoked with the CLI flags Vite already supports
 *    and the PORT env var src/server/config.ts already reads. --server-port overrides the
 *    server port; default is --port + 3614 (the repo's own 8787-5173 gap).
 */
async function ensureDevServer({ base, startDev, port, serverPort, coop, cleanupFns }) {
  const clientPort = port ?? Number(new URL(base).port || 5173);
  const effectiveBase = port ? `http://localhost:${clientPort}` : base;
  const srvPort = serverPort ?? (port ? port + 3614 : Number(process.env.PORT) || 8787);
  const serverHealth = `http://127.0.0.1:${srvPort}/api/health`;

  const clientUp = await isReachable(effectiveBase);
  const serverUp = await isReachable(serverHealth);
  if (clientUp && (!coop || serverUp)) {
    console.error(`[shot] reusing already-running dev server at ${effectiveBase}`);
    return effectiveBase;
  }

  if (!startDev) {
    throw new Error(
      `Nothing reachable at ${effectiveBase}${coop ? ` (or server health at ${serverHealth})` : ''}. ` +
        'Pass --start-dev to launch it, or start `npm run dev` yourself first.',
    );
  }

  console.error(`[shot] starting dev server (client :${clientPort}, server :${srvPort})...`);
  if (port) {
    // Both processes need PORT=<srvPort>: the server binds to it, and vite.config.ts reads
    // the same env var to pick its /api + /ws proxy target — without it here, vite would keep
    // proxying to the default 8787 even though the server bound to srvPort.
    const devEnv = { ...process.env, PORT: String(srvPort) };
    spawnTracked('npx', ['vite', '--port', String(clientPort), '--strictPort'], { cwd: REPO_ROOT, env: devEnv }, cleanupFns);
    spawnTracked('npx', ['tsx', 'watch', 'src/server/index.ts'], { cwd: REPO_ROOT, env: devEnv }, cleanupFns);
  } else {
    spawnTracked('npm', ['run', 'dev'], { cwd: REPO_ROOT, env: process.env }, cleanupFns);
  }

  await waitForCondition(() => isReachable(effectiveBase), { label: `client at ${effectiveBase}` });
  await waitForCondition(() => isReachable(serverHealth), { label: `server health at ${serverHealth}` });
  console.error(`[shot] dev server ready at ${effectiveBase}`);
  return effectiveBase;
}

// ---------------------------------------------------------------------------------------------
// Keyboard helpers
// ---------------------------------------------------------------------------------------------

const KEY_ALIASES = {
  shift: 'Shift',
  space: 'Space',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/** Playwright key names map to physical keys the same way the game reads e.code (KeyW, ShiftLeft, ...). */
function normalizeKey(raw) {
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (raw.length === 1) return raw.toLowerCase();
  return raw;
}

async function focusStage(page) {
  const stage = page.locator('.stage');
  await stage.waitFor({ state: 'attached', timeout: 15000 });
  // .focus() (not a click) so we don't spuriously trigger the game's pointerdown-attack handler.
  await stage.focus();
}

async function runKeys(page, spec) {
  await focusStage(page);
  const tokens = spec.split(',').map((s) => s.trim()).filter(Boolean);
  for (const token of tokens) {
    const idx = token.indexOf(':');
    const name = idx === -1 ? token : token.slice(0, idx);
    const msRaw = idx === -1 ? null : token.slice(idx + 1);
    if (name.toLowerCase() === 'wait') {
      await page.waitForTimeout(Number(msRaw) || 500);
      continue;
    }
    const key = normalizeKey(name);
    const holdMs = msRaw !== null ? Number(msRaw) || 150 : 90;
    await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
  }
}

// ---------------------------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------------------------

async function shootOnce(browser, { base, urlPath, width, height, waitMs, keys, click, fullPage, out }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[console:error] ${urlPath} :: ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.error(`[pageerror] ${urlPath} :: ${err.message}`));

  const target = /^https?:\/\//.test(urlPath) ? urlPath : `${base}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const canvasAppeared = await page
    .waitForSelector('.stage canvas', { timeout: 20000 })
    .then(() => true)
    .catch((err) => {
      console.error(`[shot] WARNING: canvas did not appear for ${target}: ${err.message}`);
      return false;
    });

  await page.waitForTimeout(waitMs);

  if (keys) await runKeys(page, keys);
  if (click) {
    const [cx, cy] = click.split(',').map((n) => Number(n.trim()));
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(200);
  }

  await fs.promises.mkdir(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage });

  if (canvasAppeared) {
    const box = await page.locator('.stage canvas').boundingBox().catch(() => null);
    if (!box || box.width === 0 || box.height === 0) {
      console.error(`[shot] WARNING: canvas has zero size for ${target} — the game likely failed to mount.`);
    }
  }

  console.error(`[shot] saved ${out}`);
  await context.close();
}

async function runAudit(browser, base, outDir) {
  const widths = [1280, 1440, 1920];
  const heightFor = (w) => Math.round((w * 900) / 1440);
  for (const width of widths) {
    const height = heightFor(width);
    await shootOnce(browser, {
      base, urlPath: '/', width, height, waitMs: 2500, keys: null, click: null, fullPage: false,
      out: path.join(outDir, `hub-${width}.png`),
    });
    await shootOnce(browser, {
      base, urlPath: '/?world=fixture&autoenter=1', width, height, waitMs: 2200,
      keys: 'd:500,w:300,j,wait:150,j,wait:150,j,wait:500', click: null, fullPage: false,
      out: path.join(outDir, `combat-${width}.png`),
    });
    await shootOnce(browser, {
      base, urlPath: '/?world=fixture&autoenter=1', width, height, waitMs: 1800,
      keys: 'Tab,wait:500', click: null, fullPage: false,
      out: path.join(outDir, `menu-${width}.png`),
    });
    await shootOnce(browser, {
      base, urlPath: '/?world=fixture&room=2', width, height, waitMs: 2500, keys: null, click: null, fullPage: false,
      out: path.join(outDir, `final-${width}.png`),
    });
  }
}

async function runCoop(browser, { base, outBase, width, height, waitMs, keys, click, fullPage }) {
  for (const [suffix, name] of [['a', 'alice'], ['b', 'bob']]) {
    await shootOnce(browser, {
      base, urlPath: `/?mode=coop&as=${name}`, width, height, waitMs, keys, click, fullPage,
      out: `${outBase}-${suffix}.png`,
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const cleanupFns = [];
  let cleaned = false;
  const runCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const fn of cleanupFns) fn();
  };
  process.on('exit', runCleanup);
  process.on('SIGINT', () => process.exit(1));
  process.on('SIGTERM', () => process.exit(1));

  const base = await ensureDevServer({
    base: args.base,
    startDev: args.startDev,
    port: args.port,
    serverPort: args.serverPort,
    coop: args.coop || args.preset === 'coop',
    cleanupFns,
  });

  const playwright = await ensurePlaywright(args.depsDir);
  await ensureChromium(args.depsDir);

  const browser = await playwright.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    if (args.preset === 'audit') {
      const outDir = args.outDir || '/tmp/relay-shots/audit';
      await fs.promises.mkdir(outDir, { recursive: true });
      await runAudit(browser, base, outDir);
    } else if (args.coop) {
      if (!args.out) throw new Error('--coop requires --out (writes <out>-a.png / <out>-b.png)');
      const outBase = args.out.replace(/\.png$/i, '');
      await runCoop(browser, {
        base, outBase, width: args.width, height: args.height, waitMs: args.wait,
        keys: args.keys, click: args.click, fullPage: args.fullPage,
      });
    } else {
      if (!args.out) throw new Error('--out is required (or use --preset audit)');
      await shootOnce(browser, {
        base, urlPath: args.url, width: args.width, height: args.height, waitMs: args.wait,
        keys: args.keys, click: args.click, fullPage: args.fullPage, out: args.out,
      });
    }
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[shot] FATAL:', err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  });
