#!/usr/bin/env node
/**
 * coop-e2e.mjs — scripted, real-input co-op verification for RELAY.
 *
 * Drives N isolated headless browser contexts (`?mode=coop&as=<name>`) with REAL keyboard and
 * mouse input only. State is read (read-only) from the DOM and from the `window.relay` debug
 * handle the client already exposes ({ session, controller, store }); nothing is injected and
 * no production test hooks exist. Every checkpoint takes a screenshot per player and the run
 * ends with a PASS/FAIL table (also written to <out>/results.json).
 *
 * Playwright is bootstrapped exactly like scripts/shot.mjs (isolated /tmp/relay-shot-deps).
 * See docs/SCREENSHOTS.md ("Co-op end-to-end") and docs/QA_COOP.md.
 *
 *   node scripts/coop-e2e.mjs                      # demo path: lobby, classes, world, sync, combat, revive, collapse
 *   node scripts/coop-e2e.mjs --only lobby,world   # pick groups: lobby,demo,reconnect,fullrun,floors
 *   node scripts/coop-e2e.mjs --floors             # RELAY_FLOORS=1 on the spawned server + floors group
 *   node scripts/coop-e2e.mjs --env KEY=VALUE      # extra env for the spawned server (repeatable)
 *   node scripts/coop-e2e.mjs --base http://192.168.1.20:8080 --only lobby,demo   # against a running server (LAN check)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PLAYWRIGHT_SPEC = 'playwright@1.61';
const CHROMIUM_ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'];
const TILE = 32;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    port: 5973, serverPort: null, base: null, outDir: '/tmp/relay-shots/coop', depsDir: '/tmp/relay-shot-deps',
    only: null, floors: false, env: {}, width: 1280, height: 800, help: false, fullRunMinutes: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--port': args.port = Number(argv[++i]); break;
      case '--server-port': args.serverPort = Number(argv[++i]); break;
      case '--base': args.base = argv[++i].replace(/\/$/, ''); break;
      case '--out-dir': args.outDir = argv[++i]; break;
      case '--deps-dir': args.depsDir = argv[++i]; break;
      case '--only': args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--floors': args.floors = true; break;
      case '--full-run-minutes': args.fullRunMinutes = Number(argv[++i]); break;
      case '--env': {
        const pair = argv[++i] ?? '';
        const eq = pair.indexOf('=');
        if (eq <= 0) throw new Error('--env expects KEY=VALUE');
        args.env[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      case '--help': case '-h': args.help = true; break;
      default: console.error(`[coop] unknown argument: ${a}`); process.exit(1);
    }
  }
  if (args.floors) args.env.RELAY_FLOORS = '1';
  return args;
}

const HELP = `coop-e2e.mjs — scripted two/four-browser co-op verification (real input only)

  --only <groups>          Comma list of: lobby, demo, reconnect, fullrun, floors. Default: lobby,demo,reconnect
  --floors                 Spawn the server with RELAY_FLOORS=1 and run the floors group (default --only floors)
  --env KEY=VALUE          Extra env passed to the spawned server (repeatable)
  --port <n>               Vite client port. Default 5973
  --server-port <n>        API/WS port. Default port + 3614
  --base <url>             Use an already-running server (no spawn, no restarts), e.g. a LAN production build
  --out-dir <dir>          Screenshots + results.json. Default /tmp/relay-shots/coop
  --full-run-minutes <n>   Time budget for the three-room + boss attempt. Default 8
`;

// ---------------------------------------------------------------------------------------------
// Playwright bootstrap (same isolated install as shot.mjs)
// ---------------------------------------------------------------------------------------------

function execInherit(cmd, cmdArgs, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { ...opts, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
    child.on('error', reject);
  });
}

async function ensurePlaywright(depsDir) {
  if (!fs.existsSync(path.join(depsDir, 'node_modules', 'playwright'))) {
    await fs.promises.mkdir(depsDir, { recursive: true });
    const pkgJson = path.join(depsDir, 'package.json');
    if (!fs.existsSync(pkgJson)) await fs.promises.writeFile(pkgJson, JSON.stringify({ name: 'relay-shot-deps', private: true, version: '0.0.0' }));
    await execInherit('npm', ['install', PLAYWRIGHT_SPEC, '--no-audit', '--no-fund'], { cwd: depsDir });
  }
  const marker = path.join(depsDir, '.chromium-installed');
  if (!fs.existsSync(marker)) {
    await execInherit('npx', ['-y', PLAYWRIGHT_SPEC, 'install', 'chromium'], { cwd: depsDir });
    await fs.promises.writeFile(marker, new Date().toISOString());
  }
  return createRequire(path.join(depsDir, 'package.json'))('playwright');
}

// ---------------------------------------------------------------------------------------------
// Dev server management (vite on --port, API/WS server restartable between scenario groups)
// ---------------------------------------------------------------------------------------------

async function isReachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).status < 500;
  } catch {
    return false;
  }
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 100, label = 'condition' } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

class Servers {
  constructor(args) {
    this.args = args;
    this.external = Boolean(args.base);
    this.base = args.base ?? `http://localhost:${args.port}`;
    this.serverPort = args.serverPort ?? args.port + 3614;
    this.children = [];
    this.server = null;
  }

  spawnTracked(cmd, cmdArgs, env, tag) {
    const child = spawn(cmd, cmdArgs, { cwd: REPO_ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const logFile = fs.createWriteStream(path.join(this.args.outDir, `${tag}.log`), { flags: 'a' });
    child.stdout.pipe(logFile);
    child.stderr.pipe(logFile);
    this.children.push(child);
    return child;
  }

  static kill(child) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch { /* already gone */ }
  }

  async start() {
    if (this.external) {
      if (!(await isReachable(`${this.base}/api/health`))) throw new Error(`nothing reachable at ${this.base}/api/health`);
      return;
    }
    if (await isReachable(this.base)) throw new Error(`port ${this.args.port} is already in use; pick another --port`);
    const env = { ...process.env, ...this.args.env, PORT: String(this.serverPort) };
    this.env = env;
    this.spawnTracked('npx', ['vite', '--port', String(this.args.port), '--strictPort'], env, 'vite');
    await this.startServer();
    await waitFor(() => isReachable(this.base), { timeoutMs: 45000, intervalMs: 400, label: 'vite' });
  }

  async startServer() {
    this.server = this.spawnTracked('npx', ['tsx', 'src/server/index.ts'], this.env, 'server');
    await waitFor(() => isReachable(`http://127.0.0.1:${this.serverPort}/api/health`), { timeoutMs: 45000, intervalMs: 300, label: 'server health' });
  }

  /** Fresh lobby/sim between scenario groups (one server process = one shared session). */
  async restartServer() {
    if (this.external) return false;
    Servers.kill(this.server);
    await waitFor(async () => !(await isReachable(`http://127.0.0.1:${this.serverPort}/api/health`)), { label: 'server stop' });
    await this.startServer();
    return true;
  }

  stopAll() {
    for (const child of this.children) Servers.kill(child);
  }
}

// ---------------------------------------------------------------------------------------------
// Player: one isolated browser context, driven with real input
// ---------------------------------------------------------------------------------------------

