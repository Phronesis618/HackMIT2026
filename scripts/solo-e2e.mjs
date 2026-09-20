#!/usr/bin/env node
/**
 * solo-e2e.mjs — scripted, real-input SOLO verification for RELAY.
 *
 * Sibling of scripts/coop-e2e.mjs: one isolated headless browser context, driven with REAL
 * keyboard and mouse input only. State is read (read-only) from the DOM and from the
 * `window.relay` debug handle the client already exposes ({ session, controller, store });
 * nothing is injected and no production test hooks exist. Every checkpoint takes a screenshot
 * and the run ends with a PASS/FAIL table (also written to <out>/results.json).
 *
 * Playwright is bootstrapped exactly like scripts/shot.mjs / coop-e2e.mjs (isolated
 * /tmp/relay-shot-deps). See docs/SCREENSHOTS.md and docs/QA.md.
 *
 *   node scripts/solo-e2e.mjs                      # hub -> biome 1 -> gate -> deep, floors+laws on
 *   node scripts/solo-e2e.mjs --only finale        # deep-link to the Custodian, ritual, escape, relic
 *   node scripts/solo-e2e.mjs --legacy --only legacy   # flags OFF: 3 rooms, Guardian, ritual, debrief
 *   node scripts/solo-e2e.mjs --only fixtures --class bastion
 *   node scripts/solo-e2e.mjs --base http://localhost:6973   # reuse a server that is already up
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PLAYWRIGHT_SPEC = 'playwright@1.61';
const GL_ARGS = {
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
  swiftshader: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
};
const TILE = 32;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const J = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const HELP = `solo-e2e.mjs — scripted single-player verification (real input only)

  --only <groups>       hub, biome, attune, deep, finale, fullrun, legacy, fixtures, audio, onboarding.\n                        Default: hub,biome,attune,deep
  --legacy              Spawn the server with floors/laws OFF and drive the legacy 3-room path
  --class <id>          bastion | shade | beacon | weaver (weapon stand the bot walks to). Default: bastion
  --hints off|reset|on  ?hints= for every page load. Default: off (the onboarding group forces reset)
  --finale-entry <how>  deeplink (?room=2, fast) | play (walk rooms 1-3 so the collapse has a route home)
  --minutes <n>         Time budget for the "deep" group. Default 10
  --port <n>            Vite client port. Default 6973
  --server-port <n>     API/WS port. Default port + 3614
  --base <url>          Use an already-running client+server (no spawn)
  --gl metal|swiftshader
  --out-dir <dir>       Screenshots + results.json. Default /tmp/relay-shots/q1
  --env KEY=VALUE       Extra env for the spawned server (repeatable)
`;

function parseArgs(argv) {
  const args = {
    port: 6973, serverPort: null, base: null, outDir: '/tmp/relay-shots/q1', depsDir: '/tmp/relay-shot-deps',
    only: null, legacy: false, klass: 'bastion', minutes: 10, hints: 'off', finaleEntry: 'deeplink',
    gl: process.platform === 'darwin' ? 'metal' : 'swiftshader', env: {}, width: 1440, height: 900, help: false,
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
      case '--legacy': args.legacy = true; break;
      case '--class': args.klass = argv[++i]; break;
      case '--hints': args.hints = argv[++i]; break;
      case '--finale-entry': args.finaleEntry = argv[++i]; break;
      case '--minutes': args.minutes = Number(argv[++i]); break;
      case '--gl': args.gl = argv[++i]; break;
      case '--width': args.width = Number(argv[++i]); break;
      case '--height': args.height = Number(argv[++i]); break;
      case '--env': {
        const pair = argv[++i] ?? '';
        const eq = pair.indexOf('=');
        if (eq <= 0) throw new Error('--env expects KEY=VALUE');
        args.env[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      case '--help': case '-h': args.help = true; break;
      default: console.error(`[solo] unknown argument: ${a}`); process.exit(1);
    }
  }
  if (!args.legacy) { args.env.RELAY_FLOORS = args.env.RELAY_FLOORS ?? '1'; args.env.RELAY_LAWS = args.env.RELAY_LAWS ?? '1'; }
  return args;
}

// ---------------------------------------------------------------------------------------------
// Playwright bootstrap (same isolated install as shot.mjs / coop-e2e.mjs)
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
// Servers (spawned, or reused when --base already answers)
// ---------------------------------------------------------------------------------------------

/** node:http rather than fetch: Node 26's undici can throw an uncatchable EINVAL while a server goes down. */
function isReachable(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => { res.resume(); resolve((res.statusCode ?? 500) < 500); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 100, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const last = await fn();
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
  }

  spawnTracked(cmd, cmdArgs, env, tag) {
    const child = spawn(cmd, cmdArgs, { cwd: REPO_ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const logFile = fs.createWriteStream(path.join(this.args.outDir, `${tag}.log`), { flags: 'a' });
    child.stdout.pipe(logFile);
    child.stderr.pipe(logFile);
    this.children.push(child);
    return child;
  }

  static kill(child) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } }

  async start() {
    if (this.external) {
      if (!(await isReachable(`${this.base}/`))) throw new Error(`nothing reachable at ${this.base}/`);
      this.config = await getJson(`${this.base}/api/config`);
      return;
    }
    if (await isReachable(this.base)) throw new Error(`port ${this.args.port} is already in use; pass --base to reuse it or pick another --port`);
    const env = { ...process.env, ...this.args.env, PORT: String(this.serverPort) };
    this.spawnTracked('npx', ['vite', '--port', String(this.args.port), '--strictPort'], env, 'vite');
    this.spawnTracked('npx', ['tsx', 'src/server/index.ts'], env, 'server');
    await waitFor(() => isReachable(`http://127.0.0.1:${this.serverPort}/api/health`), { timeoutMs: 60000, intervalMs: 300, label: 'server health' });
    await waitFor(() => isReachable(this.base), { timeoutMs: 60000, intervalMs: 400, label: 'vite' });
    this.config = await getJson(`${this.base}/api/config`);
  }

  stopAll() { for (const child of this.children) Servers.kill(child); }
}

// ---------------------------------------------------------------------------------------------
// Page-side readers (READ-ONLY; everything below already exists for the app's own use)
// ---------------------------------------------------------------------------------------------

function readRelay() {
  const r = window.relay;
  if (!r) return null;
  const snap = r.session.getSnapshot();
  const ui = r.store.get();
  const world = r.session.getWorld();
  const slim = (room) => room && {
    id: room.id, index: room.index, name: room.name ?? null, width: room.width, height: room.height,
    tiles: room.tiles, props: room.props, exits: room.exits, isFinal: room.isFinal ?? false,
    kind: room.kind ?? null, feature: room.feature ?? null, focus: room.focus ?? null,
  };
  let room = null;
  try {
    if (snap && snap.floor) room = r.controller.floorRooms?.provider.getRoom({ biomeId: snap.floor.biomeId, roomId: snap.floor.roomId }) ?? null;
    if (!room) room = r.session.sim.getRoom() ?? null;
  } catch { room = null; }
  return {
    now: Date.now(),
    id: r.session.localPlayerId,
    conn: r.session.getConnectionStatus(),
    snap: snap && {
      phase: snap.phase, worldId: snap.worldId, roomIndex: snap.roomIndex, roomId: snap.roomId,
      roomCleared: snap.roomCleared, players: snap.players, enemies: snap.enemies,
      anchor: snap.anchor, terrain: snap.terrain, floor: snap.floor ?? null,
      collapse: snap.collapse ?? null, bossField: snap.bossField ?? null,
      discoveredLore: snap.discoveredLore ?? [], loreNodes: snap.loreNodes ?? [],
    },
    room: slim(room),
    worldId: world?.worldId ?? null,
    world: world && {
      title: world.recipe.title, fixtureId: world.provenance.fixtureId ?? null,
      source: world.provenance.source, label: world.provenance.label,
      laws: (world.recipe.laws ?? []).map((l) => l.lawId), look: world.recipe.look?.paletteFamily ?? null,
      custodian: world.recipe.custodian?.title ?? null,
      custodianPhases: world.recipe.custodian?.phaseTitles ?? null,
      terrainSkins: (world.recipe.terrainSkins ?? []).map((s) => s.featureId),
      attunements: (world.recipe.attunements ?? []).map((a) => a.name),
      biomes: (world.recipe.biomes ?? []).map((b) => b.id),
      floors: Boolean(world.floors),
    },
    ui: {
      phase: ui.phase, notice: ui.notice, memories: ui.memories.length,
      hud: ui.hud, headquarters: ui.headquarters ?? null,
      lawsUi: (ui.world?.laws ?? []).map((l) => `${l.lawId}:${l.active}`),
      worldTitle: ui.world?.title ?? null,
      provenanceLabel: ui.world?.provenance?.label ?? null,
      receipt: (ui.world?.receipt?.lines ?? []).map((l) => `${l.playerName}: ${l.text}`),
      players: ui.players?.length ?? 0,
      audioMuted: ui.audioMuted ?? null,
      classId: ui.localPlayer?.classId ?? null,
      generation: ui.generation ?? null,
    },
  };
}

function readDom() {
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  const has = (sel) => Boolean(document.querySelector(sel));
  const all = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.trim());
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(label));
  return {
    provenance: text('.topbar__status .badge:not(.badge--conn):not(.badge--preview)'),
    worldTitle: text('.panel--world .panel__title') ?? text('.world-brief__title'),
    receipt: all('.panel--world [aria-label="Creation receipt"] .list__item'),
    contributions: all('.contributions .list__item'),
    prepareDisabled: button('Prepare')?.disabled ?? null,
    hqDirectory: has('[aria-label="Headquarters directory"]'),
    hqSpeech: text('.hq-speech'),
    hqRecords: all('.hq-records .list__item').slice(0, 6),
    hqShelf: text('.hq-echoes'),
    hqPrompt: text('.hq-prompt'),
    hqStation: text('.hq-status'),
    memoryWall: has('[aria-label="Device-local memory wall"]'),
    memoryCards: all('[aria-label="Device-local memory wall"] .card__title').slice(0, 8),
    minimap: has('.fmini__grid') || has('.fmini-button'),
    minimapFoot: text('.fmini__foot'),
    fullMap: has('.fullmap__grid') || has('.fullmap'),
    fullMapRoute: text('.fullmap__route') ?? text('.fmap-head__name'),
    biomeChoice: has('.biome-choice'),
    biomeDoors: [...document.querySelectorAll('.biome-door')].map((b) => b.getAttribute('data-biome')),
    biomeDoorNames: all('.biome-door__name'),
    departure: has('[data-testid="hq-departure"]'),
    departureCommitted: has('.hq-departure--committed'),
    departureHint: text('.hq-departure__hint'),
    coach: text('.coach__text'),
    coachKey: text('.coach__key'),
    hqPromptButton: text('.hq-prompt'),
    escape: text('.escape__clock'),
    escapeLabel: text('.escape__label'),
    relicChoice: has('.relic-choice'),
    relicCards: all('.relic-card__title'),
    relicChosen: all('.relic-card--chosen .relic-card__title'),
    debriefTitle: text('#debrief-title'),
    debriefOutcome: text('.debrief__outcome'),
    debriefKeepsake: text('.debrief__keepsake'),
    notice: text('.notice span'),
    telemetry: text('.brand__telemetry'),
    caption: text('.rail-status .panel__title'),
    terrainCaption: all('.chips .badge').slice(0, 6),
    soundToggle: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).find((t) => /^SOUND/i.test(t)) ?? null,
    bodyText: document.body.innerText.slice(0, 6000),
  };
}