/** Runs in the page. READ-ONLY view of what the client already exposes on window.relay. */
function readRelay() {
  const r = window.relay;
  if (!r) return null;
  const snap = r.session.getSnapshot();
  const ui = r.store.get();
  const world = r.session.getWorld();
  let room = null;
  if (snap && world && snap.phase !== 'headquarters') {
    if (snap.floor) {
      try {
        room = r.controller.floorRooms?.provider.getRoom({ biomeId: snap.floor.biomeId, roomId: snap.floor.roomId }) ?? null;
      } catch { room = null; }
    } else if (snap.roomIndex !== null) room = world.rooms[snap.roomIndex] ?? null;
  }
  return {
    now: Date.now(),
    id: r.session.localPlayerId,
    conn: r.session.getConnectionStatus(),
    isHost: r.session.getIsHost(),
    lobby: r.session.getLobby(),
    snap,
    room: room && { id: room.id, index: room.index, width: room.width, height: room.height, tiles: room.tiles, props: room.props, exits: room.exits, isFinal: room.isFinal, anchorRelays: room.anchorRelays ?? null, kind: room.kind ?? null },
    worldId: world?.worldId ?? null,
    ui: {
      phase: ui.phase, notice: ui.notice, memories: ui.memories.length, room: ui.room,
      players: ui.players, contributions: ui.contributions.map((c) => `${c.playerName}: ${c.text}`),
      world: ui.world && { title: ui.world.title, label: ui.world.provenance.label, source: ui.world.provenance.source, receipt: ui.world.receipt.lines.map((l) => `${l.playerName}: ${l.text}`) },
    },
  };
}

/** Runs in the page: what a human would actually read on screen. */
function readDom() {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const all = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.trim());
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));
  return {
    badge: text('.badge--conn'),
    crew: all('.panel--hq .generation .eyebrow')[0] ?? null,
    crewNames: all('.panel--hq .generation .muted')[0] ?? null,
    contributions: all('.contributions .list__item'),
    worldTitle: text('.panel--world .panel__title'),
    provenance: text('.topbar__status .badge:not(.badge--conn):not(.badge--preview)'),
    receipt: all('.panel--world .notes .list__item'),
    prepareDisabled: button('Prepare')?.disabled ?? null,
    enterDisabled: button('Enter portal')?.disabled ?? null,
    returnDisabled: button('Return to headquarters')?.disabled ?? null,
    debriefTitle: text('#debrief-title'),
    debriefOutcome: text('.debrief__outcome'),
    notice: text('.notice span'),
    telemetry: text('.brand__telemetry'),
    caption: text('.stage-caption'),
    unlockButton: Boolean(button('Unlock')),
    bodyText: document.body.innerText.slice(0, 4000),
  };
}

const MOVE_KEYS = { up: 'w', down: 's', left: 'a', right: 'd' };

class Player {
  constructor(browser, base, name, size, outDir) {
    Object.assign(this, { browser, base, name, size, outDir });
    this.held = new Set();
    this.context = null;
    this.page = null;
    this.errors = [];
  }