/** Whether a WebAudio graph exists and is running. Read-only; no app hook. */
function readAudio() {
  const ctors = [window.AudioContext, window.webkitAudioContext].filter(Boolean);
  return { seen: window.__relayAudioStates ?? null, ctorPatched: Boolean(window.__relayAudioStates), ctors: ctors.length };
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

const MOVE_KEYS = { up: 'w', down: 's', left: 'a', right: 'd' };

class Player {
  constructor(browser, base, size, outDir) {
    Object.assign(this, { browser, base, size, outDir });
    this.name = 'solo';
    this.held = new Set();
    this.context = null;
    this.page = null;
    this.errors = [];
    this.shots = [];
  }

  /** A cold profile: a brand-new context has empty localStorage, which is what a judge's browser is. */
  async open(query = '', { freshContext = true, spyAudio = false } = {}) {
    if (freshContext || !this.context) {
      await this.context?.close().catch(() => {});
      this.context = await this.browser.newContext({ viewport: this.size, deviceScaleFactor: 1 });
      if (spyAudio) {
        // Wrap the constructor BEFORE any app code runs, then only observe. The page keeps a list
        // of every context it made and its state; nothing about the app's behaviour changes.
        await this.context.addInitScript(() => {
          window.__relayAudioStates = [];
          const wrap = (Ctor) => Ctor && class extends Ctor {
            constructor(...a) { super(...a); window.__relayAudioStates.push(this); }
          };
          const A = wrap(window.AudioContext);
          if (A) window.AudioContext = A;
          const W = wrap(window.webkitAudioContext);
          if (W) window.webkitAudioContext = W;
        });
      }
      this.page = await this.context.newPage();
      this.page.on('pageerror', (err) => this.errors.push(`pageerror: ${err.message}`));
      this.page.on('console', (msg) => { if (msg.type() === 'error') this.errors.push(`console: ${msg.text().slice(0, 240)}`); });
    }
    this.held.clear();
    await this.page.goto(`${this.base}/${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.canvasMounted = await this.page.waitForSelector('.stage canvas', { state: 'attached', timeout: 60000 }).then(() => true).catch(() => false);
    if (!this.canvasMounted) console.log(`[solo] WARNING: no canvas after 60 s; errors=${J(this.errors.slice(0, 4))}`);
    await waitFor(async () => (await this.read())?.snap, { timeoutMs: 30000, label: 'first snapshot' }).catch(() => {});
    return this;
  }

  async close() { await this.context?.close().catch(() => {}); this.context = null; this.page = null; }

  read() { return this.page.evaluate(readRelay); }
  dom() { return this.page.evaluate(readDom); }
  audio() { return this.page.evaluate(readAudio).catch(() => null); }
  /** The live audio state strings, read from the wrapped contexts. */
  audioStates() { return this.page.evaluate(() => (window.__relayAudioStates ?? []).map((c) => c.state)).catch(() => []); }

  async me() {
    const s = await this.read();
    return s?.snap?.players.find((p) => p.id === s.id) ?? null;
  }

  async shot(label) {
    if (!this.page) return null;
    const file = path.join(this.outDir, `${label}.png`);
    await this.page.screenshot({ path: file }).catch(() => {});
    this.shots.push(label);
    return file;
  }

  async focusStage() { await this.page.locator('.stage').focus().catch(() => {}); }

  async setKeys(wanted) {
    for (const key of [...this.held]) if (!wanted.has(key)) { await this.page.keyboard.up(key).catch(() => {}); this.held.delete(key); }
    for (const key of wanted) if (!this.held.has(key)) { await this.page.keyboard.down(key).catch(() => {}); this.held.add(key); }
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
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const a = renderer.screenToWorld(0, 0);
      const b = renderer.screenToWorld(100, 100);
      const sx = (b.x - a.x) / 100;
      const sy = (b.y - a.y) / 100;
      if (!sx || !sy) return null;
      const px = (wx - a.x) / sx;
      const py = (wy - a.y) / sy;
      return { x: rect.left + Math.max(2, Math.min(rect.width - 2, px)), y: rect.top + Math.max(2, Math.min(rect.height - 2, py)) };
    }, { wx, wy }).catch(() => null);
    if (pos) await this.page.mouse.move(pos.x, pos.y).catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// Navigation: BFS over the same tile grid the sim collides against, then steer with WASD
// ---------------------------------------------------------------------------------------------

/** SOLID_TILES from src/shared/registry.ts: walls, void, breakables, canisters, pits. */
const SOLID = new Set(['#', ' ', 'B', '*', 'o']);
/** Tiles that hurt to stand on; routed around when there is any other way. */
const PAINFUL = new Set(['~', '^', '*']);
const BLOCKING_PROPS = { pillar: [1, 1], crate: [1, 1], terminal: [1, 1], crystal_cluster: [1, 1], root_mass: [2, 1], monolith_shard: [1, 2], anchor_pedestal: [1, 1] };

function grids(room, snap) {
  const broken = new Set(snap?.terrain?.brokenWalls ?? []);
  const solid = Array.from({ length: room.height }, (_, y) => Array.from({ length: room.width }, (_, x) => {
    const ch = room.tiles[y]?.[x] ?? '#';
    return ch === 'B' ? !broken.has(`${x},${y}`) : SOLID.has(ch);
  }));
  const cost = Array.from({ length: room.height }, (_, y) => Array.from({ length: room.width }, (_, x) => (PAINFUL.has(room.tiles[y]?.[x] ?? '#') ? 24 : 1)));
  for (const prop of room.props ?? []) {
    const fp = BLOCKING_PROPS[prop.propId];
    if (!fp) continue;
    for (let dy = 0; dy < fp[1]; dy++) for (let dx = 0; dx < fp[0]; dx++) if (solid[prop.y + dy]?.[prop.x + dx] !== undefined) solid[prop.y + dy][prop.x + dx] = true;
  }
  return { solid, cost };
}

/** Uniform-cost search so the bot walks around hazard floor rather than through it. */
function route({ solid, cost }, from, to) {
  const h = solid.length;
  const w = solid[0].length;
  const key = (c, r) => r * w + c;
  const dist = new Map([[key(from.col, from.row), 0]]);
  const prev = new Map([[key(from.col, from.row), -1]]);
  const queue = [[from.col, from.row, 0]];
  const free = (c, r) => r >= 0 && c >= 0 && r < h && c < w && !solid[r][c];
  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]);
    const [c, r, d] = queue.shift();
    if (d > (dist.get(key(c, r)) ?? Infinity)) continue;
    if (c === to.col && r === to.row) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!free(nc, nr)) continue;
      if (dc && dr && (!free(c + dc, r) || !free(c, r + dr))) continue; // never cut a corner
      const nd = d + cost[nr][nc] * (dc && dr ? 1.4 : 1);
      if (nd >= (dist.get(key(nc, nr)) ?? Infinity)) continue;
      dist.set(key(nc, nr), nd);
      prev.set(key(nc, nr), key(c, r));
      queue.push([nc, nr, nd]);
    }
  }
  if (!prev.has(key(to.col, to.row))) return null;
  const out = [];
  for (let k = key(to.col, to.row); k !== -1; k = prev.get(k)) out.unshift({ col: k % w, row: Math.floor(k / w) });
  return out;
}

const tileOf = (p) => ({ col: Math.floor(p.x / TILE), row: Math.floor(p.y / TILE) });
const centre = (t) => ({ x: t.col * TILE + TILE / 2, y: t.row * TILE + TILE / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The nearest tile that is neither solid nor damaging, for stepping out of a hazard. */
function nearestSafeTile(room, snap, from) {
  const { solid } = grids(room, snap);
  for (let r = 1; r <= 4; r++) {
    let best = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const col = from.col + dx;
        const row = from.row + dy;
        const ch = room.tiles[row]?.[col];
        if (ch === undefined || solid[row]?.[col] !== false || PAINFUL.has(ch)) continue;
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { col, row, d };
      }
    }
    if (best) return best;
  }
  return null;
}

function steerKeys(room, snap, me, target, arriveDist) {
  if (dist(target, me) <= arriveDist) return { keys: new Set(), arrived: true };
  const g = grids(room, snap);
  const goalTile = tileOf(target);
  let goal = target;
  if (g.solid[goalTile.row]?.[goalTile.col] === false) {
    const path = route(g, tileOf(me), goalTile);
    if (path && path.length > 1) goal = path.length === 2 ? target : centre(path[1]);
  }
  const keys = new Set();
  const dx = goal.x - me.x;
  const dy = goal.y - me.y;
  if (dx > 5) keys.add(MOVE_KEYS.right); else if (dx < -5) keys.add(MOVE_KEYS.left);
  if (dy > 5) keys.add(MOVE_KEYS.down); else if (dy < -5) keys.add(MOVE_KEYS.up);
  return { keys, arrived: false };
}

async function walkTo(player, target, { arriveDist = 10, timeoutMs = 15000, until = null } = {}) {
  const start = Date.now();
  await player.focusStage();
  try {
    while (Date.now() - start < timeoutMs) {
      const s = await player.read();
      const me = s?.snap?.players.find((p) => p.id === s.id);
      if (!me) return false;
      if (until && until(s, me)) return true;
      if (!s.room) return false;
      const { keys, arrived } = steerKeys(s.room, s.snap, me, target, arriveDist);
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
// Fighting: aim with the mouse, tap J, spend Q/E/R, dash out of telegraphs
// ---------------------------------------------------------------------------------------------

/** A telegraph the bot should not be standing in. The sim publishes its own shape on the enemy. */
function telegraphThreat(me, enemy) {
  const t = enemy.telegraph;
  if (!t) return null;
  const centreOf = { x: t.x ?? enemy.x, y: t.y ?? enemy.y };
  const radius = t.radius ?? t.r ?? 0;
  const length = t.length ?? 0;
  const reach = Math.max(radius, length, 90);
  return dist(me, centreOf) < reach ? { at: centreOf, reach } : null;
}

/** Dash away from the nearest telegraph. Returns true when it dashed. */
async function dashOut(player, me, threat, room, snap) {
  const away = { x: me.x - (threat.at.x - me.x), y: me.y - (threat.at.y - me.y) };
  const g = grids(room, snap);
  const t = tileOf(away);
  const inside = t.row > 0 && t.col > 0 && t.row < room.height - 1 && t.col < room.width - 1 && g.solid[t.row]?.[t.col] === false;
  const { keys } = steerKeys(room, snap, me, inside ? away : { x: room.width * TILE / 2, y: room.height * TILE / 2 }, 4);
  await player.setKeys(keys);
  await sleep(70);
  await player.tap('Shift', 50);
  await sleep(120);
  await player.setKeys(new Set());
  return true;
}

/**
 * Fight like a cautious human: keep the mouse on the nearest living enemy, close to reach, tap J,
 * spend Q/E/R when off cooldown, and dash when a telegraph covers where we stand.
 */
async function fightUntil(player, { timeoutMs = 60000, stopWhen = null, stats = null } = {}) {
  const start = Date.now();
  await player.focusStage();
  let lastAbility = 0;
  let lastDash = 0;
  try {
    while (Date.now() - start < timeoutMs) {
      const s = await player.read();
      const me = s?.snap?.players.find((p) => p.id === s.id);
      if (!me || s.snap.phase !== 'expedition') return 'ended';
      if (stopWhen && stopWhen(s, me)) return 'stopped';
      if (me.hp <= 0) { await player.stop(); return 'downed'; }
      const living = s.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
      if (!living.length) return s.snap.roomCleared ? 'cleared' : 'no-enemies';
      if (stats) { stats.enemiesSeen = Math.max(stats.enemiesSeen ?? 0, living.length); stats.hpLow = Math.min(stats.hpLow ?? me.hp, me.hp); }
      // 1. dodge first: a telegraph over our feet beats any attack we could land.
      const threat = living.map((e) => telegraphThreat(me, e)).find(Boolean);
      if (threat && me.dashCooldownMs <= 0 && Date.now() - lastDash > 400) {
        lastDash = Date.now();
        if (stats) stats.dodges = (stats.dodges ?? 0) + 1;
        await dashOut(player, me, threat, s.room, s.snap);
        continue;
      }
      // 2. a human does not stand in the fire to swing. If the tile under our feet hurts,
      //    step to the nearest tile that does not before doing anything else.
      const here = tileOf(me);
      if (PAINFUL.has(s.room.tiles[here.row]?.[here.col] ?? '#')) {
        const safeTile = nearestSafeTile(s.room, s.snap, here);
        if (safeTile) {
          if (stats) stats.stepOffs = (stats.stepOffs ?? 0) + 1;
          await player.setKeys(steerKeys(s.room, s.snap, me, centre(safeTile), 6).keys);
          await sleep(90);
          continue;
        }
      }
      const enemy = living.reduce((a, b) => (dist(a, me) < dist(b, me) ? a : b));
      const d = dist(enemy, me);
      await player.aimAt(enemy.x, enemy.y);
      if (d > 40) await player.setKeys(steerKeys(s.room, s.snap, me, enemy, 36).keys);
      else await player.setKeys(new Set());
      if (d < 60 && me.attackCooldownMs <= 0) await player.tap('j', 40);
      if (d < 140 && Date.now() - lastAbility > 800) {
        lastAbility = Date.now();
        if ((me.ultCharge ?? 0) >= 100) { await player.tap('r', 40); if (stats) stats.usedR = true; }
        else if ((me.abilityQCooldownMs ?? 0) <= 0) { await player.tap('q', 40); if (stats) stats.usedQ = true; }
        else if (me.abilityEUnlocked && (me.abilityECooldownMs ?? 0) <= 0) { await player.tap('e', 40); if (stats) stats.usedE = true; }
      }
      await sleep(35);
    }
    return 'timeout';
  } finally {
    await player.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

class Report {
  constructor(outDir) { this.outDir = outDir; this.rows = []; }
  add(id, name, status, evidence, shot) {
    this.rows.push({ id, name, status, evidence, shot: shot ?? null });
    console.log(`[${status}] ${id} ${name}\n        ${evidence}`);
    fs.writeFileSync(path.join(this.outDir, 'results.json'), JSON.stringify(this.rows, null, 2));
  }
  check(id, name, ok, evidence, shot) { this.add(id, name, ok ? 'PASS' : 'FAIL', evidence, shot); return ok; }
  print() {
    console.log('\n=== SOLO E2E RESULTS ===');
    for (const row of this.rows) console.log(`${row.status.padEnd(5)} ${row.id.padEnd(7)} ${row.name}${row.shot ? `   [${row.shot}.png]` : ''}`);
    const fails = this.rows.filter((r) => r.status === 'FAIL').length;
    const skips = this.rows.filter((r) => r.status === 'SKIP').length;
    console.log(`\n${this.rows.length - fails - skips}/${this.rows.length} checkpoints passed, ${skips} skipped; screenshots + results.json in ${this.outDir}`);
    return fails;
  }
}

// ---------------------------------------------------------------------------------------------
// Shared flows
// ---------------------------------------------------------------------------------------------

/** HEADQUARTERS_STATIONS, src/shared/headquarters.ts. Interact range is 58 px (~1.8 tiles). */
const HQ_STATION_TILE = {
  bastion: [4, 3], shade: [8, 3], beacon: [4, 7], weaver: [8, 7],
  quartermaster: [15, 6], relics: [15, 1], archive: [24, 4], records: [24, 8],
  observatory: [24, 16], training: [5, 16], portal: [15, 18],
};
const HQ_GATE_TILE = [15, 18];

/** Build a query string, always carrying the run's `?hints=` choice. */
function q(args, extra = {}) {
  const params = new URLSearchParams(extra);
  if (args.hints && args.hints !== 'on') params.set('hints', args.hints);
  const s = params.toString();
  return s ? `?${s}` : '?';
}

async function contribute(player, text) {
  const area = player.page.locator('#contribution');
  await area.click();
  await area.pressSequentially(text, { delay: 4 });
  await player.page.keyboard.press('Enter');
  await player.focusStage();
}

async function prepareWorld(player, timeoutMs = 60000) {
  const t0 = Date.now();
  await player.page.getByRole('button', { name: /^Prepare/ }).click();
  await player.focusStage();
  const got = await waitFor(async () => {
    const s = await player.read();
    return s?.world && s.ui.phase !== 'preparing' ? s : null;
  }, { timeoutMs, intervalMs: 150, label: 'world prepared' });
  return { ms: Date.now() - t0, state: got };
}

/**
 * Two ways out of the hub, and they are not the same thing:
 *  - `ritual`: press the real "Enter portal" button. `HeadquartersDeparture` runs a 2400 ms
 *    departure ritual (lamps dim, the quartermaster turns, the gate flashes) and only then
 *    commits. F or Esc skips it.
 *  - `walk`: walk onto the gate tile 'X' at (15,18). The sim's `exit_reached` enters at once,
 *    with no ritual. This is the quick path for a bot that is not testing the ritual.
 */
async function takeTheGate(player, { how = 'walk', timeoutMs = 30000 } = {}) {
  const t0 = Date.now();
  let sawOverlay = false;
  let sawHint = null;
  let ok = false;
  if (how === 'ritual') {
    await player.page.getByRole('button', { name: /^Enter portal/ }).first().click({ timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 24; i++) {
      const d = await player.dom();
      if (d.departure) { sawOverlay = true; sawHint = sawHint ?? d.departureHint; }
      if ((await player.read())?.snap.phase === 'expedition') break;
      await sleep(120);
    }
    ok = sawOverlay;
  } else {
    ok = await walkTo(player, centre({ col: HQ_GATE_TILE[0], row: HQ_GATE_TILE[1] }), {
      arriveDist: 4, timeoutMs, until: (s) => s.snap.phase === 'expedition',
    });
  }
  const entered = await waitFor(async () => ((await player.read())?.snap.phase === 'expedition'), { timeoutMs: 12000, label: 'expedition' }).then(() => true).catch(() => false);
  return { ok, entered, sawOverlay, sawHint, ms: Date.now() - t0 };
}

/** The tile characters actually present in a room, as a set. */
const tileSet = (room) => new Set(room.tiles.join('').split(''));

const TILE_NAMES = { o: 'pit', '^': 'vent', '~': 'hazard floor', '*': 'canister', '-': 'low cover', '>': 'ramp', '=': 'bridge', ':': 'rubble', '+': 'conduit', B: 'breakable wall' };

// ---------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------

/**
 * The onboarding engine writes a first-encounter note the first time a room kind is entered.
 * Nobody had seen those in a browser, so every new kind gets its own screenshot + the note text.
 */
async function noteShot(ctx, kind) {
  if (!kind || ctx.kindShots?.has(kind)) return;
  (ctx.kindShots ??= new Set()).add(kind);
  await sleep(900);
  const d = await ctx.player.dom();
  const label = `12-roomkind-${kind}`;
  await ctx.player.shot(label);
  (ctx.kindNotes ??= []).push({ kind, coach: d.coach, key: d.coachKey, shot: label });
}

async function groupHub(ctx) {
  const { report, player, args } = ctx;
  await player.open(q(args), { spyAudio: true });
  await sleep(1500);
  let s = await player.read();
  let d = await player.dom();
  await player.shot('01-hub-cold');
  report.check('H1', 'cold profile boots into the hub, canvas renders, no page errors',
    Boolean(player.canvasMounted) && s?.snap.phase === 'headquarters' && d.hqDirectory && player.errors.filter((e) => e.startsWith('pageerror')).length === 0,
    `phase=${s?.snap.phase} canvas=${player.canvasMounted} directory=${d.hqDirectory} memories=${s?.ui.memories} errors=${J(player.errors.slice(0, 3))}`, '01-hub-cold');

  const cfg = ctx.servers.config;
  report.check('H0', 'server is the flag authority and the client adopted it',
    Boolean(cfg) && cfg.floors === !args.legacy && cfg.laws === !args.legacy,
    `GET /api/config -> ${J(cfg)} (expected floors=${!args.legacy} laws=${!args.legacy})`);

  // --- weapon stand: walk to it and press F, like the hub directory tells you to.
  const before = s.ui.classId;
  const want = args.klass === 'bastion' ? 'shade' : args.klass;
  const [sx, sy] = HQ_STATION_TILE[want] ?? HQ_STATION_TILE.shade;
  const reached = await walkTo(player, centre({ col: sx, row: sy + 1 }), { arriveDist: 26, timeoutMs: 30000 });
  await sleep(400);
  const near = (await player.read()).ui.headquarters;
  await player.focusStage();
  await player.tap('f', 160);
  await sleep(900);
  await player.shot('02-weapon-stand');
  let after = await player.read();
  let dd = await player.dom();
  if (after.ui.classId === before) { // the station panel may need a second F to take the weapon
    const take = player.page.getByRole('button', { name: /Take|Equip|Arm/ }).first();
    if (await take.count().then((n) => n > 0).catch(() => false)) await take.click().catch(() => {});
    await player.focusStage();
    await player.tap('f', 160);
    await sleep(800);
    after = await player.read();
    dd = await player.dom();
  }
  report.check('H2', 'weapon stand: walk up, press F, the operative changes class',
    after.ui.classId === want,
    `walked to the ${want} stand (reached=${reached}, nearbyStationId=${J(near?.nearbyStationId)}), pressed F: class ${before} -> ${after.ui.classId}; station panel="${dd.hqStation ?? dd.hqSpeech}"`, '02-weapon-stand');
  ctx.classId = after.ui.classId;

  // --- idea -> receipt.
  const idea = 'a signal lamp somebody wired to the handrail';
  await contribute(player, idea);
  await sleep(500);
  d = await player.dom();
  report.check('H3', 'an idea is recorded and shown back', d.contributions.some((c) => c.includes(idea)), `contributions on screen: ${J(d.contributions)}`);

  const prepared = await prepareWorld(player);
  await sleep(700);
  s = await player.read();
  d = await player.dom();
  await player.shot('03-world-receipt');
  report.check('H4', 'Prepare world -> world, provenance label and a receipt line per idea',
    Boolean(s.world) && d.receipt.length === 1 && Boolean(d.provenance) && /FIXTURE|LIVE/i.test(d.provenance ?? ''),
    `${(prepared.ms / 1000).toFixed(1)} s; title="${s.world.title}" fixture=${s.world.fixtureId} provenance="${d.provenance}" receipt=${J(d.receipt)}`, '03-world-receipt');
  report.check('H5', 'the prepared world carries laws, a look, a custodian and terrain skins',
    s.world.laws.length > 0 && Boolean(s.world.look) && Boolean(s.world.custodian) && s.world.terrainSkins.length > 0 && s.ui.lawsUi.length > 0,
    `laws=${J(s.world.laws)} lawsOnScreen=${J(s.ui.lawsUi)} look=${s.world.look} custodian="${s.world.custodian}" phases=${J(s.world.custodianPhases)} terrainSkins=${J(s.world.terrainSkins)} attunements=${J(s.world.attunements)}`);
  report.check('H6', `floors world requested and delivered (floors=${!args.legacy})`,
    s.world.floors === !args.legacy,
    `world.floors=${s.world.floors}; biomes in the recipe=${s.world.biomes.length}; plannedRoomCount handled by the client's own prefix check`);
  ctx.fixtureId = s.world.fixtureId;

  // --- the gate: press Enter portal and let the 2.4 s departure ritual run to its own end.
  const gate = await takeTheGate(player, { how: 'ritual' });
  await sleep(1200);
  s = await player.read();
  d = await player.dom();
  await player.shot('04-first-room');
  report.check('H7', 'the departure ritual runs at the gate and lands the run in room 1',
    gate.sawOverlay && gate.entered && s.snap.phase === 'expedition',
    `"Enter portal" pressed: departure overlay seen=${gate.sawOverlay} hint="${gate.sawHint}" (DEPARTURE_COUNTDOWN_MS=2400, F/Esc skips); entered=${gate.entered} in ${(gate.ms / 1000).toFixed(1)} s; phase=${s.snap.phase} room="${s.room?.name ?? s.room?.id}" caption="${d.caption}"`, '04-first-room');
}

async function groupBiome(ctx) {
  const { report, player, args } = ctx;
  let s = await player.read();
  if (s.snap.phase !== 'expedition') { report.add('B!', 'biome group needs a run in progress', 'SKIP', `phase=${s.snap.phase}`); return; }

  report.check('B1', 'floors: the run is on a floor with a biome, a room id and a map',
    Boolean(s.snap.floor) === !args.legacy && (args.legacy || (s.snap.floor.map ?? []).length > 0),
    `snapshot.floor=${J(s.snap.floor)?.slice(0, 300)}`);

  const d0 = await player.dom();
  report.check('B2', 'the minimap is on screen with the room we are in',
    args.legacy ? true : d0.minimap,
    `minimap=${d0.minimap} foot="${d0.minimapFoot}"; room="${s.room?.id}"`);

  // hold M -> the full floor map
  await player.focusStage();
  await player.page.keyboard.down('m');
  await sleep(700);
  const held = await player.dom();
  await player.shot('05-hold-m-map');
  await player.page.keyboard.up('m');
  await sleep(500);
  const released = await player.dom();
  report.check('B3', 'hold M shows the full floor map and releasing hides it',
    held.fullMap && !released.fullMap,
    `while held fullMap=${held.fullMap} route="${held.fullMapRoute}"; after release fullMap=${released.fullMap}`, '05-hold-m-map');

  // --- doors seal in combat and unseal on clear
  const kinds = new Set();
  const tilesSeen = new Set();
  let sealed = null;
  const deadline = Date.now() + Math.min(6, args.minutes) * 60_000;
  let rooms = 0;
  while (Date.now() < deadline && rooms < 6) {
    s = await player.read();
    if (s.snap.phase !== 'expedition') break;
    if (s.room?.kind) { if (!kinds.has(s.room.kind)) await noteShot(ctx, s.room.kind); kinds.add(s.room.kind); }
    if (s.room) for (const ch of tileSet(s.room)) if (TILE_NAMES[ch]) tilesSeen.add(TILE_NAMES[ch]);
    const living = s.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
    if (living.length && !s.snap.roomCleared) {
      if (!sealed && !args.legacy) {
        const lockedNow = s.snap.floor?.doorsLocked ?? null;
        const door = s.room.exits[0];
        const roomBefore = s.snap.floor?.roomId;
        await walkTo(player, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 8000, until: (q) => q.snap.floor?.roomId !== roomBefore });
        const q = await player.read();
        sealed = { lockedNow, stayed: q.snap.floor?.roomId === roomBefore, room: roomBefore };
        await player.shot('06-doors-sealed');
      }
      const outcome = await fightUntil(player, { timeoutMs: 100000, stats: ctx.stats });
      if (outcome === 'downed' || outcome === 'ended') break;
      const after = await player.read();
      if (sealed && sealed.unlocked === undefined) sealed.unlocked = after.snap.floor?.doorsLocked === false && after.snap.roomCleared === true;
      continue;
    }
    if (s.room?.feature === 'biome_exit') break;
    const exits = s.room?.exits ?? [];
    if (!exits.length) break;
    const roomBefore = args.legacy ? s.snap.roomIndex : s.snap.floor?.roomId;
    const seenIds = ctx.visited ?? (ctx.visited = new Set());
    seenIds.add(roomBefore);
    const door = exits.find((e) => !seenIds.has(e.toRoomId)) ?? exits[Math.floor(Math.random() * exits.length)];
    const moved = await walkTo(player, centre({ col: door.x, row: door.y }), {
      arriveDist: 3, timeoutMs: 25000,
      until: (q) => (args.legacy ? q.snap.roomIndex !== roomBefore : q.snap.floor?.roomId !== roomBefore),
    });
    await sleep(900);
    const q = await player.read();
    if ((args.legacy ? q.snap.roomIndex : q.snap.floor?.roomId) === roomBefore) { if (!moved) break; }
    else rooms++;
  }
  await player.shot('07-biome-progress');
  ctx.kinds = kinds;
  ctx.tilesSeen = tilesSeen;
  report.check('B4', 'doors seal while a room is hostile and unseal when it is clear',
    Boolean(sealed?.stayed) && sealed?.unlocked !== false,
    sealed ? `in a hostile room doorsLocked=${sealed.lockedNow}; walked into the door with real input and stayed in ${sealed.room}=${sealed.stayed}; after the clear doorsLocked went false=${sealed.unlocked}` : 'never entered a hostile room inside the budget');
  report.check('B5', 'more than one room kind was actually entered',
    kinds.size >= 2,
    `room kinds entered: ${J([...kinds])} over ${rooms} door traversals`, '07-biome-progress');
  report.check('B6', 'terrain tiles are present in the rooms played',
    tilesSeen.size >= 2,
    `tiles seen in played rooms: ${J([...tilesSeen])}`);
}

/**
 * Attunements are the world's own skill-tree branch (`attune.<i>.<effectId>`, cost 3 + i, the
 * first one gated behind `core.salvage` at 2). They are bought in the Tab menu, page 4, and
 * they are world-scoped: proof is the operative's `skillNodeIds`, not just the resource count.
 */
async function groupAttune(ctx) {
  const { report, player } = ctx;
  const s0 = await player.read();
  const me0 = s0.snap.players.find((p) => p.id === s0.id);
  const before = me0?.resources ?? 0;
  const ownedBefore = me0?.skillNodeIds ?? [];
  await player.focusStage();
  await player.tap('Tab');
  await sleep(500);
  await player.page.locator('.menu__tab[data-menu-page="3"]').click({ timeout: 3000 }).catch(async () => {
    await player.page.keyboard.press('Digit4').catch(() => {});
  });
  await sleep(600);

  // Buy whatever the tree will sell, cheapest first: `core.salvage` gates the first attunement.
  // The detail pane's button is read by class + text; its accessible name does not resolve here.
  const detail = async () => player.page.evaluate(() => {
    const d = document.querySelector('.skilltree__detail');
    if (!d) return null;
    const btn = [...d.querySelectorAll('button')].find((b) => /^Buy/i.test(b.textContent.trim()));
    return {
      name: d.querySelector('.menu__title, h3')?.textContent?.trim() ?? null,
      kind: d.querySelector('.skilltree__kind')?.textContent?.trim() ?? null,
      buy: btn ? btn.textContent.trim() : null,
      enabled: btn ? !btn.disabled : false,
    };
  });
  const clickBuy = async () => player.page.evaluate(() => {
    const d = document.querySelector('.skilltree__detail');
    const btn = d && [...d.querySelectorAll('button')].find((b) => /^Buy/i.test(b.textContent.trim()));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  const inspected = [];
  const purchases = [];
  for (let pass = 0; pass < 8; pass++) {
    const nodes = player.page.locator('button.skillnode');
    const n = await nodes.count().catch(() => 0);
    let boughtThisPass = null;
    for (let i = 0; i < n && !boughtThisPass; i++) {
      await nodes.nth(i).click().catch(() => {});
      await sleep(160);
      const info = await detail();
      if (!info) continue;
      if (pass === 0) inspected.push(`${info.name} [${info.kind}]${info.enabled ? ` ${info.buy}` : ''}`);
      if (!info.enabled) continue;
      // Take the attunement as soon as one is affordable; otherwise buy the cheapest gate.
      if (!/attun/i.test(info.kind ?? '') && purchases.length >= 2) continue;
      if (await clickBuy()) {
        await sleep(700);
        boughtThisPass = info;
        purchases.push(info);
      }
    }
    if (!boughtThisPass) break;
    if (/attun/i.test(boughtThisPass.kind ?? '')) break;
  }
  await player.shot('08-attunement');
  await player.tap('Escape');
  await player.page.getByRole('button', { name: /^Close/ }).click({ timeout: 800 }).catch(() => {});
  await player.focusStage();
  await sleep(600);
  const s1 = await player.read();
  const me1 = s1.snap.players.find((p) => p.id === s1.id);
  const owned = me1?.skillNodeIds ?? [];
  const attunement = owned.find((id) => id.startsWith('attune.'));
  report.check('A1', 'a world attunement can be bought from the skill tree with run resources',
    Boolean(attunement) && (me1?.resources ?? 0) < before,
    `resources ${before} -> ${me1?.resources}; skillNodeIds ${J(ownedBefore)} -> ${J(owned)}; bought ${J(purchases.map((b) => `${b.name} (${b.buy})`))}; nodes on the page: ${J(inspected.slice(0, 14))}`, '08-attunement');
  report.check('A2', 'the attunement is one the world itself wrote',
    Boolean(attunement) && (s1.world?.attunements ?? []).length > 0,
    attunement ? `owned "${attunement}"; the world offers ${J(s1.world?.attunements)}` : `no attunement owned; the world offers ${J(s1.world?.attunements)}`);
}

async function groupDeep(ctx) {
  const { report, player, args } = ctx;
  const deadline = Date.now() + args.minutes * 60_000;
  const t0 = Date.now();
  const kinds = ctx.kinds ?? new Set();
  const tilesSeen = ctx.tilesSeen ?? new Set();
  const biomes = new Set();
  const visited = ctx.visited ?? new Set();
  let gateSeen = null;
  let biomeChoice = null;
  let chosen = null;
  let outcome = 'timeout';
  let deepest = 0;
  let rooms = 0;

  while (Date.now() < deadline) {
    const s = await player.read();
    if (!s || s.snap.phase !== 'expedition') { outcome = s?.snap.phase ?? 'gone'; break; }
    if (s.snap.floor) { biomes.add(s.snap.floor.biomeId); deepest = Math.max(deepest, s.snap.floor.tier ?? 0); visited.add(s.snap.floor.roomId); }
    if (s.room?.kind) { if (!kinds.has(s.room.kind)) await noteShot(ctx, s.room.kind); kinds.add(s.room.kind); }
    if (s.room) for (const ch of tileSet(s.room)) if (TILE_NAMES[ch]) tilesSeen.add(TILE_NAMES[ch]);

    if (s.room?.isFinal || s.room?.feature === 'anchor') { outcome = 'final-room'; break; }
    const d = await player.dom();
    if (d.biomeChoice) {
      biomeChoice = d.biomeDoors;
      await player.shot('10-biome-choice');
      await player.focusStage();
      await player.tap('1', 90);
      await sleep(1500);
      const q = await player.read();
      chosen = q.snap.floor?.biomeId ?? null;
      continue;
    }

    const living = s.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
    if (living.length && !s.snap.roomCleared) {
      const r = await fightUntil(player, { timeoutMs: Math.min(120000, Math.max(2000, deadline - Date.now())), stats: ctx.stats });
      if (r === 'downed') {
        // Solo: a downed operative is the end of the run unless the sim stands them back up.
        const back = await waitFor(async () => {
          const q = await player.read();
          return q.snap.phase !== 'expedition' || (q.snap.players.find((p) => p.id === q.id)?.hp ?? 0) > 0 ? q : null;
        }, { timeoutMs: 20000, intervalMs: 300, label: 'down resolved' }).catch(() => null);
        if (!back || back.snap.phase !== 'expedition') { outcome = back?.snap.phase ?? 'downed'; break; }
      }
      continue;
    }

    if (s.room?.feature === 'biome_exit' && s.room.focus) {
      gateSeen = gateSeen ?? { room: s.room.id, kind: s.room.kind };
      await walkTo(player, centre({ col: s.room.focus.x, row: s.room.focus.y }), { arriveDist: 28, timeoutMs: 20000 });
      await player.focusStage();
      await player.tap('f', 200);
      await sleep(900);
      await player.shot('09-gatekeeper');
      const q = await player.read();
      const qd = await player.dom();
      if (qd.biomeChoice || q.snap.floor?.biomeChoice) continue;
      // Not open yet: the gate may still want the room cleared. Fall through to the door walk.
    }

    const exits = s.room?.exits ?? [];
    if (!exits.length) { outcome = 'dead-end'; break; }
    const roomBefore = s.snap.floor?.roomId ?? s.snap.roomIndex;
    const door = exits.find((e) => !visited.has(e.toRoomId)) ?? exits[Math.floor(Math.random() * exits.length)];
    const moved = await walkTo(player, centre({ col: door.x, row: door.y }), {
      arriveDist: 3, timeoutMs: 25000, until: (q) => (q.snap.floor?.roomId ?? q.snap.roomIndex) !== roomBefore,
    });
    await sleep(800);
    const q = await player.read();
    if ((q.snap.floor?.roomId ?? q.snap.roomIndex) !== roomBefore) rooms++;
    else if (!moved) { outcome = 'stuck'; break; }
  }
  await player.shot('11-deep-end');
  const s = await player.read();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  report.check('D1', 'the bot keeps playing: doors, fights, room kinds, tiles',
    rooms >= 3 && kinds.size >= 2,
    `${mins} min of play: ${rooms} door traversals, ${visited.size} distinct rooms, biomes=${J([...biomes])} deepest tier=${deepest}; room kinds=${J([...kinds])}; tiles=${J([...tilesSeen])}; loop ended with "${outcome}" at phase=${s?.snap.phase}`, '11-deep-end');
  report.check('D2', 'the biome gate (gatekeeper) is reached and opens a biome choice',
    Boolean(biomeChoice),
    gateSeen ? `reached a biome_exit room (${J(gateSeen)}); biome choice offered=${J(biomeChoice)}; picked -> ${chosen}` : `no biome_exit room reached in ${mins} min (deepest tier ${deepest}, ${visited.size} rooms)`, '09-gatekeeper');
  report.check('D3', 'choosing a biome moves the run into it',
    Boolean(chosen) && biomes.size >= 2,
    `biomes entered: ${J([...biomes])}; choice made: ${chosen}`, '10-biome-choice');
  ctx.kinds = kinds;
  ctx.tilesSeen = tilesSeen;
  ctx.deepest = { rooms, biomes: [...biomes], tier: deepest, outcome, mins };
  const notes = ctx.kindNotes ?? [];
  if (args.hints === 'off') {
    report.add('D4', 'the first-encounter note for each room kind was seen on screen', 'SKIP',
      `this run used ?hints=off, which is exactly what silences those notes; room kinds entered: ${J([...kinds])}. Run --hints on to capture them.`);
  } else report.check('D4', 'the first-encounter note for each room kind was seen on screen',
    notes.filter((n) => n.coach).length >= 2,
    notes.length ? notes.map((n) => `${n.kind}: ${n.coach ? `"${n.coach}"` : 'no note on screen'} [${n.shot}.png]`).join(' | ') : 'no room kinds entered');
}

/**
 * The end of a run, reached by the deep-link the repo already supports (`?world=fixture&room=2`)
 * so the Custodian, the ritual, the collapse and the relic choice get played even when a bot
 * cannot grind a whole floors route inside the time budget.
 */
async function groupFinale(ctx) {
  await finaleEntry(ctx);
  await finaleTail(ctx);
}

async function finaleEntry(ctx) {
  const { report, player, args } = ctx;
  // `?room=2` drops straight onto the Custodian, which is fast but leaves the crew with no
  // cleared rooms behind them — `startCollapse` then finds no route home and the run completes
  // without a collapse. `--finale-entry play` walks rooms 1-3 first so the escape is real.
  const played = args.finaleEntry === 'play';
  const url = q(args, played
    ? { world: 'fixture', autoenter: '1', ...(args.legacy ? {} : { laws: '1' }) }
    : { world: 'fixture', room: '2', ...(args.legacy ? {} : { laws: '1' }) });
  ctx.entryUrl = url;
  await player.open(url, { spyAudio: true });
  await sleep(2000);
  let s = await player.read();
  if (played) {
    const t0 = Date.now();
    while (Date.now() - t0 < 12 * 60_000) {
      const w = await player.read();
      if (w.snap.phase !== 'expedition' || w.room?.isFinal) break;
      if (!w.snap.roomCleared) {
        const r = await fightUntil(player, { timeoutMs: 150000 });
        if (r === 'downed') {
          const back = await waitFor(async () => {
            const p2 = await player.read();
            return p2.snap.phase !== 'expedition' || (p2.snap.players.find((z) => z.id === p2.id)?.hp ?? 0) > 0 ? p2 : null;
          }, { timeoutMs: 15000, intervalMs: 300, label: 'down resolved' }).catch(() => null);
          if (!back || back.snap.phase !== 'expedition') break;
        }
        continue;
      }
      const door = (w.room?.exits ?? [])[0];
      if (!door) break;
      const before = w.snap.roomIndex;
      await walkTo(player, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 25000, until: (z) => z.snap.roomIndex !== before });
      await sleep(900);
    }
    s = await player.read();
    report.check('F0', 'the rooms before the Custodian are cleared on foot, so the collapse has a route home',
      s.snap.phase === 'expedition' && s.room?.isFinal === true,
      `entered via ${url}; walked to roomIndex=${s.snap.roomIndex} isFinal=${s.room?.isFinal} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    if (s.snap.phase !== 'expedition') return;
  }
}

/** From standing in the final room: the Custodian, the ritual, the collapse, the relic, the debrief. */
async function finaleTail(ctx) {
  const { report, player } = ctx;
  let s = await player.read();
  await player.shot('20-custodian-start');
  const boss = s.snap.enemies.find((e) => e.bossPhase !== undefined) ?? s.snap.enemies[0];
  report.check('F1', 'the final room holds the Custodian, named and phased by the world',
    Boolean(boss) && Boolean(s.world?.custodian) && (s.world.custodianPhases ?? []).length === 3,
    `entered via ${ctx.entryUrl ?? 'the run in progress'}; boss=${boss?.enemyId} hp=${boss?.hp} phase=${boss?.bossPhase} pattern=${boss?.patternId}; recipe custodian="${s.world?.custodian}" phases=${J(s.world?.custodianPhases)}; laws on screen=${J(s.ui.lawsUi)}`, '20-custodian-start');

  // --- fight it. Track phases and patterns seen; the floor corrupts in phase 2.
  const phases = new Set();
  const patterns = new Set();
  const stats = { dodges: 0, hpLow: 100 };
  const tFight = Date.now();
  const watch = (async () => {
    while (Date.now() - tFight < 6 * 60_000) {
      const w = await player.read().catch(() => null);
      if (!w || w.snap.phase !== 'expedition') return;
      for (const e of w.snap.enemies) { if (e.bossPhase) phases.add(e.bossPhase); if (e.patternId) patterns.add(e.patternId); }
      if (w.snap.roomCleared) return;
      await sleep(250);
    }
  })();
  let fight = 'timeout';
  for (let attempt = 0; attempt < 3; attempt++) {
    fight = await fightUntil(player, { timeoutMs: 180000, stats });
    if (fight !== 'downed') break;
    const back = await waitFor(async () => {
      const w = await player.read();
      return w.snap.phase !== 'expedition' || (w.snap.players.find((p) => p.id === w.id)?.hp ?? 0) > 0 ? w : null;
    }, { timeoutMs: 15000, intervalMs: 300, label: 'down resolved' }).catch(() => null);
    if (!back || back.snap.phase !== 'expedition') break;
  }
  await watch;
  await sleep(800);
  s = await player.read();
  await player.shot('21-custodian-down');
  const fightMs = Date.now() - tFight;
  report.check('F2', 'the Custodian is fought through its phases and goes down solo',
    s.snap.roomCleared === true && phases.size >= 2,
    `outcome=${fight} in ${(fightMs / 1000).toFixed(0)} s; boss phases seen=${J([...phases])} patterns seen=${J([...patterns])}; dodges=${stats.dodges}; lowest integrity=${stats.hpLow}; roomCleared=${s.snap.roomCleared}`, '21-custodian-down');
  report.check('F3', 'phase 3 is reached (the third phase title the world wrote)',
    phases.has(3),
    `phases seen=${J([...phases])} of ${J(s.world?.custodianPhases)}`);
  if (!s.snap.roomCleared) return;

  // --- the relay ritual: three relays in order, then the core. Hold F at each.
  const stages = new Set();
  const tRitual = Date.now();
  while (Date.now() - tRitual < 150000) {
    const w = await player.read();
    if (w.snap.phase !== 'expedition') break;
    const anchor = w.snap.anchor;
    if (!anchor) break;
    const r = anchor.ritual;
    if (r) stages.add(`${r.stage}${r.activeRelay !== null && r.activeRelay !== undefined ? `#${r.activeRelay}` : ''}`);
    if (w.ui.hud?.collapse) break;
    const target = r && r.stage !== 'core' && r.relays?.[r.activeRelay] ? r.relays[r.activeRelay] : anchor;
    await walkTo(player, target, { arriveDist: 26, timeoutMs: 20000 });
    await player.focusStage();
    await player.page.keyboard.down('f');
    const tHold = Date.now();
    while (Date.now() - tHold < 8000) {
      const p = await player.read();
      if (p.snap.phase !== 'expedition' || p.ui.hud?.collapse) break;
      const pr = p.snap.anchor?.ritual;
      if (pr) stages.add(`${pr.stage}${pr.activeRelay !== null && pr.activeRelay !== undefined ? `#${pr.activeRelay}` : ''}`);
      if (pr && (pr.stage !== r?.stage || pr.activeRelay !== r?.activeRelay)) break;
      await sleep(120);
    }
    await player.page.keyboard.up('f');
    await sleep(200);
  }
  await player.shot('22-ritual');
  s = await player.read();
  report.check('F4', 'the relay ritual runs: three relays in order, then the core',
    stages.size >= 3 && (s.snap.anchor?.state === 'planted' || Boolean(s.ui.hud?.collapse)),
    `ritual stages seen=${J([...stages])} in ${((Date.now() - tRitual) / 1000).toFixed(0)} s; anchor state=${s.snap.anchor?.state}; collapse started=${Boolean(s.ui.hud?.collapse)}`, '22-ritual');

  // --- the collapse: walk back through the rooms to the portal.
  // Terrain sits at DEFAULT_TERRAIN_INTENSITY 0.5 here (src/shared/terrain.ts) — the shipped
  // "normal". The clock is clamp(45 s + 15 s/hop, 60 s, 180 s) x1.2 solo; the room's own pits,
  // vents, canisters and hazard floor stay exactly as they were, and a hazard ring closes in
  // from the walls every 25 s (COLLAPSE_RING_MS), up to 3 rings.
  const collapse0 = s.snap.collapse ?? s.ui.hud?.collapse;
  if (!collapse0) { report.add('F5', 'collapse escape', 'SKIP', 'the collapse never started'); return; }
  const tEscape = Date.now();
  const totalMs = collapse0.totalMs;
  let stage = collapse0.stage;
  const hpTrack = [];
  let hops = 0;
  let ringMax = 0;
  let lastRoomKey = s.snap.roomId;
  let reachedAtMs = null;
  while (Date.now() - tEscape < (totalMs ?? 120000) + 30000) {
    const w = await player.read();
    if (!w || w.snap.phase !== 'expedition') { stage = (w?.snap.collapse ?? w?.ui.hud?.collapse)?.stage ?? stage; break; }
    const c = w.snap.collapse ?? w.ui.hud?.collapse;
    if (!c) break;
    stage = c.stage;
    ringMax = Math.max(ringMax, c.ringDepth ?? 0);
    const me = w.snap.players.find((p) => p.id === w.id);
    if (me) hpTrack.push(me.hp);
    if (c.stage !== 'collapse') { reachedAtMs = reachedAtMs ?? Date.now() - tEscape; break; }
    if (w.snap.roomId !== lastRoomKey) { hops++; lastRoomKey = w.snap.roomId; }
    // The sim names the next hop itself; take that door, or fall back to the lowest room index.
    const exits = w.room?.exits ?? [];
    const door = (c.nextRoomId && exits.find((e) => e.toRoomId === c.nextRoomId))
      ?? exits.find((e) => e.toRoomIndex < w.snap.roomIndex)
      ?? exits[0];
    if (!door) break;
    const hostile = w.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
    const near = me && hostile.find((e) => dist(e, me) < 70);
    if (near && me.dashCooldownMs <= 0) { await dashOut(player, me, { at: near, reach: 70 }, w.room, w.snap); continue; }
    const roomBefore = w.snap.roomId;
    await walkTo(player, centre({ col: door.x, row: door.y }), {
      arriveDist: 4, timeoutMs: 20000,
      until: (p) => p.snap.roomId !== roomBefore || (p.snap.collapse ?? p.ui.hud?.collapse)?.stage !== 'collapse',
    });
    await sleep(200);
  }
  const escapeMs = reachedAtMs ?? Date.now() - tEscape;
  await player.shot('23-escape');
  s = await player.read();
  let d = await player.dom();
  const c = s.snap.collapse ?? s.ui.hud?.collapse;
  const usedPct = totalMs ? (100 * escapeMs / totalMs).toFixed(0) : 'n/a';
  report.check('F5', 'the collapse escape is walkable solo at the shipped terrain intensity',
    stage === 'extraction' || stage === 'complete',
    `stage=${stage}; budget ${(totalMs / 1000).toFixed(0)} s for ${collapse0.hops ?? '?'} hops (escape.ts: 45 s + 15 s/hop, clamp 60-180 s, x1.2 solo); the bot walked it in ${(escapeMs / 1000).toFixed(0)} s = ${usedPct}% of the clock, ${hops} room hops, hazard rings closed to depth ${ringMax}/3; integrity ${hpTrack[0]} -> ${hpTrack[hpTrack.length - 1]} (min ${Math.min(...hpTrack)}); on-screen clock="${d.escape}" label="${d.escapeLabel}"`, '23-escape');

  // --- carry one thing out: stand on a pedestal for 1.2 s (solo). No key, no button.
  const offer = c?.offer ?? [];
  if (offer.length) {
    const card = offer[0];
    await walkTo(player, card, { arriveDist: 12, timeoutMs: 25000, until: (p) => Boolean((p.snap.collapse ?? p.ui.hud?.collapse)?.chosenKey) });
    // PEDESTAL_HOLD_MS is 1200 ms of standing still inside PEDESTAL_RANGE 42.
    await waitFor(async () => Boolean(((await player.read()).snap.collapse ?? {}).chosenKey), { timeoutMs: 20000, intervalMs: 200, label: 'relic chosen' }).catch(() => {});
    await sleep(600);
  }
  await player.shot('24-relic-choice');
  s = await player.read();
  d = await player.dom();
  const chosen = (s.snap.collapse ?? s.ui.hud?.collapse)?.chosenKey ?? null;
  report.check('F6', 'carry-one-relic: standing on a pedestal locks the choice',
    Boolean(chosen) && d.relicCards.length >= 1,
    `offer=${J(offer.map((o) => o.key))}; cards on screen=${J(d.relicCards)}; chosen=${chosen} (${J(d.relicChosen)}); head="${d.bodyText.includes('Stand on a pedestal') ? 'Stand on a pedestal…' : ''}"`, '24-relic-choice');

  // --- debrief, then back to the hub.
  const debrief = await waitFor(async () => {
    const w = await player.read();
    return w.snap.phase === 'debrief' || w.ui.phase === 'debrief' ? w : null;
  }, { timeoutMs: 60000, intervalMs: 400, label: 'debrief' }).catch(() => null);
  await sleep(800);
  d = await player.dom();
  await player.shot('25-debrief');
  report.check('F7', 'the debrief names the run and what was carried out',
    Boolean(debrief) && Boolean(d.debriefTitle),
    `title="${d.debriefTitle}" outcome="${d.debriefOutcome}" keepsake="${d.debriefKeepsake}"`, '25-debrief');

  await player.page.getByRole('button', { name: /^Return to headquarters/ }).click().catch(() => {});
  await waitFor(async () => ((await player.read()).snap.phase === 'headquarters'), { timeoutMs: 20000, label: 'back in HQ' }).catch(() => {});
  await sleep(1800);
  s = await player.read();
  d = await player.dom();
  await player.shot('26-hub-after-run');
  report.check('F8', 'the hub shows the run: quartermaster line, records, relic shelf, memories',
    s.snap.phase === 'headquarters' && s.ui.memories > 0 && Boolean(d.hqSpeech) && (d.hqRecords.length > 0 || d.memoryCards.length > 0),
    `phase=${s.snap.phase}; memories=${s.ui.memories}; quartermaster="${(d.hqSpeech ?? '').slice(0, 160)}"; records=${J(d.hqRecords.slice(0, 3))}; shelf="${(d.hqShelf ?? '').slice(0, 120)}"; memory cards=${J(d.memoryCards.slice(0, 4))}`, '26-hub-after-run');
}

/**
 * The whole thing, once, in one browser: cold hub, a real floors route through the biomes to the
 * Custodian, the ritual, the collapse and the debrief. This is the run that decides whether
 * floors are demo-ready; give it `--minutes 40`.
 */
async function groupFullRun(ctx) {
  await groupHub(ctx);
  const s0 = await ctx.player.read();
  if (s0?.snap.phase !== 'expedition') return;
  await groupBiome(ctx);
  await groupAttune(ctx);
  await groupDeep(ctx);
  const s = await ctx.player.read();
  if (s?.snap.phase === 'expedition' && (s.room?.isFinal || s.room?.feature === 'anchor')) {
    await finaleTail(ctx);
  } else {
    ctx.report.add('F1', 'the Custodian was reached by playing the floors route', 'SKIP',
      `the bot got as far as ${J(ctx.deepest)} in the time budget; phase=${s?.snap.phase} room=${s?.room?.id} isFinal=${s?.room?.isFinal}`);
  }
}

/** Legacy mode: flags off, the three-room world and the Guardian. */
async function groupLegacy(ctx) {
  const { report, player, args } = ctx;
  await player.open(q(args));
  await sleep(1500);
  let s = await player.read();
  report.check('L1', 'with the flags off the hub still boots and the world is a legacy 3-room world',
    s.snap.phase === 'headquarters',
    `phase=${s.snap.phase}; /api/config=${J(ctx.servers.config)}`);
  await contribute(player, 'a brake lever nobody pulled');
  const prepared = await prepareWorld(player);
  await sleep(600);
  s = await player.read();
  const d = await player.dom();
  await player.shot('30-legacy-world');
  report.check('L2', 'legacy world: three rooms, no floors, honest receipt',
    s.world.floors === false && Boolean(d.provenance),
    `${(prepared.ms / 1000).toFixed(1)} s; title="${s.world.title}" floors=${s.world.floors} provenance="${d.provenance}" receipt=${J(d.receipt)}`, '30-legacy-world');
  const gate = await takeTheGate(player);
  await sleep(1200);
  report.check('L3', 'the gate starts the legacy run', gate.entered, `entered=${gate.entered} after ${(gate.ms / 1000).toFixed(1)} s`);
  if (!gate.entered) return;

  const deadline = Date.now() + ctx.args.minutes * 60_000;
  const phases = new Set();
  const stages = new Set();
  let furthest = 0;
  while (Date.now() < deadline) {
    const w = await player.read();
    if (w.snap.phase !== 'expedition') break;
    furthest = Math.max(furthest, w.snap.roomIndex);
    for (const e of w.snap.enemies) if (e.bossPhase) phases.add(e.bossPhase);
    if (!w.snap.roomCleared) {
      const r = await fightUntil(player, { timeoutMs: Math.min(150000, Math.max(2000, deadline - Date.now())) });
      if (r === 'downed') {
        const back = await waitFor(async () => {
          const p = await player.read();
          return p.snap.phase !== 'expedition' || (p.snap.players.find((q) => q.id === p.id)?.hp ?? 0) > 0 ? p : null;
        }, { timeoutMs: 15000, intervalMs: 300, label: 'down resolved' }).catch(() => null);
        if (!back || back.snap.phase !== 'expedition') break;
      }
      continue;
    }
    if (!w.room?.isFinal) {
      const door = w.room.exits[0];
      const before = w.snap.roomIndex;
      await walkTo(player, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 25000, until: (p) => p.snap.roomIndex !== before });
      await sleep(1000);
      continue;
    }
    const anchor = w.snap.anchor;
    if (!anchor) break;
    if (w.ui.hud?.collapse) break;
    const r = anchor.ritual;
    if (r) stages.add(`${r.stage}#${r.activeRelay ?? ''}`);
    const target = r && r.stage !== 'core' && r.relays?.[r.activeRelay] ? r.relays[r.activeRelay] : anchor;
    await walkTo(player, target, { arriveDist: 26, timeoutMs: 20000 });
    await player.focusStage();
    await player.page.keyboard.down('f');
    const tHold = Date.now();
    while (Date.now() - tHold < 8000) {
      const p = await player.read();
      if (p.snap.phase !== 'expedition' || p.ui.hud?.collapse) break;
      const pr = p.snap.anchor?.ritual;
      if (pr) stages.add(`${pr.stage}#${pr.activeRelay ?? ''}`);
      if (pr && (pr.stage !== r?.stage || pr.activeRelay !== r?.activeRelay)) break;
      await sleep(120);
    }
    await player.page.keyboard.up('f');
  }
  await player.shot('31-legacy-progress');
  const w = await player.read();
  report.check('L4', 'legacy: three rooms, the Guardian and the three-relay ritual, solo',
    furthest >= 2 && phases.size >= 1 && stages.size >= 2,
    `furthest room index=${furthest}; boss phases=${J([...phases])}; ritual stages=${J([...stages])}; phase now=${w.snap.phase}; collapse=${J(w.ui.hud?.collapse?.stage ?? null)}`, '31-legacy-progress');
}

/** Each fixture, into biome 1, with its authored laws on: how long does a solo class last? */
async function groupFixtures(ctx) {
  const { report, player, args } = ctx;
  const seen = new Map();
  for (let attempt = 0; attempt < 10 && seen.size < 3; attempt++) {
    await player.open(q(args));
    await sleep(1200);
    await contribute(player, `attempt ${attempt}: a tag nobody countersigned`);
    const prepared = await prepareWorld(player).catch(() => null);
    if (!prepared) continue;
    const s = await player.read();
    const id = s.world?.fixtureId;
    if (!id || seen.has(id)) continue;

    // Pick the class under test at its weapon stand, with real input.
    const [sx, sy] = HQ_STATION_TILE[args.klass] ?? HQ_STATION_TILE.bastion;
    await walkTo(player, centre({ col: sx, row: sy + 1 }), { arriveDist: 26, timeoutMs: 30000 });
    await player.focusStage();
    await player.tap('f', 160);
    await sleep(700);
    const picked = (await player.read()).ui.classId;

    const gate = await takeTheGate(player);
    if (!gate.entered) { seen.set(id, { id, error: 'never entered' }); continue; }
    const stats = { dodges: 0, hpLow: 100 };
    const t0 = Date.now();
    let cleared = 0;
    let outcome = 'survived';
    const visited = new Set();
    while (cleared < 5 && Date.now() - t0 < 6 * 60_000) {
      const w = await player.read();
      if (w.snap.phase !== 'expedition') { outcome = w.snap.phase; break; }
      if (w.snap.floor) visited.add(w.snap.floor.roomId);
      const living = w.snap.enemies.filter((e) => e.state !== 'dead' && e.hp > 0);
      if (living.length && !w.snap.roomCleared) {
        const r = await fightUntil(player, { timeoutMs: 120000, stats });
        if (r === 'cleared') cleared++;
        if (r === 'downed') {
          const back = await waitFor(async () => {
            const p = await player.read();
            return p.snap.phase !== 'expedition' || (p.snap.players.find((q) => q.id === p.id)?.hp ?? 0) > 0 ? p : null;
          }, { timeoutMs: 15000, intervalMs: 300, label: 'down' }).catch(() => null);
          if (!back || back.snap.phase !== 'expedition') { outcome = 'downed'; break; }
        }
        continue;
      }
      const exits = w.room?.exits ?? [];
      if (!exits.length) { outcome = 'dead-end'; break; }
      const before = w.snap.floor?.roomId ?? w.snap.roomIndex;
      const door = exits.find((e) => !visited.has(e.toRoomId)) ?? exits[0];
      const moved = await walkTo(player, centre({ col: door.x, row: door.y }), { arriveDist: 3, timeoutMs: 25000, until: (p) => (p.snap.floor?.roomId ?? p.snap.roomIndex) !== before });
      await sleep(700);
      if (!moved && (await player.read()).snap.floor?.roomId === before) { outcome = 'stuck'; break; }
    }
    await player.shot(`40-fixture-${id}`);
    const w = await player.read();
    const me = w.snap.players.find((p) => p.id === w.id);
    seen.set(id, {
      id, title: w.world?.title, laws: w.world?.laws, klass: picked, cleared, outcome,
      minutes: ((Date.now() - t0) / 60000).toFixed(1), hpEnd: me?.hp ?? null, hpLow: stats.hpLow, dodges: stats.dodges,
    });
    report.check(`X-${id}`, `fixture ${id}: solo ${picked} through its first rooms with the authored laws on`,
      cleared >= 3,
      `${J(seen.get(id))}`, `40-fixture-${id}`);
  }
  report.check('X0', 'all three shipped fixtures were entered', seen.size === 3, `fixtures reached: ${J([...seen.keys()])}`);
  ctx.fixtureRuns = [...seen.values()];
}

/** Audio: the graph must not start before a gesture and must be running after one. */
async function groupAudio(ctx) {
  const { report, player, args } = ctx;
  await player.open(q(args), { spyAudio: true });
  await sleep(2500);
  const beforeStates = await player.audioStates();
  const domBefore = await player.dom();
  // A real gesture: a keyboard tap on the stage.
  await player.focusStage();
  await player.tap('w', 200);
  await player.tap('j', 80);
  await sleep(1500);
  const afterStates = await player.audioStates();
  await player.shot('50-audio');
  report.check('AU1', 'a WebAudio graph exists and is running only after a real gesture',
    afterStates.some((s) => s === 'running'),
    `AudioContext states before any input: ${J(beforeStates)}; after a keyboard gesture: ${J(afterStates)}; SOUND control on screen="${domBefore.soundToggle}"`, '50-audio');

  // Mute, reload, and check it stuck.
  const toggle = player.page.getByRole('button', { name: /SOUND/i }).first();
  const had = await toggle.count().then((c) => c > 0).catch(() => false);
  if (had) { await toggle.click().catch(() => {}); await sleep(600); }
  const mutedBefore = (await player.read()).ui.audioMuted;
  await player.open(q(args), { freshContext: false, spyAudio: true });
  await sleep(2000);
  const mutedAfter = (await player.read()).ui.audioMuted;
  const d = await player.dom();
  report.check('AU2', 'the mute choice survives a reload',
    had && mutedBefore === true && mutedAfter === true,
    `control found=${had}; muted before reload=${mutedBefore}, after reload=${mutedAfter}; control now reads "${d.soundToggle}"`);
  const audioErrors = player.errors.filter((e) => /audio|AudioContext|decode/i.test(e));
  report.check('AU3', 'no audio-related console errors during a play gesture',
    audioErrors.length === 0,
    audioErrors.length ? J(audioErrors.slice(0, 4)) : 'none; HEARING the cues is still a human check (attack, hit, door seal, canister, ritual)');
}

/** A cold browser with `?hints=reset`: prompts must appear, and must never block play. */
async function groupOnboarding(ctx) {
  const { report, player, args } = ctx;
  await player.open(q({ ...args, hints: 'reset' }));
  await sleep(2500);
  let d = await player.dom();
  await player.shot('60-hints-hub');
  const firstPrompt = d.coach;
  report.check('O1', 'a cold browser is greeted by a coach prompt at the hub',
    Boolean(firstPrompt),
    `?hints=reset; prompt="${firstPrompt}" key="${d.coachKey}"; hub wayfinder="${d.hqPromptButton ?? ''}"`, '60-hints-hub');

  // The prompt must not eat input: walk, and check the operative actually moved.
  await player.focusStage();
  const x0 = (await player.me())?.x ?? 0;
  await player.page.keyboard.down('d');
  await sleep(700);
  await player.page.keyboard.up('d');
  await sleep(250);
  const x1 = (await player.me())?.x ?? 0;
  const d2 = await player.dom();
  report.check('O2', 'coach prompts never block movement or the stage',
    Math.abs(x1 - x0) > 10,
    `with a prompt on screen ("${d2.coach ?? firstPrompt}") the operative walked x ${Math.round(x0)} -> ${Math.round(x1)}`);

  // And ?hints=off silences them.
  await player.open(q({ ...args, hints: 'off' }));
  await sleep(2500);
  const d3 = await player.dom();
  await player.shot('61-hints-off');
  report.check('O3', '?hints=off silences the prompts for a capture run',
    !d3.coach,
    `with ?hints=off the coach line is ${d3.coach === null ? 'absent' : `still "${d3.coach}"`}`, '61-hints-off');
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const GROUPS = { hub: groupHub, biome: groupBiome, attune: groupAttune, deep: groupDeep, finale: groupFinale, legacy: groupLegacy, fixtures: groupFixtures, audio: groupAudio, onboarding: groupOnboarding, fullrun: groupFullRun };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  await fs.promises.mkdir(args.outDir, { recursive: true });
  const groups = args.only ?? (args.legacy ? ['legacy'] : ['hub', 'biome', 'attune', 'deep']);
  const servers = new Servers(args);
  const cleanup = () => servers.stopAll();
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(1));
  process.on('SIGTERM', () => process.exit(1));

  await servers.start();
  console.log(`[solo] base=${servers.base} config=${J(servers.config)} groups=${J(groups)}`);
  const playwright = await ensurePlaywright(args.depsDir);
  const browser = await playwright.chromium.launch({ headless: true, args: GL_ARGS[args.gl] ?? GL_ARGS.swiftshader });
  const report = new Report(args.outDir);
  const player = new Player(browser, servers.base, { width: args.width, height: args.height }, args.outDir);
  const ctx = { args, report, servers, player, stats: { dodges: 0, hpLow: 100 } };
  try {
    for (const group of groups) {
      if (!GROUPS[group]) throw new Error(`unknown group "${group}"`);
      console.log(`\n--- group: ${group} ---`);
      try {
        await GROUPS[group](ctx);
      } catch (err) {
        await player.shot(`error-${group}`);
        report.add(`${group}!`, `group "${group}" aborted`, 'FAIL', String(err?.stack ?? err).slice(0, 700), `error-${group}`);
      }
    }
  } finally {
    const pageErrors = player.errors.filter((e) => e.startsWith('pageerror'));
    const consoleErrors = player.errors.filter((e) => e.startsWith('console'));
    report.check('E1', 'no uncaught page errors over the whole session', pageErrors.length === 0,
      pageErrors.length ? J(pageErrors.slice(0, 6)) : `0 uncaught page errors; ${consoleErrors.length} console.error line(s)${consoleErrors.length ? `: ${J(consoleErrors.slice(0, 4))}` : ''}`);
    if (ctx.fixtureRuns) console.log(`\nfixture runs: ${J(ctx.fixtureRuns, null, 2)}`);
    if (ctx.deepest) console.log(`deepest solo progress: ${J(ctx.deepest)}`);
    await browser.close().catch(() => {});
    servers.stopAll();
  }
  return report.print() ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[solo] FATAL:', err?.stack ?? err);
  process.exit(2);
});