  async open({ freshContext = true } = {}) {
    if (freshContext || !this.context) {
      this.context = await this.browser.newContext({ viewport: this.size, deviceScaleFactor: 1 });
      this.page = await this.context.newPage();
      this.page.on('pageerror', (err) => this.errors.push(`pageerror: ${err.message}`));
      this.page.on('console', (msg) => { if (msg.type() === 'error') this.errors.push(`console: ${msg.text().slice(0, 200)}`); });
    }
    this.held.clear();
    await this.page.goto(`${this.base}/?mode=coop&as=${this.name}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.canvasMounted = await this.page.waitForSelector('.stage canvas', { state: 'attached', timeout: 20000 }).then(() => true).catch(() => false);
    if (!this.canvasMounted) console.log(`[coop] WARNING ${this.name}: no canvas after 20 s; errors=${JSON.stringify(this.errors.slice(0, 4))}`);
    return this;
  }

  async close() {
    await this.context?.close().catch(() => {});
    this.context = null;
    this.page = null;
  }

  read() { return this.page.evaluate(readRelay); }
  dom() { return this.page.evaluate(readDom); }

  async me() {
    const s = await this.read();
    return s?.snap?.players.find((p) => p.id === s.id) ?? null;
  }

  async waitConnected(timeoutMs = 10000) {
    return waitFor(async () => {
      const s = await this.read();
      return s?.conn === 'connected' && s.snap ? s : null;
    }, { timeoutMs, label: `${this.name} connected` });
  }

  async shot(label) {
    if (!this.page) return null;
    const file = path.join(this.outDir, `${label}-${this.name}.png`);
    await this.page.screenshot({ path: file }).catch(() => {});
    return file;
  }

  async focusStage() {
    await this.page.locator('.stage').focus();
  }

  async setKeys(wanted) {
    for (const key of [...this.held]) if (!wanted.has(key)) { await this.page.keyboard.up(key); this.held.delete(key); }
    for (const key of wanted) if (!this.held.has(key)) { await this.page.keyboard.down(key); this.held.add(key); }
  }

  async stop() { if (this.page) await this.setKeys(new Set()); }

  async tap(key, holdMs = 70) {
    await this.page.keyboard.down(key);
    await sleep(holdMs);
    await this.page.keyboard.up(key);
  }

  /** Move the real mouse over a world position (uses the renderer's own read-only screenToWorld). */
  async aimAt(wx, wy) {
    const pos = await this.page.evaluate(({ wx, wy }) => {
      const renderer = window.relay.controller.deps.renderer;
      const canvas = document.querySelector('.stage canvas');
      const rect = canvas.getBoundingClientRect();
      const a = renderer.screenToWorld(0, 0);
      const b = renderer.screenToWorld(100, 100);
      const sx = (b.x - a.x) / 100;
      const sy = (b.y - a.y) / 100;
      if (!sx || !sy) return null;
      const px = (wx - a.x) / sx;
      const py = (wy - a.y) / sy;
      return { x: rect.left + Math.max(2, Math.min(rect.width - 2, px)), y: rect.top + Math.max(2, Math.min(rect.height - 2, py)) };
    }, { wx, wy });
    if (pos) await this.page.mouse.move(pos.x, pos.y);
  }
}

// ---------------------------------------------------------------------------------------------
// Navigation: BFS over the same tile grid the sim collides against, then steer with WASD
// ---------------------------------------------------------------------------------------------

const SOLID = new Set(['#', ' ', 'B']);
const BLOCKING_PROPS = { pillar: [1, 1], crate: [1, 1], terminal: [1, 1], crystal_cluster: [1, 1], root_mass: [2, 1], monolith_shard: [1, 2] };

function headquartersRoom() {
  const width = 30;
  const height = 20;
  const tiles = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return '#';
    if ((x === 11 || x === 19) && y < 9 && y !== 5 && y !== 6) return '#';
    if (y === 13 && ((x < 11 && x !== 6 && x !== 7) || (x > 19 && x !== 22 && x !== 23))) return '#';
    if ((x === 11 || x === 19) && y > 13 && y !== 15 && y !== 16) return '#';
    return '.';
  }).join(''));
  const stations = [[4, 3], [8, 3], [4, 7], [8, 7], [24, 4], [24, 16], [5, 16]];
  const props = [...stations.map(([x, y]) => ({ propId: 'terminal', x, y })), { propId: 'pillar', x: 13, y: 3 }, { propId: 'pillar', x: 17, y: 3 }, { propId: 'monolith_shard', x: 27, y: 6 }];
  return { width, height, tiles, props, exits: [{ x: 15, y: 18 }] };
}
const HQ_SHRINES = { bastion: [4, 3], shade: [8, 3], beacon: [4, 7], weaver: [8, 7] };

function solidGrid(room, snap) {
  const broken = new Set(snap?.terrain?.brokenWalls ?? []);
  const solid = Array.from({ length: room.height }, (_, y) => Array.from({ length: room.width }, (_, x) => {
    const ch = room.tiles[y][x];
    return ch === 'B' ? !broken.has(`${x},${y}`) : SOLID.has(ch);
  }));
  for (const prop of room.props ?? []) {
    const fp = BLOCKING_PROPS[prop.propId];
    if (!fp) continue;
    for (let dy = 0; dy < fp[1]; dy++) for (let dx = 0; dx < fp[0]; dx++) if (solid[prop.y + dy]?.[prop.x + dx] !== undefined) solid[prop.y + dy][prop.x + dx] = true;
  }
  return solid;
}

function bfs(solid, from, to) {
  const h = solid.length;
  const w = solid[0].length;
  const key = (c, r) => r * w + c;
  const prev = new Map([[key(from.col, from.row), -1]]);
  const queue = [[from.col, from.row]];
  const free = (c, r) => r >= 0 && c >= 0 && r < h && c < w && !solid[r][c];
  while (queue.length) {
    const [c, r] = queue.shift();
    if (c === to.col && r === to.row) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!free(nc, nr) || prev.has(key(nc, nr))) continue;
      if (dc && dr && (!free(c + dc, r) || !free(c, r + dr))) continue; // never cut a corner
      prev.set(key(nc, nr), key(c, r));
      queue.push([nc, nr]);
    }
  }
  if (!prev.has(key(to.col, to.row))) return null;
  const out = [];
  for (let k = key(to.col, to.row); k !== -1; k = prev.get(k)) out.unshift({ col: k % w, row: Math.floor(k / w) });
  return out;
}

const tileOf = (p) => ({ col: Math.floor(p.x / TILE), row: Math.floor(p.y / TILE) });
const centre = (t) => ({ x: t.col * TILE + TILE / 2, y: t.row * TILE + TILE / 2 });

/** One steering decision toward a world point: which WASD keys should be down right now. */
function steerKeys(room, snap, me, target, arriveDist) {
  const d = Math.hypot(target.x - me.x, target.y - me.y);
  if (d <= arriveDist) return { keys: new Set(), arrived: true };
  const solid = solidGrid(room, snap);
  const goalTile = tileOf(target);
  let goal = target;
  if (solid[goalTile.row]?.[goalTile.col] === false) {
    const route = bfs(solid, tileOf(me), goalTile);
    if (route && route.length > 1) goal = route.length === 2 ? target : centre(route[1]);
  }
  const keys = new Set();
  const dx = goal.x - me.x;
  const dy = goal.y - me.y;
  if (dx > 5) keys.add(MOVE_KEYS.right); else if (dx < -5) keys.add(MOVE_KEYS.left);
  if (dy > 5) keys.add(MOVE_KEYS.down); else if (dy < -5) keys.add(MOVE_KEYS.up);
  return { keys, arrived: false };
}

/** Walk with real key holds until within `arriveDist` of the target, a stop condition, or timeout. */
async function walkTo(player, target, { arriveDist = 10, timeoutMs = 15000, until = null, hq = false } = {}) {
  const start = Date.now();
  await player.focusStage();
  try {
    while (Date.now() - start < timeoutMs) {
      const s = await player.read();
      const me = s?.snap?.players.find((p) => p.id === s.id);
      if (!me) return false;
      if (until && until(s, me)) return true;
      const room = hq ? headquartersRoom() : s.room;
      if (!room) return false;
      const { keys, arrived } = steerKeys(room, s.snap, me, target, arriveDist);
      if (arrived) return true;
      await player.setKeys(keys);
      await sleep(40);
    }
    return false;
  } finally {
    await player.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

class Report {
  constructor(outDir) { this.outDir = outDir; this.rows = []; }
  add(id, name, status, evidence) {
    this.rows.push({ id, name, status, evidence });
    console.log(`[${status}] ${id} ${name}\n        ${evidence}`);
    fs.writeFileSync(path.join(this.outDir, 'results.json'), JSON.stringify(this.rows, null, 2));
  }
  check(id, name, ok, evidence) { this.add(id, name, ok ? 'PASS' : 'FAIL', evidence); return ok; }
  print() {
    console.log('\n=== CO-OP E2E RESULTS ===');
    for (const row of this.rows) console.log(`${row.status.padEnd(5)} ${row.id.padEnd(6)} ${row.name}`);
    const fails = this.rows.filter((r) => r.status === 'FAIL').length;
    console.log(`\n${this.rows.length - fails}/${this.rows.length} checkpoints passed; screenshots + results.json in ${this.outDir}`);
    return fails;
  }
}

const J = (value) => JSON.stringify(value);
const names = (s) => (s?.lobby?.players ?? []).map((p) => `${p.identity.displayName}${p.connected ? '' : '(off)'}`).join(',');

async function shots(players, label) {
  for (const p of players) await p.shot(label);
}

// ---------------------------------------------------------------------------------------------
// Shared flows
// ---------------------------------------------------------------------------------------------

async function contribute(player, text) {
  const area = player.page.locator('#contribution');
  await area.click();
  await area.pressSequentially(text, { delay: 5 });
  await player.page.keyboard.press('Enter');
  await player.focusStage();
}

async function prepareWorld(host, everyone) {
  await host.page.getByRole('button', { name: /^Prepare/ }).click();
  await host.focusStage();
  return Promise.all(everyone.map((p) => waitFor(async () => {
    const s = await p.read();
    const d = await p.dom();
    return s?.ui.world && d.worldTitle && s.ui.phase !== 'preparing' ? { s, d } : null;
  }, { timeoutMs: 30000, label: `${p.name} sees world` })));
}

async function enterByWalkingOntoPortal(host, everyone) {
  await walkTo(host, centre({ col: 15, row: 18 }), { hq: true, arriveDist: 4, timeoutMs: 15000, until: (s) => s.snap.phase === 'expedition' });
  return Promise.all(everyone.map((p) => waitFor(async () => {
    const s = await p.read();
    return s?.snap.phase === 'expedition' && s.ui.phase === 'expedition' ? s : null;
  }, { timeoutMs: 8000, label: `${p.name} in expedition` })));
}

/**
 * Fight like a (cautious) human: walk into reach of the nearest living enemy, keep the mouse on
 * it, tap J, use Q/E/R when offered. Returns when the room is cleared, the local player is down,
 * the run ends or the time budget is spent.
 */
async function fightUntil(player, { timeoutMs = 60000, stopWhen = null } = {}) {
  const start = Date.now();
  await player.focusStage();
  let lastAbility = 0;
  try {
    while (Date.now() - start < timeoutMs) {
      const s = await player.read();
      const me = s?.snap?.players.find((p) => p.id === s.id);
      if (!me || s.snap.phase !== 'expedition') return 'ended';
      if (stopWhen && stopWhen(s, me)) return 'stopped';
      if (me.hp <= 0) { await player.stop(); return 'downed'; }
      const living = s.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
      if (!living.length) return s.snap.roomCleared ? 'cleared' : 'no-enemies';
      const enemy = living.reduce((a, b) => (Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b));
      const d = Math.hypot(enemy.x - me.x, enemy.y - me.y);
      await player.aimAt(enemy.x, enemy.y);
      if (d > 40) {
        const { keys } = steerKeys(s.room, s.snap, me, enemy, 36);
        await player.setKeys(keys);
      } else {
        await player.setKeys(new Set());
      }
      if (d < 60 && me.attackCooldownMs <= 0) await player.tap('j', 40);
      if (d < 90 && Date.now() - lastAbility > 900) {
        lastAbility = Date.now();
        if ((me.ultCharge ?? 0) >= 100) await player.tap('r', 40);
        else if ((me.abilityQCooldownMs ?? 0) <= 0) await player.tap('q', 40);
        else if (me.abilityEUnlocked && (me.abilityECooldownMs ?? 0) <= 0) await player.tap('e', 40);
      }
      await sleep(35);
    }
    return 'timeout';
  } finally {
    await player.stop();
  }
}

/** Compare a value on every screen; returns { ok, values }. */
async function agree(players, pick) {
  const values = [];
  for (const p of players) values.push(J(pick(await p.read(), await p.dom())));
  return { ok: values.every((v) => v === values[0]), values };
}

// ---------------------------------------------------------------------------------------------
// Scenario groups
// ---------------------------------------------------------------------------------------------

async function groupLobby(ctx) {
  const { report, make } = ctx;
  const [alice, bob, carol, dave, eve] = ['alice', 'bob', 'carol', 'dave', 'eve'].map(make);
  await alice.open();
  const a1 = await alice.waitConnected();
  await bob.open();
  const b1 = await bob.waitConnected();
  await sleep(400);
  const a2 = await alice.read();
  const [ad, bd] = [await alice.dom(), await bob.dom()];
  await shots([alice, bob], 's1-two-joined');
  report.check('1a', 'two players join; host/guest roles', a2.isHost && !b1.isHost && /host/.test(ad.badge) && /crew/.test(bd.badge),
    `alice badge="${ad.badge}" bob badge="${bd.badge}"; alice first-connected isHost=${a1.isHost}`);
  report.check('1b', 'crew list matches on both screens', ad.crewNames === bd.crewNames && /alice/.test(ad.crewNames) && /bob/.test(ad.crewNames) && /2\/4/.test(ad.crew),
    `alice sees "${ad.crew}" "${ad.crewNames}"; bob sees "${bd.crew}" "${bd.crewNames}"`);

  await carol.open(); await carol.waitConnected();
  await dave.open(); await dave.waitConnected();
  await sleep(500);
  const four = await agree([alice, bob, carol, dave], (s, d) => [d.crew, d.crewNames]);
  await shots([alice, dave], 's1-four-joined');
  report.check('1c', 'third and fourth join (4/4) on every screen', four.ok && /4\/4/.test(four.values[0]), `all four screens: ${four.values[0]}`);

  await eve.open();
  await sleep(2500);
  const es = await eve.read();
  const ed = await eve.dom();
  const still = await alice.dom();
  await eve.shot('s1-fifth-refused');
  report.check('1d', 'fifth player is refused cleanly', es.conn !== 'connected' && /full/i.test(ed.notice ?? '') && /4\/4/.test(still.crew),
    `eve connection="${es.conn}" badge="${ed.badge}" notice="${ed.notice}"; host still sees "${still.crew}"; eve page errors=${eve.errors.filter((e) => e.startsWith('pageerror')).length}`);
  await eve.close();

  // Crew members leaving: the lobby must shrink back (30 s grace, 5 s sweep).
  await carol.close();
  await dave.close();
  const startedAt = Date.now();
  let pruned = null;
  try {
    pruned = await waitFor(async () => {
      const d = await alice.dom();
      return /2\/4/.test(d.crew ?? '') ? d : null;
    }, { timeoutMs: 45000, intervalMs: 500, label: 'departed crew pruned' });
  } catch { /* reported below */ }
  const bd2 = await bob.dom();
  report.check('1e', 'departed players leave the crew list', Boolean(pruned) && /2\/4/.test(bd2.crew ?? ''),
    pruned ? `back to "${pruned.crew}" "${pruned.crewNames}" after ${((Date.now() - startedAt) / 1000).toFixed(1)} s (server grace 30 s); bob sees "${bd2.crew}"` : `still "${(await alice.dom()).crew}" after 45 s`);
  ctx.alice = alice;
  ctx.bob = bob;
}

async function ensurePair(ctx) {
  if (ctx.alice?.page && ctx.bob?.page) return;
  ctx.alice = ctx.make('alice');
  ctx.bob = ctx.make('bob');
  await ctx.alice.open(); await ctx.alice.waitConnected();
  await ctx.bob.open(); await ctx.bob.waitConnected();
}

async function groupDemo(ctx) {
  const { report } = ctx;
  await ensurePair(ctx);
  const { alice, bob } = ctx;
  const pair = [alice, bob];

  // --- 2: classes. alice uses the accessible quick controls, bob walks to a shrine and presses F.
  await alice.page.locator('details.operative summary').click();
  await alice.page.getByRole('button', { name: /^Shade/ }).click();
  await alice.focusStage();
  const [sx, sy] = HQ_SHRINES.weaver;
  const reached = await walkTo(bob, centre({ col: sx + 1, row: sy + 1 }), { hq: true, arriveDist: 12, timeoutMs: 20000 });
  await bob.tap('f', 120);
  await sleep(600);
  const classes = await agree(pair, (s) => s.snap.players.map((p) => `${p.displayName}:${p.classId}`).sort());
  await shots(pair, 's2-classes');
  report.check('2', 'each picks a different class; both see both', classes.ok && /alice:shade/.test(classes.values[0]) && /bob:weaver/.test(classes.values[0]),
    `alice screen ${classes.values[0]} | bob screen ${classes.values[1]} (alice via quick-control chip, bob walked to the Weaver shrine [reached=${reached}] and pressed F)`);

  // --- 3: ideas, host-only prepare, identical world on both.
  await contribute(alice, 'a lighthouse that hums in the fog');
  await contribute(bob, 'moths made of glass');
  await sleep(600);
  const ideas = await agree(pair, (s, d) => d.contributions);
  const guestDom = await bob.dom();
  const hostDom = await alice.dom();
  // A real click on a disabled button does nothing; try it anyway, like an impatient guest would.
  await bob.page.getByRole('button', { name: /^Prepare/ }).click({ force: true, timeout: 2000 }).catch(() => {});
  await sleep(500);
  const afterGuestClick = await bob.read();
  report.check('3a', 'both ideas appear on both screens', ideas.ok && JSON.parse(ideas.values[0]).length === 2, `both screens list: ${ideas.values[0]}`);
  report.check('3b', 'guest cannot press Prepare world', guestDom.prepareDisabled === true && hostDom.prepareDisabled === false && !afterGuestClick.ui.world,
    `guest Prepare disabled=${guestDom.prepareDisabled}, host disabled=${hostDom.prepareDisabled}; forced guest click produced world=${Boolean(afterGuestClick.ui.world)}`);
  const t0 = Date.now();
  await prepareWorld(alice, pair);
  await sleep(500);
  const world = await agree(pair, (s, d) => ({ title: d.worldTitle, provenance: d.provenance, receipt: d.receipt, worldId: s.worldId }));
  await shots(pair, 's3-world-prepared');
  report.check('3c', 'host prepares; same title, provenance label, receipt on both', world.ok && JSON.parse(world.values[0]).title && JSON.parse(world.values[0]).receipt.length === 2,
    `${((Date.now() - t0) / 1000).toFixed(1)} s; both screens: ${world.values[0]}`);

  // --- 4: host walks onto the portal, the crew lands together, movement syncs.
  const entered = await enterByWalkingOntoPortal(alice, pair).catch(() => null);
  await sleep(1200);
  const where = await agree(pair, (s, d) => ({ phase: s.snap.phase, roomIndex: s.snap.roomIndex, roomId: s.snap.roomId, telemetry: d.telemetry, caption: d.caption }));
  await shots(pair, 's4-room1');
  report.check('4a', 'host walks onto portal; both land in room 1 of the same world', Boolean(entered) && where.ok && JSON.parse(where.values[0]).roomIndex === 0,
    `both screens: ${where.values[0]}`);
  if (!entered) return;

  const latencies = [];
  for (const [mover, watcher, key] of [[alice, bob, 'a'], [bob, alice, 'a'], [alice, bob, 'd'], [bob, alice, 'd']]) {
    await mover.focusStage();
    const before = (await watcher.read()).snap.players.find((p) => p.displayName === mover.name);
    const tDown = Date.now();
    await mover.page.keyboard.down(key);
    let seen = null;
    while (Date.now() - tDown < 1500) {
      const now = (await watcher.read()).snap.players.find((p) => p.displayName === mover.name);
      if (Math.abs(now.x - before.x) > 1.5) { seen = Date.now() - tDown; break; }
      await sleep(4);
    }
    await sleep(250);
    await mover.page.keyboard.up(key);
    if (seen !== null) latencies.push(seen);
    await sleep(300);
  }
  await sleep(400);
  const positions = await agree(pair, (s) => s.snap.players.map((p) => [p.displayName, Math.round(p.x), Math.round(p.y)]).sort());
  await shots(pair, 's4-after-move');
  ctx.latencies = latencies;
  report.check('4b', 'positions sync both ways; latency measured', latencies.length === 4 && positions.ok,
    `key-down -> visible on the OTHER screen: ${latencies.map((ms) => `${ms} ms`).join(', ')} (median ${latencies.slice().sort((x, y) => x - y)[Math.floor(latencies.length / 2)]} ms, localhost, includes 50 ms snapshot cadence); resting positions on both screens: ${positions.values[0]} vs ${positions.values[1]}`);

  // --- 5: combat. One hit each on the same enemy, watched from both screens.
  const hpOn = async (p, enemyId) => (await p.read()).snap.enemies.find((e) => e.id === enemyId)?.hp;
  const s0 = await alice.read();
  const target = s0.snap.enemies.find((e) => e.state !== 'dead');
  const hits = [];
  for (const attacker of pair) {
    const start = await hpOn(alice, target.id);
    await fightUntil(attacker, { timeoutMs: 20000, stopWhen: (s) => (s.snap.enemies.find((e) => e.id === target.id)?.hp ?? 0) < start });
    await sleep(250);
    hits.push({ by: attacker.name, from: start, aliceSees: await hpOn(alice, target.id), bobSees: await hpOn(bob, target.id) });
  }
  await shots(pair, 's5-both-hit');
  report.check('5a', 'both damage the same enemy; HP agrees on both screens', hits.every((h) => h.aliceSees < h.from && Math.abs(h.aliceSees - h.bobSees) <= 30),
    `enemy ${target.enemyId} (${target.id}): ${hits.map((h) => `${h.by} hit ${h.from} -> alice sees ${h.aliceSees} / bob sees ${h.bobSees}`).join('; ')} (screens sampled ~10 ms apart while the fight continues)`);

  const results = await Promise.all(pair.map((p) => fightUntil(p, { timeoutMs: 90000 })));
  await sleep(700);
  const cleared = await agree(pair, (s) => ({ cleared: s.snap.roomCleared, enemies: s.snap.enemies.map((e) => `${e.enemyId}:${e.state}:${e.hp}`), resources: s.snap.players.map((p) => `${p.displayName}:${p.resources}`).sort() }));
  await shots(pair, 's5-room-cleared');
  report.check('5b', 'enemy deaths, room clear and reward agree', cleared.ok && JSON.parse(cleared.values[0]).cleared === true,
    `fight results ${J(results)}; both screens: ${cleared.values[0]}`);

  const canUnlock = (await alice.dom()).unlockButton;
  if (canUnlock) await alice.page.getByRole('button', { name: /^Unlock/ }).click();
  await alice.focusStage();
  await sleep(600);
  const unlocked = await agree(pair, (s) => s.snap.players.map((p) => `${p.displayName}:E=${p.abilityEUnlocked}:res=${p.resources}`).sort());
  await shots(pair, 's5-unlock');
  report.check('5c', 'E unlock by one player is per-player and agrees on both', canUnlock && unlocked.ok && /alice:E=true/.test(unlocked.values[0]) && /bob:E=false/.test(unlocked.values[0]),
    `alice clicked "Unlock" (button present=${canUnlock}); both screens: ${unlocked.values[0]}`);

  // --- 7a: exit gating + moving together into room 2.
  const s1 = await alice.read();
  const exit = s1.room.exits[0];
  await walkTo(bob, centre({ col: exit.x, row: exit.y }), { arriveDist: 3, timeoutMs: 25000, until: (s) => s.snap.roomIndex === 1 });
  await sleep(1200);
  const room2 = await agree(pair, (s, d) => ({ roomIndex: s.snap.roomIndex, roomId: s.snap.roomId, caption: d.caption, players: s.snap.players.length }));
  await shots(pair, 's7-room2');
  report.check('7a', 'guest reaches the exit; the whole crew moves to room 2 together', room2.ok && JSON.parse(room2.values[0]).roomIndex === 1, `both screens: ${room2.values[0]}`);
  if (JSON.parse(room2.values[0]).roomIndex !== 1) return;

  // --- 6a: bob walks into the enemies and stands still until downed; alice clears, then holds F.
  const s2 = await bob.read();
  const foe = s2.snap.enemies[0];
  await walkTo(bob, foe, { arriveDist: 30, timeoutMs: 15000, until: (s, me) => me.hp <= 0 });
  let downed = null;
  try {
    downed = await waitFor(async () => {
      const s = await bob.read();
      const me = s.snap.players.find((p) => p.id === s.id);
      if (me.hp > 0) { // stay in the fight's face
        const near = s.snap.enemies.filter((e) => e.state !== 'dead')[0];
        if (near && Math.hypot(near.x - me.x, near.y - me.y) > 60) await walkTo(bob, near, { arriveDist: 30, timeoutMs: 1500, until: (_, m) => m.hp <= 0 });
      }
      return me.hp <= 0 ? s : null;
    }, { timeoutMs: 90000, intervalMs: 200, label: 'bob downed' });
  } catch { /* reported */ }
  await shots(pair, 's6-bob-downed');
  const downedBoth = await agree(pair, (s) => s.snap.players.map((p) => `${p.displayName}:${p.hp > 0 ? 'up' : 'down'}`).sort());
  report.check('6a', 'a downed player shows as downed on both screens', Boolean(downed) && downedBoth.ok && /bob:down/.test(downedBoth.values[0]), `both screens: ${downedBoth.values[0]}; bob HUD: ${J((await bob.read()).ui.phase)}`);

  if (downed) {
    const fight = await fightUntil(alice, { timeoutMs: 120000 });
    const s3 = await alice.read();
    const aliceUp = s3.snap.phase === 'expedition' && s3.snap.players.find((p) => p.id === s3.id).hp > 0;
    if (aliceUp) {
      const body = s3.snap.players.find((p) => p.displayName === 'bob');
      await walkTo(alice, body, { arriveDist: 34, timeoutMs: 20000 });
      await alice.focusStage();
      await alice.page.keyboard.down('f');
      let progressSeenByBob = 0;
      let revived = null;
      const tF = Date.now();
      while (Date.now() - tF < 5000) {
        const sb = await bob.read();
        const me = sb.snap.players.find((p) => p.id === sb.id);
        progressSeenByBob = Math.max(progressSeenByBob, me.reviveProgress ?? 0);
        if (me.hp > 0) { revived = Date.now() - tF; break; }
        await sleep(50);
      }
      await alice.page.keyboard.up('f');
      await sleep(400);
      const up = await agree(pair, (s) => s.snap.players.map((p) => `${p.displayName}:${p.hp}`).sort());
      await shots(pair, 's6-revived');
      report.check('6b', 'hold F revives; both see the revive', revived !== null && up.ok && /bob:40/.test(up.values[0]),
        `alice cleared the room (${fight}), walked to bob and held F: revived after ${revived} ms (design 2000 ms), max progress seen on bob's screen ${progressSeenByBob.toFixed(2)}; both screens: ${up.values[0]}`);
    } else {
      report.add('6b', 'hold F revives; both see the revive', 'SKIP', `alice did not survive clearing the room alone (${fight}); see 6c for the collapse path`);
    }
  }

  // --- 6c: both downed -> collapse debrief on both -> host returns the crew -> HQ, memories on each device.
  let s4 = await alice.read();
  if (s4.snap.phase === 'expedition') {
    if (s4.snap.roomCleared && s4.room.exits[0]) {
      const door = s4.room.exits[0];
      await walkTo(alice, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 25000, until: (s) => s.snap.roomIndex === 2 });
      await sleep(1200);
      const room3 = await agree(pair, (s) => ({ roomIndex: s.snap.roomIndex, final: s.room?.isFinal, enemies: s.snap.enemies.map((e) => e.enemyId) }));
      await shots(pair, 's7-room3');
      report.check('7b', 'host leads the crew into the final room', room3.ok && JSON.parse(room3.values[0]).roomIndex === 2, `both screens: ${room3.values[0]}`);
    }
    // Both walk into the enemies and stop fighting.
    const charge = async (p) => {
      const t = Date.now();
      while (Date.now() - t < 150000) {
        const s = await p.read();
        if (s.snap.phase !== 'expedition') return;
        const me = s.snap.players.find((q) => q.id === s.id);
        const near = s.snap.enemies.filter((e) => e.state !== 'dead')[0];
        if (me.hp > 0 && near && Math.hypot(near.x - me.x, near.y - me.y) > 50) await walkTo(p, near, { arriveDist: 30, timeoutMs: 1200, until: (_, m) => m.hp <= 0 });
        else await sleep(200);
      }
    };
    await Promise.all(pair.map(charge));
  }
  await sleep(1200);
  s4 = await alice.read();
  const debrief = await agree(pair, (s, d) => ({ phase: s.snap.phase, ui: s.ui.phase, title: d.debriefTitle, outcome: d.debriefOutcome }));
  const [hostD, guestD] = [await alice.dom(), await bob.dom()];
  await shots(pair, 's6-collapse-debrief');
  report.check('6c', 'both downed -> collapse debrief on both screens', debrief.ok && JSON.parse(debrief.values[0]).phase === 'debrief' && /collaps|fell|lost|ended/i.test(JSON.parse(debrief.values[0]).outcome ?? ''),
    `both screens: ${debrief.values[0]}`);
  report.check('6d', 'only the host can return the crew', hostD.returnDisabled === false && guestD.returnDisabled === true, `host Return disabled=${hostD.returnDisabled}; guest Return disabled=${guestD.returnDisabled}`);
  if (hostD.returnDisabled === false) await alice.page.getByRole('button', { name: /^Return to headquarters/ }).click();
  await sleep(1500);
  const home = await agree(pair, (s, d) => ({ phase: s.snap.phase, ui: s.ui.phase, telemetry: d.telemetry, hp: s.snap.players.map((p) => `${p.displayName}:${p.hp}`).sort() }));
  const mem = [(await alice.read()).ui.memories, (await bob.read()).ui.memories];
  await shots(pair, 's6-back-in-hq');
  report.check('6e', 'host returns crew -> both back in HQ; memories on each device', home.ok && JSON.parse(home.values[0]).phase === 'headquarters' && mem.every((n) => n > 0),
    `both screens: ${home.values[0]}; memory records alice=${mem[0]} bob=${mem[1]} (each browser context has its own localStorage)`);
}

async function startRun(ctx, tag) {
  const { alice, bob } = ctx;
  const pair = [alice, bob];
  const s = await alice.read();
  if (s.snap.phase !== 'headquarters') throw new Error(`startRun: expected headquarters, got ${s.snap.phase}`);
  await prepareWorld(alice, pair);
  await sleep(400);
  await alice.page.getByRole('button', { name: /^Enter portal/ }).click();
  await alice.focusStage();
  await Promise.all(pair.map((p) => waitFor(async () => ((await p.read()).ui.phase === 'expedition'), { timeoutMs: 8000, label: `${p.name} expedition (${tag})` })));
  await sleep(1000);
}

async function groupReconnect(ctx) {
  const { report, make } = ctx;
  await ensurePair(ctx);
  let { alice, bob } = ctx;
  await startRun(ctx, 'reconnect');
  // Give bob recognisable state: walk a little, remember HP/position.
  await bob.focusStage();
  await bob.page.keyboard.down('d'); await sleep(500); await bob.page.keyboard.up('d');
  await sleep(300);
  const before = (await alice.read()).snap.players.find((p) => p.displayName === 'bob');

  // --- 8a: guest reloads the tab (same sessionStorage identity, which is what `as=` keeps).
  await bob.open({ freshContext: false });
  const bs = await bob.waitConnected().catch(() => null);
  await sleep(800);
  const afterReload = await alice.read();
  const bobs = afterReload.snap.players.filter((p) => p.displayName === 'bob');
  const me = bs ? (await bob.read()).snap.players.find((p) => p.id === (bs.id)) : null;
  await shots([alice, bob], 's8-guest-reload');
  report.check('8a', 'guest reloads mid-room -> same operative, state restored', Boolean(bs) && bobs.length === 1 && bobs[0].id === before.id && Math.abs(bobs[0].x - before.x) < 40 && bs.ui.phase === 'expedition',
    `before: id=${before.id} x=${Math.round(before.x)} hp=${before.hp}; after reload host sees ${bobs.length} "bob" operative(s) ${J(bobs.map((p) => [p.id, Math.round(p.x), p.hp]))}; lobby="${names(afterReload)}"; bob's own id=${bs?.id} ui.phase=${bs?.ui.phase} sees self at ${me ? Math.round(me.x) : 'n/a'}`);

  // --- 8b: guest's browser is closed entirely and a NEW context rejoins with the same as= name.
  const before2 = (await alice.read()).snap.players.filter((p) => p.displayName === 'bob');
  await bob.close();
  await sleep(1500);
  const gone = await alice.read();
  bob = make('bob');
  ctx.bob = bob;
  await bob.open();
  const bs2 = await bob.waitConnected().catch(() => null);
  await sleep(800);
  const after2 = await alice.read();
  const bobs2 = after2.snap.players.filter((p) => p.displayName === 'bob');
  await shots([alice, bob], 's8-guest-new-context');
  report.check('8b', 'guest closes browser, rejoins with same as= -> one bob, in the room', Boolean(bs2) && bobs2.length === 1 && bs2.ui.phase === 'expedition',
    `while away host lobby="${names(gone)}"; before ${before2.length} bob(s); after rejoin host sees ${bobs2.length} "bob" operative(s) ${J(bobs2.map((p) => [p.id, Math.round(p.x), p.hp]))}; lobby="${names(after2)}"; bob ui.phase=${bs2?.ui.phase} (a new context has empty storage, so this is a NEW identity by design — it must still land in the running room)`);

  // --- 8c: HOST closes mid-room -> succession; remaining player keeps playing.
  await alice.close();
  let promoted = null;
  try {
    promoted = await waitFor(async () => {
      const s = await bob.read();
      return s.isHost ? s : null;
    }, { timeoutMs: 8000, label: 'bob promoted' });
  } catch { /* reported */ }
  const x0 = (await bob.me()).x;
  await bob.focusStage();
  await bob.page.keyboard.down('a'); await sleep(450); await bob.page.keyboard.up('a');
  await sleep(200);
  const x1 = (await bob.me()).x;
  const bd = await bob.dom();
  await bob.shot('s8-host-left');
  report.check('8c', 'host closes mid-room -> guest becomes host and keeps playing', Boolean(promoted) && /host/.test(bd.badge) && Math.abs(x1 - x0) > 5,
    `bob badge="${bd.badge}" isHost=${Boolean(promoted)}; bob moved x ${Math.round(x0)} -> ${Math.round(x1)} after the host left; lobby="${names(await bob.read())}"`);

  // --- 8d: old host rejoins as a guest, into the running room.
  alice = make('alice');
  ctx.alice = alice;
  await alice.open();
  const as = await alice.waitConnected().catch(() => null);
  await sleep(1000);
  const ad = await alice.dom();
  const as2 = await alice.read();
  const both = await agree([alice, bob], (s) => ({ phase: s.snap.phase, roomIndex: s.snap.roomIndex, host: s.lobby.hostPlayerId }));
  await shots([alice, bob], 's8-old-host-rejoined');
  report.check('8d', 'old host rejoins as crew, lands in the running room', Boolean(as) && /crew/.test(ad.badge) && both.ok && as2.ui.phase === 'expedition' && Boolean(as2.ui.world),
    `alice badge="${ad.badge}" ui.phase=${as2.ui.phase} world="${as2.ui.world?.title}"; both screens: ${both.values[0]}; lobby="${names(as2)}"`);

  // Leave the run so later groups start from HQ (bob is host now).
  await bob.page.keyboard.press('Tab').catch(() => {});
  ctx.hostName = 'bob';
}

async function groupFullRun(ctx) {
  const { report, args } = ctx;
  await ensurePair(ctx);
  const { alice, bob } = ctx;
  const pair = [alice, bob];
  await startRun(ctx, 'fullrun');
  const deadline = Date.now() + args.fullRunMinutes * 60_000;
  let furthest = 'room 1';
  let outcome = 'timeout';
  const bossPhases = new Set();
  const ritualStages = new Set();
  while (Date.now() < deadline) {
    const s = await alice.read();
    if (s.snap.phase !== 'expedition') { outcome = s.snap.phase; break; }
    furthest = `room ${s.snap.roomIndex + 1}`;
    const guardian = s.snap.enemies.find((e) => e.enemyId === 'guardian');
    if (guardian?.bossPhase) bossPhases.add(guardian.bossPhase);
    const up = s.snap.players.filter((p) => p.hp > 0);
    const down = s.snap.players.filter((p) => p.hp <= 0);
    if (!s.snap.roomCleared) {
      // Track boss phases while both fight.
      const watch = (async () => {
        while (Date.now() < deadline) {
          const w = await alice.read();
          const g = w.snap.enemies.find((e) => e.enemyId === 'guardian');
          if (g?.bossPhase) bossPhases.add(g.bossPhase);
          if (w.snap.roomCleared || w.snap.phase !== 'expedition' || w.snap.players.every((p) => p.hp <= 0)) return;
          await sleep(300);
        }
      })();
      await Promise.all([...pair.map((p) => fightUntil(p, { timeoutMs: Math.max(1000, Math.min(120000, deadline - Date.now())) })), watch]);
      continue;
    }
    if (down.length && up.length) {
      const rescuer = pair.find((p) => p.name === up[0].displayName);
      await walkTo(rescuer, down[0], { arriveDist: 34, timeoutMs: 15000 });
      await rescuer.focusStage();
      await rescuer.page.keyboard.down('f'); await sleep(2400); await rescuer.page.keyboard.up('f');
      continue;
    }
    if (!s.room.isFinal) {
      const door = s.room.exits[0];
      await walkTo(alice, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 25000, until: (q) => q.snap.roomIndex !== s.snap.roomIndex });
      await sleep(1200);
      continue;
    }
    // Final room cleared: the Anchor. Ritual = relays in order then the core; hold F at each target.
    const anchor = s.snap.anchor;
    if (!anchor) break;
    if (anchor.ritual) ritualStages.add(`${anchor.ritual.stage}:${anchor.ritual.activeRelay ?? ''}`);
    const target = anchor.ritual && anchor.ritual.stage !== 'core' && anchor.ritual.relays?.[anchor.ritual.activeRelay] ? anchor.ritual.relays[anchor.ritual.activeRelay] : anchor;
    await shots(pair, `s7-ritual-${ritualStages.size}`);
    // bob escorts, alice holds.
    await Promise.all([walkTo(alice, target, { arriveDist: 30, timeoutMs: 15000 }), walkTo(bob, target, { arriveDist: 50, timeoutMs: 15000 })]);
    await alice.focusStage();
    await alice.page.keyboard.down('f');
    const tHold = Date.now();
    while (Date.now() - tHold < 6000) {
      const q = await alice.read();
      if (q.snap.phase !== 'expedition') break;
      const r = q.snap.anchor?.ritual;
      if (r) ritualStages.add(`${r.stage}:${r.activeRelay ?? ''}`);
      if (r && (r.stage !== anchor.ritual?.stage || r.activeRelay !== anchor.ritual?.activeRelay)) break;
      await sleep(100);
    }
    await alice.page.keyboard.up('f');
  }
  await sleep(1500);
  const end = await agree(pair, (s, d) => ({ phase: s.snap.phase, anchor: s.snap.anchor?.state ?? null, title: d.debriefTitle, outcome: d.debriefOutcome }));
  await shots(pair, 's7-full-run-end');
  const parsed = JSON.parse(end.values[0]);
  report.check('7c', 'two players clear three rooms, boss phases and the three-relay ritual', end.ok && parsed.phase === 'debrief' && parsed.anchor === 'planted',
    `furthest: ${furthest}; loop outcome=${outcome}; boss phases seen=${J([...bossPhases])}; ritual stages seen=${J([...ritualStages])}; both screens: ${end.values[0]} vs ${end.values[1]}`);
  const host = ctx.hostName === 'bob' ? bob : alice;
  if (parsed.phase === 'debrief') {
    await host.page.getByRole('button', { name: /^Return to headquarters/ }).click().catch(() => {});
    await sleep(1200);
  }
}

async function groupFloors(ctx) {
  const { report } = ctx;
  await ensurePair(ctx);
  const { alice, bob } = ctx;
  const pair = [alice, bob];
  await startRun(ctx, 'floors');
  const first = await agree(pair, (s) => ({ floor: s.snap.floor ?? null, roomId: s.snap.roomId }));
  await shots(pair, 's9-floors-entrance');
  const hasFloor = Boolean(JSON.parse(first.values[0]).floor);
  report.check('9a', 'floors run: snapshot.floor present and identical on both screens', first.ok && hasFloor, `both screens: ${first.values[0].slice(0, 400)}`);
  if (!hasFloor) return;

  // Walk doors until a combat room seals; record sealing + agreement; then clear it and go on.
  let sealedSeen = null;
  let traversals = 0;
  let biomeChoice = null;
  const deadline = Date.now() + 6 * 60_000;
  const visited = new Set();
  while (Date.now() < deadline) {
    const s = await alice.read();
    if (s.snap.phase !== 'expedition') break;
    visited.add(s.snap.floor.roomId);
    if (s.snap.floor.biomeChoice) { biomeChoice = s.snap.floor.biomeChoice; break; }
    const living = s.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
    if (living.length && !s.snap.roomCleared) {
      if (!sealedSeen) {
        const lock = await agree(pair, (q) => ({ room: q.snap.floor.roomId, doorsLocked: q.snap.floor.doorsLocked ?? q.snap.floor.locked ?? null, cleared: q.snap.roomCleared }));
        // Push against a door with real input: a sealed door must not let bob through.
        const door = s.room.exits[0];
        await walkTo(bob, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 6000, until: (q) => q.snap.floor.roomId !== s.snap.floor.roomId });
        const still = await agree(pair, (q) => q.snap.floor.roomId);
        sealedSeen = { lock: lock.values, stayed: JSON.parse(still.values[0]) === s.snap.floor.roomId && still.ok };
        await shots(pair, 's9-floors-sealed');
      }
      await Promise.all(pair.map((p) => fightUntil(p, { timeoutMs: 90000 })));
      const q = await alice.read();
      const down = q.snap.players?.filter((p) => p.hp <= 0) ?? [];
      if (q.snap.phase === 'expedition' && down.length === 1) {
        const rescuer = pair.find((p) => p.name !== down[0].displayName);
        await walkTo(rescuer, down[0], { arriveDist: 34, timeoutMs: 15000 });
        await rescuer.focusStage();
        await rescuer.page.keyboard.down('f'); await sleep(2400); await rescuer.page.keyboard.up('f');
      }
      continue;
    }
    // Prefer a door to a room we have not seen (map rooms carry ids); fall back to any door.
    const doors = s.room.exits;
    const door = doors.find((d) => !visited.has(d.toRoomId)) ?? doors[Math.floor(Math.random() * doors.length)];
    if (!door) break;
    const mover = traversals % 2 === 0 ? alice : bob;
    const moved = await walkTo(mover, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 20000, until: (q) => q.snap.floor?.roomId !== s.snap.floor.roomId });
    await sleep(900);
    const after = await agree(pair, (q) => ({ room: q.snap.floor?.roomId, players: q.snap.players.length, map: q.snap.floor }));
    if (moved && after.ok && JSON.parse(after.values[0]).room !== s.snap.floor.roomId) traversals++;
    if (!after.ok) { report.add('9b', 'floors: door traversal keeps both screens on the same room', 'FAIL', `diverged: ${after.values[0].slice(0, 300)} vs ${after.values[1].slice(0, 300)}`); return; }
    if (traversals >= 12 && sealedSeen) break;
  }
  await shots(pair, 's9-floors-progress');
  const finalAgree = await agree(pair, (q) => q.snap.floor ?? null);
  report.check('9b', 'floors: door traversal with two players, floor state agrees', traversals >= 2 && finalAgree.ok, `${traversals} door traversals (alternating who walks through), rooms visited=${J([...visited])}; snapshot.floor identical on both screens=${finalAgree.ok}`);
  report.check('9c', 'floors: doors seal in combat on both screens', Boolean(sealedSeen?.stayed), sealedSeen ? `in a combat room both screens reported ${sealedSeen.lock[0]} / ${sealedSeen.lock[1]}; bob pushed into the door with real input and the crew stayed=${sealedSeen.stayed}` : 'never entered a combat room within the time budget');
  if (biomeChoice) {
    const roomBefore = (await alice.read()).snap.floor;
    await bob.focusStage();
    await bob.tap('1');
    await sleep(900);
    const afterGuest = (await alice.read()).snap.floor;
    const guestIgnored = Boolean(afterGuest.biomeChoice) && afterGuest.biomeId === roomBefore.biomeId;
    await alice.focusStage();
    await alice.tap('1');
    await sleep(1200);
    const afterHost = await agree(pair, (q) => ({ biome: q.snap.floor?.biomeId, choice: q.snap.floor?.biomeChoice ?? null }));
    await shots(pair, 's9-floors-biome');
    report.check('9d', 'floors: biome choice is host-only', guestIgnored && afterHost.ok && JSON.parse(afterHost.values[0]).biome !== roomBefore.biomeId,
      `offered ${J(biomeChoice)}; guest pressed 1 -> ignored=${guestIgnored}; host pressed 1 -> both screens ${afterHost.values[0]}`);
  } else {
    report.add('9d', 'floors: biome choice is host-only', 'SKIP', 'no biome choice was reached within the time budget (unit-tested only)');
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  await fs.promises.mkdir(args.outDir, { recursive: true });
  const groups = args.only ?? (args.floors ? ['floors'] : ['lobby', 'demo', 'reconnect']);
  const servers = new Servers(args);
  const cleanup = () => servers.stopAll();
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(1));
  process.on('SIGTERM', () => process.exit(1));

  await servers.start();
  const playwright = await ensurePlaywright(args.depsDir);
  const browser = await playwright.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const report = new Report(args.outDir);
  const all = [];
  const ctx = {
    args, report, servers,
    make: (name) => { const p = new Player(browser, servers.base, name, { width: args.width, height: args.height }, args.outDir); all.push(p); return p; },
  };
  const table = { lobby: groupLobby, demo: groupDemo, reconnect: groupReconnect, fullrun: groupFullRun, floors: groupFloors };
  try {
    for (const [i, group] of groups.entries()) {
      if (!table[group]) throw new Error(`unknown group "${group}"`);
      if (i > 0 && group !== 'demo') { // demo continues from the lobby group's crew; others want a clean server
        for (const p of all) await p.close();
        ctx.alice = ctx.bob = null;
        ctx.hostName = 'alice';
        await servers.restartServer();
      }
      console.log(`\n--- group: ${group} ---`);
      try {
        await table[group](ctx);
      } catch (err) {
        await shots(all.filter((p) => p.page), `error-${group}`);
        report.add(`${group}!`, `group "${group}" aborted`, 'FAIL', String(err?.stack ?? err).slice(0, 600));
      }
      const errors = all.flatMap((p) => p.errors.filter((e) => e.startsWith('pageerror')).map((e) => `${p.name}: ${e}`));
      if (errors.length) console.log(`[coop] page errors so far: ${J(errors.slice(0, 5))}`);
    }
  } finally {
    await browser.close().catch(() => {});
    servers.stopAll();
  }
  if (ctx.latencies) console.log(`sync latency samples (ms): ${ctx.latencies.join(', ')}`);
  return report.print() ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[coop] FATAL:', err?.stack ?? err);
  process.exit(2);
});
