/**
 * The Custodian's runtime: which pattern is next, what a pattern does when its telegraph
 * expires, the phase-2 terrain twist and the phase-3 relay shield.
 *
 * Spec: docs/design/BOSS_FINALE.md §2–§5. Owner: Agent B1.
 *
 * All of it lives here rather than in `simulation.ts` so the shared file keeps only small
 * call-site hooks (`beginCustodianPattern`, `resolveCustodianPattern`, `stepCustodian`,
 * `custodianIncomingDamage`, `custodianPhase`). Nothing in this module reads global state:
 * everything it needs arrives in a `BossContext` the simulation builds once per tick.
 *
 * Determinism: no Math.random and no wall clock. The only randomness is a seeded RNG keyed
 * by the enemy id and its attack counter, so a replay of the same intents is identical.
 */
import type { EnemyState, EnemyTelegraph, GameEventInput, RoomSpec } from '../shared/contracts';
import { TICK_MS, TILE_SIZE, tileToWorld, worldToTile } from '../shared/conventions';
import {
  CLOSE_RECOVERY_MS, CUSTODIAN_PATTERNS, CUSTODIAN_SHIELD_DR, PHASE2_CHAIN_MS, PHASE_COOLDOWN_MS,
  RANGED_RECOVERY_MS, RELAY_INERT_ROTATE_MS, RELAY_LATCH_ARM_MS, RELAY_LATCH_MS, RELAY_LATCH_MS_SOLO,
  capCustodianHit, custodianTitle, gatekeeperTier, telegraphMsFor,
  type CustodianPatternId, type ResolvedCustodian,
} from '../shared/custodian';
import { createRng, seedKey } from '../shared/floorgen/rng';
import { terrainTileAt } from '../shared/terrain';
import type { EnemyId } from '../shared/registry';

export interface BossPlayerView {
  id: string;
  x: number;
  y: number;
  hp: number;
  hidden: boolean;
}

export interface BossBolts {
  count: number;
  spacing: number;
  speed: number;
  radius: number;
  life: number;
}

/** Everything the boss may do to the world. The simulation owns each of these verbs. */
export interface BossContext {
  room: RoomSpec;
  /** Living operatives, in the simulation's deterministic order. */
  players(): BossPlayerView[];
  damagePlayer(playerId: string, sourceEnemyId: string, damage: number, ranged: boolean): boolean;
  /** Collision-aware nudge of a player by a world-space delta. */
  pushPlayer(playerId: string, dx: number, dy: number): void;
  slowPlayer(playerId: string, ms: number): void;
  /** Collision-aware move of an enemy (the boss itself, or something a well pulls). */
  pushEnemy(enemyId: string, dx: number, dy: number): void;
  teleportEnemy(enemyId: string, x: number, y: number): void;
  /** Straight line of sight on the room grid. */
  sees(a: { x: number; y: number }, b: { x: number; y: number }): boolean;
  fireBolts(ownerEnemyId: string, x: number, y: number, facing: number, kind: 'ring' | 'volley' | 'spread', bolts: BossBolts, damage: number): void;
  /** Spawns an add of the biome's own kind; `tag` groups a wave so phase 3 can gate on it. */
  spawnAdd(enemyId: EnemyId, near: { x: number; y: number }, tag: string, hpScale?: number): string | null;
  /** Living enemies other than this one, for gravity_well and the phase gate. */
  otherEnemies(): Array<{ id: string; x: number; y: number }>;
  aliveWithTag(tag: string): boolean;
  /** Non-boss enemy ids this biome may spawn. */
  enemyPool(): EnemyId[];
  emit(event: GameEventInput): void;
  /** Phase-3 relays: the three ritual sites, already in world coordinates. */
  relays(): Array<{ x: number; y: number }> | null;
  /** Reports the shield/latch state back to the ritual so the snapshot and renderer can show it. */
  setRelayState(index: number, state: { latchedMs: number; inert: boolean }): void;
}

/** A hazard field a pattern (or the phase-2 corruption) has laid on the floor. */
export interface BossField {
  patternId: CustodianPatternId | null;
  /** `col,row` keys of tiles the pattern has marked. */
  tiles: string[];
  /** false while the tiles are only a warning. */
  live: boolean;
  remainingMs: number;
  /** Tiles the phase-2 corruption turned hostile for the rest of the fight. */
  corrupted: string[];
}

interface Pending {
  delayMs: number;
  action: 'ring_two' | 'vent_pulse';
  data?: number;
}

export interface CustodianRuntime {
  custodian: ResolvedCustodian;
  /** Which of the three moves this enemy may use. The Custodian has all three; a gatekeeper one or two. */
  moveIndices: number[];
  telegraphScale: number;
  /** Gatekeepers never leave phase 1. */
  maxPhase: 1 | 2 | 3;
  cursor: number;
  patternId: CustodianPatternId;
  firstUse: boolean;
  used: Set<CustodianPatternId>;
  /** No-repeat rule: never run the same pattern three times in a row. */
  lastPatternId: CustodianPatternId | null;
  repeats: number;
  /** Phase 2 chains patterns in pairs; >0 means the second half is owed. */
  chainOwed: number;
  /** Incoming damage multiplier while a vulnerable cast is running. */
  vulnerability: number;
  /** Phase-3 shield: damage reduction from relays held. */
  shieldDr: number;
  shielded: boolean;
  inertRelay: number;
  inertMs: number;
  latched: number[];
  armed: number[];
  sweep: { angle: number; remainingMs: number; hit: Set<string> } | null;
  haul: { playerId: string; remainingMs: number } | null;
  pull: number;
  pylons: { points: Array<{ x: number; y: number }>; remainingMs: number; channelMs: number } | null;
  field: BossField;
  hazardCooldown: Map<string, number>;
  pending: Pending[];
  waveTag: string | null;
  corruptionDone: boolean;
  ringStep: number;
  ringMs: number;
  attacks: number;
}

const HAZARD_TICK_MS = 600;
const CORRUPTION_DAMAGE = 10;
const RING_BOLTS: BossBolts = { count: 12, spacing: (Math.PI * 2) / 12, speed: 240, radius: 6, life: 1600 };
const SWEEP_RATE = (300 * Math.PI / 180) / 1.4; // 300 degrees over 1400 ms, in radians per second
const SWEEP_MS = 1400;
const SWEEP_DEAD_ZONE = 70;
const CHARGE_KNOCKBACK = 140;
const HAUL_MS = 500;
const HAUL_DISTANCE = 180;
const HAUL_SLOW_MS = 2000;
const PULL_MS = 2000;
const PULL_SPEED = 90;
const FLOOD_LIVE_MS = 2500;
const FLOOD_WARN_MS = 0;
const FLOOD_SHARE = 0.4;
const PYLON_MS = 6000;
const PYLON_CHANNEL_MS = 3000;
const VENT_PULSES = 3;
const VENT_CADENCE_MS = 900;
const VENT_RADIUS = 46;
const SHATTER_BURST_RANGE = 240;
const DECOY_COUNT = 2;
/** The arena-shrink fallback when a room has no conduits or rubble to corrupt. */
const RING_CLOSE_MS = 20_000;
const RING_MAX = 3;

export function createCustodianRuntime(options: {
  custodian: ResolvedCustodian;
  moveIndices?: number[];
  telegraphScale?: number;
  maxPhase?: 1 | 2 | 3;
}): CustodianRuntime {
  const moveIndices = options.moveIndices ?? [0, 1, 2];
  const first = options.custodian.moves[moveIndices[0] ?? 0]?.patternId ?? options.custodian.moves[0]!.patternId;
  return {
    custodian: options.custodian,
    moveIndices,
    telegraphScale: options.telegraphScale ?? 1,
    maxPhase: options.maxPhase ?? 3,
    cursor: 0,
    patternId: first,
    firstUse: true,
    used: new Set(),
    lastPatternId: null,
    repeats: 0,
    chainOwed: 0,
    vulnerability: 1,
    shieldDr: 0,
    shielded: false,
    inertRelay: -1,
    inertMs: RELAY_INERT_ROTATE_MS,
    latched: [0, 0, 0],
    armed: [0, 0, 0],
    sweep: null,
    haul: null,
    pull: 0,
    pylons: null,
    field: { patternId: null, tiles: [], live: false, remainingMs: 0, corrupted: [] },
    hazardCooldown: new Map(),
    pending: [],
    waveTag: null,
    corruptionDone: false,
    ringStep: 0,
    ringMs: RING_CLOSE_MS,
    attacks: 0,
  };
}

function moveOf(rt: CustodianRuntime, id: CustodianPatternId) {
  return rt.custodian.moves.find((move) => move.patternId === id) ?? rt.custodian.moves[0]!;
}

function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

function rngFor(enemyId: string, salt: string | number): ReturnType<typeof createRng> {
  return createRng(seedKey('custodian', enemyId, salt));
}

/** Walkable floor tiles of the room; the arena patterns draw from these and nothing else. */
function floorTiles(room: RoomSpec): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < room.height; row++) {
    for (let col = 0; col < room.width; col++) {
      const ch = room.tiles[row]?.[col];
      if (ch === '.' || ch === ':' || ch === '+' || ch === 'P' || ch === '=' || ch === '>') out.push({ col, row });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pattern selection
// ---------------------------------------------------------------------------

/** Advances the cycle, honouring the no-repeat rule. Called when a pattern resolves. */
function nextPattern(rt: CustodianRuntime, phase: 1 | 2 | 3): void {
  if (phase === 3 && rt.maxPhase === 3) {
    // Phase 3 is deliberately fewer moves, not more: the crew's attention is on the relays.
    rt.patternId = rt.patternId === 'ring_bloom' ? rt.custodian.moves[2]!.patternId : 'ring_bloom';
    if (rt.patternId === rt.lastPatternId && rt.repeats >= 2) rt.patternId = rt.custodian.moves[2]!.patternId;
    rt.firstUse = !rt.used.has(rt.patternId);
    return;
  }
  for (let attempt = 0; attempt < rt.moveIndices.length + 1; attempt++) {
    rt.cursor = (rt.cursor + 1) % rt.moveIndices.length;
    const id = rt.custodian.moves[rt.moveIndices[rt.cursor]!]!.patternId;
    if (id === rt.lastPatternId && rt.repeats >= 2 && rt.moveIndices.length > 1) continue;
    rt.patternId = id;
    break;
  }
  rt.firstUse = !rt.used.has(rt.patternId);
}

export function custodianPatternSpec(rt: CustodianRuntime) {
  return CUSTODIAN_PATTERNS[rt.patternId];
}

/** The engagement envelope of the pattern that is queued up. Pure: safe to call every tick. */
export function custodianEngagement(rt: CustodianRuntime): { kind: EnemyTelegraph['kind']; range: number; arc: number } {
  const spec = custodianPatternSpec(rt);
  return { kind: spec.telegraph, range: spec.range, arc: spec.arcRad };
}

/**
 * Commits the queued pattern: returns where the telegraph is drawn and how long it lasts,
 * and emits `boss_pattern_started` (with the world's name for the move) exactly once.
 */
export function beginCustodianPattern(
  rt: CustodianRuntime, s: EnemyState, ctx: BossContext,
): { x: number; y: number; remainingMs: number } {
  const spec = custodianPatternSpec(rt);
  const phase = (s.bossPhase ?? 1) as 1 | 2 | 3;
  const firstUse = rt.firstUse && !rt.used.has(rt.patternId);
  const move = moveOf(rt, rt.patternId);
  let x = s.x;
  let y = s.y;
  if (rt.patternId === 'shatter_step') {
    // The after-image is the read: the telegraph is drawn where the boss will arrive.
    const target = farthestPlayer(ctx, s);
    if (target) {
      x = target.x;
      y = target.y;
    }
  }
  ctx.emit({ type: 'boss_pattern_started', enemyId: s.id, patternId: rt.patternId, name: move.name, tell: move.tell, firstUse });
  rt.used.add(rt.patternId);
  rt.firstUse = false;
  if (rt.patternId === 'summon_choir') rt.vulnerability = 1.25;
  if (rt.patternId === 'overload_vent') rt.vulnerability = 1.3;
  return {
    x, y,
    remainingMs: Math.round(telegraphMsFor(spec, phase, firstUse) * rt.telegraphScale),
  };
}

function farthestPlayer(ctx: BossContext, from: { x: number; y: number }, needsSight = false): BossPlayerView | null {
  const living = ctx.players().filter((p) => p.hp > 0 && (!needsSight || ctx.sees(from, p)));
  if (living.length === 0) return null;
  return living.reduce((best, p) =>
    Math.hypot(p.x - from.x, p.y - from.y) > Math.hypot(best.x - from.x, best.y - from.y) ? p : best);
}

// ---------------------------------------------------------------------------
// Resolving a pattern
// ---------------------------------------------------------------------------

export interface CustodianResolution {
  recoveryMs: number;
  cooldownMs: number;
  /** True when the boss moved itself (charge/teleport) so the caller can re-run its facing. */
  moved: boolean;
}

export function resolveCustodianPattern(
  rt: CustodianRuntime, s: EnemyState, telegraph: EnemyTelegraph, ctx: BossContext,
): CustodianResolution {
  const id = rt.patternId;
  const spec = CUSTODIAN_PATTERNS[id];
  const phase = (s.bossPhase ?? 1) as 1 | 2 | 3;
  let moved = false;
  rt.vulnerability = 1;
  switch (id) {
    case 'sweep_arc':
      rt.sweep = { angle: telegraph.facing - SWEEP_RATE * (SWEEP_MS / 1000) / 2, remainingMs: SWEEP_MS, hit: new Set() };
      break;
    case 'siege_charge': {
      for (const p of ctx.players()) {
        if (!inCone(telegraph, p, telegraph.facing, spec.range, spec.arcRad) || !ctx.sees(telegraph, p)) continue;
        if (ctx.damagePlayer(p.id, s.id, spec.damage, false)) {
          ctx.pushPlayer(p.id, Math.cos(telegraph.facing) * CHARGE_KNOCKBACK, Math.sin(telegraph.facing) * CHARGE_KNOCKBACK);
        }
      }
      ctx.pushEnemy(s.id, Math.cos(telegraph.facing) * spec.range, Math.sin(telegraph.facing) * spec.range);
      moved = true;
      break;
    }
    case 'ring_bloom':
      ctx.fireBolts(s.id, s.x, s.y, telegraph.facing, 'ring', RING_BOLTS, spec.damage);
      rt.pending.push({ delayMs: 500, action: 'ring_two' });
      break;
    case 'summon_choir': {
      const pool = ctx.enemyPool().filter((enemyId) => enemyId !== 'guardian');
      if (pool.length > 0) {
        const rng = rngFor(s.id, `choir:${rt.attacks}`);
        const tag = `choir-${rt.attacks}`;
        for (let i = 0; i < 4; i++) ctx.spawnAdd(rng.pick(pool), s, tag);
      }
      break;
    }
    case 'tether_haul': {
      // The counterplay is the line itself: break sight before it fires and the haul finds nobody.
      const target = farthestPlayer(ctx, s, true);
      if (target) {
        ctx.damagePlayer(target.id, s.id, spec.damage, true);
        ctx.slowPlayer(target.id, HAUL_SLOW_MS);
        rt.haul = { playerId: target.id, remainingMs: HAUL_MS };
      }
      break;
    }
    case 'arena_flood':
      rt.field = { patternId: id, tiles: floodTiles(ctx.room, s.id, rt.attacks), live: FLOOD_WARN_MS === 0, remainingMs: FLOOD_LIVE_MS, corrupted: rt.field.corrupted };
      break;
    case 'mirror_shade': {
      const tag = `shade-${rt.attacks}`;
      for (let i = 0; i < DECOY_COUNT; i++) ctx.spawnAdd('guardian', s, tag, 0);
      break;
    }
    case 'pylon_lock':
      rt.pylons = { points: pylonPoints(ctx.room, s), remainingMs: PYLON_MS, channelMs: PYLON_CHANNEL_MS };
      break;
    case 'gravity_well':
      rt.pull = PULL_MS;
      break;
    case 'shatter_step': {
      ctx.teleportEnemy(s.id, telegraph.x, telegraph.y);
      moved = true;
      for (const p of ctx.players()) {
        if (Math.hypot(p.x - telegraph.x, p.y - telegraph.y) > SHATTER_BURST_RANGE) continue;
        ctx.damagePlayer(p.id, s.id, spec.damage, false);
      }
      break;
    }
    case 'overload_vent':
      rt.field = { patternId: id, tiles: ventTiles(ctx.room, s.id, rt.attacks), live: false, remainingMs: VENT_PULSES * VENT_CADENCE_MS, corrupted: rt.field.corrupted };
      for (let pulse = 0; pulse < VENT_PULSES; pulse++) rt.pending.push({ delayMs: VENT_CADENCE_MS * (pulse + 1), action: 'vent_pulse' });
      break;
  }
  rt.attacks++;
  rt.repeats = id === rt.lastPatternId ? rt.repeats + 1 : 1;
  rt.lastPatternId = id;
  const recoveryMs = spec.patternClass === 'close' ? CLOSE_RECOVERY_MS : RANGED_RECOVERY_MS;
  let cooldownMs: number = PHASE_COOLDOWN_MS[phase - 1]!;
  if (phase === 2 && rt.maxPhase === 3) {
    // Phase 2 chains patterns in pairs: 400 ms between the halves, then a real rest.
    if (rt.chainOwed > 0) rt.chainOwed = 0;
    else {
      rt.chainOwed = 1;
      cooldownMs = PHASE2_CHAIN_MS;
    }
  }
  nextPattern(rt, phase);
  return { recoveryMs, cooldownMs, moved };
}

function inCone(from: { x: number; y: number }, to: { x: number; y: number }, facing: number, range: number, arc: number): boolean {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d > range) return false;
  if (arc >= Math.PI * 2) return true;
  const delta = Math.atan2(to.y - from.y, to.x - from.x) - facing;
  return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) <= arc / 2;
}

/** A lane or checker of marked tiles that always leaves a contiguous route. */
function floodTiles(room: RoomSpec, enemyId: string, salt: number): string[] {
  const tiles = floorTiles(room);
  const rng = rngFor(enemyId, `flood:${salt}`);
  const checker = rng.chance(0.5);
  const parity = rng.int(2);
  const marked = tiles.filter(({ col, row }) => checker ? (col + row) % 2 === parity : col % 3 === parity);
  // Never mark more than the design's share: the safe route is what makes this readable.
  const limit = Math.floor(tiles.length * FLOOD_SHARE);
  return marked.slice(0, limit).map(({ col, row }) => tileKey(col, row));
}

/** The room's own vents if the tile set ever grows one; otherwise the boss makes its own. */
function ventTiles(room: RoomSpec, enemyId: string, salt: number): string[] {
  const tiles = floorTiles(room);
  const rng = rngFor(enemyId, `vent:${salt}`);
  const count = Math.max(3, Math.min(8, Math.round(tiles.length / 40)));
  const picked: string[] = [];
  for (let i = 0; i < count && tiles.length > 0; i++) {
    const tile = rng.pick(tiles);
    const key = tileKey(tile.col, tile.row);
    if (!picked.includes(key)) picked.push(key);
  }
  return picked;
}

function pylonPoints(room: RoomSpec, s: { x: number; y: number }): Array<{ x: number; y: number }> {
  const radius = Math.min(room.width, room.height) * TILE_SIZE * 0.3;
  return [0, 1, 2].map((i) => {
    const angle = (i * Math.PI * 2) / 3;
    return { x: s.x + Math.cos(angle) * radius, y: s.y + Math.sin(angle) * radius };
  });
}

// ---------------------------------------------------------------------------
// Per-tick effects
// ---------------------------------------------------------------------------

/** True while the boss must hold still (a live sweep, a vent purge, a pylon channel). */
export function custodianBusy(rt: CustodianRuntime): boolean {
  return rt.sweep !== null || rt.pylons !== null || rt.pending.some((p) => p.action === 'vent_pulse');
}

/** Runs everything the Custodian has in flight. Called once per tick before its attack logic. */
export function stepCustodian(rt: CustodianRuntime, s: EnemyState, ctx: BossContext): void {
  const spec = CUSTODIAN_PATTERNS[rt.patternId];
  for (const pending of rt.pending) pending.delayMs -= TICK_MS;
  const due = rt.pending.filter((p) => p.delayMs <= 0);
  rt.pending = rt.pending.filter((p) => p.delayMs > 0);
  for (const action of due) {
    if (action.action === 'ring_two') {
      ctx.fireBolts(s.id, s.x, s.y, s.facing + RING_BOLTS.spacing / 2, 'ring', RING_BOLTS, CUSTODIAN_PATTERNS.ring_bloom.damage);
    } else if (action.action === 'vent_pulse') {
      for (const key of rt.field.tiles) {
        const [col, row] = key.split(',').map(Number);
        const at = tileToWorld(col!, row!);
        for (const p of ctx.players()) {
          if (Math.hypot(p.x - at.x, p.y - at.y) > VENT_RADIUS) continue;
          ctx.damagePlayer(p.id, s.id, CUSTODIAN_PATTERNS.overload_vent.damage, false);
        }
      }
      rt.field = { ...rt.field, live: true };
    }
  }
  if (rt.sweep) {
    rt.sweep.remainingMs -= TICK_MS;
    rt.sweep.angle += SWEEP_RATE * TICK_MS / 1000;
    const sweepSpec = CUSTODIAN_PATTERNS.sweep_arc;
    for (const p of ctx.players()) {
      if (rt.sweep.hit.has(p.id)) continue;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < SWEEP_DEAD_ZONE || d > sweepSpec.range) continue;
      if (!inCone(s, p, rt.sweep.angle, sweepSpec.range, sweepSpec.arcRad) || !ctx.sees(s, p)) continue;
      if (ctx.damagePlayer(p.id, s.id, sweepSpec.damage, true)) rt.sweep.hit.add(p.id);
    }
    s.facing = rt.sweep.angle;
    if (rt.sweep.remainingMs <= 0) rt.sweep = null;
  }
  if (rt.haul) {
    const target = ctx.players().find((p) => p.id === rt.haul!.playerId);
    if (!target) rt.haul = null;
    else {
      const step = HAUL_DISTANCE * TICK_MS / HAUL_MS;
      const d = Math.hypot(s.x - target.x, s.y - target.y) || 1;
      ctx.pushPlayer(target.id, (s.x - target.x) / d * step, (s.y - target.y) / d * step);
      rt.haul.remainingMs -= TICK_MS;
      if (rt.haul.remainingMs <= 0) rt.haul = null;
    }
  }
  if (rt.pull > 0) {
    const step = PULL_SPEED * TICK_MS / 1000;
    for (const p of ctx.players()) {
      const d = Math.hypot(s.x - p.x, s.y - p.y) || 1;
      if (d < 40) continue;
      ctx.pushPlayer(p.id, (s.x - p.x) / d * step, (s.y - p.y) / d * step);
    }
    for (const other of ctx.otherEnemies()) {
      const d = Math.hypot(s.x - other.x, s.y - other.y) || 1;
      if (d < 40) continue;
      ctx.pushEnemy(other.id, (s.x - other.x) / d * step, (s.y - other.y) / d * step);
    }
    rt.pull = Math.max(0, rt.pull - TICK_MS);
  }
  if (rt.pylons) {
    rt.pylons.remainingMs -= TICK_MS;
    rt.pylons.channelMs -= TICK_MS;
    if (rt.pylons.channelMs <= 0) {
      // The wedge the boss stands in is the dangerous one; the pylons are its edges.
      const wedge = Math.PI * 2 / 3;
      for (const p of ctx.players()) {
        const angle = Math.atan2(p.y - s.y, p.x - s.x);
        const delta = Math.abs(Math.atan2(Math.sin(angle - s.facing), Math.cos(angle - s.facing)));
        if (delta > wedge / 2) continue;
        ctx.damagePlayer(p.id, s.id, CUSTODIAN_PATTERNS.pylon_lock.damage, true);
      }
      rt.pylons.channelMs = PYLON_CHANNEL_MS;
    }
    if (rt.pylons.remainingMs <= 0) rt.pylons = null;
  }
  if (rt.field.remainingMs > 0) {
    rt.field.remainingMs = Math.max(0, rt.field.remainingMs - TICK_MS);
    if (rt.field.remainingMs === 0) rt.field = { ...rt.field, patternId: null, tiles: [], live: false };
  }
  stepHazardTiles(rt, s, ctx, spec.damage);
  stepCorruptionRing(rt, ctx);
  stepShield(rt, s, ctx);
}

/** A live flood tile, or a corrupted conduit, hurts anyone standing on it every 600 ms. */
function stepHazardTiles(rt: CustodianRuntime, s: EnemyState, ctx: BossContext, floodDamage: number): void {
  const live = rt.field.live && rt.field.patternId === 'arena_flood' ? rt.field.tiles : [];
  if (live.length === 0 && rt.field.corrupted.length === 0) return;
  for (const p of ctx.players()) {
    const cooldown = (rt.hazardCooldown.get(p.id) ?? 0) - TICK_MS;
    if (cooldown > 0) {
      rt.hazardCooldown.set(p.id, cooldown);
      continue;
    }
    const { col, row } = worldToTile(p.x, p.y);
    const key = tileKey(col, row);
    const onFlood = live.includes(key);
    const onCorrupt = rt.field.corrupted.includes(key);
    if (!onFlood && !onCorrupt) {
      rt.hazardCooldown.set(p.id, 0);
      continue;
    }
    ctx.damagePlayer(p.id, s.id, onFlood ? floodDamage : CORRUPTION_DAMAGE, false);
    rt.hazardCooldown.set(p.id, HAZARD_TICK_MS);
  }
}

/** Arena shrink: the fallback twist for a room with no terrain of its own to turn. */
function stepCorruptionRing(rt: CustodianRuntime, ctx: BossContext): void {
  if (!rt.corruptionDone || rt.ringStep >= RING_MAX || rt.ringStep < 1) return;
  rt.ringMs -= TICK_MS;
  if (rt.ringMs > 0) return;
  rt.ringMs = RING_CLOSE_MS;
  rt.ringStep++;
  rt.field.corrupted = perimeterTiles(ctx.room, rt.ringStep);
}

/** The `depth` rings of floor just inside the walls; never doors or the Anchor, so nothing seals. */
export function perimeterTiles(room: RoomSpec, depth: number): string[] {
  const keys: string[] = [];
  for (let row = 0; row < room.height; row++) {
    for (let col = 0; col < room.width; col++) {
      const ch = room.tiles[row]?.[col];
      if (ch === undefined || ch === '#' || ch === ' ' || ch === 'B' || ch === 'A' || ch === 'X') continue;
      const edge = Math.min(col, row, room.width - 1 - col, room.height - 1 - row);
      if (edge >= 1 && edge <= depth) keys.push(tileKey(col, row));
    }
  }
  return keys;
}

/**
 * Phase 3: the shield's damage reduction is a continuous function of how many relays the crew
 * holds, so solo play needs no special case — only a longer latch, which turns it into a route
 * problem instead of a hold-and-shoot problem.
 */
function stepShield(rt: CustodianRuntime, s: EnemyState, ctx: BossContext): void {
  if (!rt.shielded) return;
  const relays = ctx.relays();
  if (!relays) return;
  const living = ctx.players().filter((p) => p.hp > 0);
  const latchMs = living.length <= 1 ? RELAY_LATCH_MS_SOLO : RELAY_LATCH_MS;
  rt.inertMs -= TICK_MS;
  if (rt.inertMs <= 0) {
    rt.inertMs = RELAY_INERT_ROTATE_MS;
    rt.inertRelay = (rt.inertRelay + 1) % relays.length;
    rt.latched[rt.inertRelay] = 0;
    rt.armed[rt.inertRelay] = 0;
  }
  let held = 0;
  relays.forEach((relay, index) => {
    const inert = index === rt.inertRelay;
    const standing = !inert && living.some((p) => Math.hypot(p.x - relay.x, p.y - relay.y) <= RELAY_HOLD_RANGE);
    if (standing) {
      rt.armed[index] = Math.min(RELAY_LATCH_ARM_MS, (rt.armed[index] ?? 0) + TICK_MS);
      if (rt.armed[index]! >= RELAY_LATCH_ARM_MS) rt.latched[index] = latchMs;
    } else {
      rt.armed[index] = 0;
      rt.latched[index] = Math.max(0, (rt.latched[index] ?? 0) - TICK_MS);
    }
    if (standing || (rt.latched[index] ?? 0) > 0) held++;
    ctx.setRelayState(index, { latchedMs: rt.latched[index] ?? 0, inert });
  });
  // Risk of Rain 2's teleporter charges at a rate proportional to the FRACTION of living players
  // inside it, which is why it needs no solo special case. The shield reads the same way: what
  // feeds it is the relays the crew LEAVES cold, and a lone operative (one held, one latched) can
  // only ever leave two. So a crew of two or more sees the published table exactly, and solo tops
  // out at 0.6 instead of being walled out at 0.9.
  const steps = CUSTODIAN_SHIELD_DR.length - 1;
  const capacity = Math.max(1, Math.min(relays.length, living.length + 1));
  rt.shieldDr = CUSTODIAN_SHIELD_DR[steps - Math.min(steps, Math.max(0, capacity - held))]!;
  s.shieldDr = rt.shieldDr;
}

/** A relay counts as held while a living operative's centre is inside this range. */
export const RELAY_HOLD_RANGE = 42;

// ---------------------------------------------------------------------------
// Damage, phases, corruption
// ---------------------------------------------------------------------------

/** The anti-melt guard plus the phase-3 shield and any vulnerability window. */
export function custodianIncomingDamage(rt: CustodianRuntime, s: EnemyState, amount: number): number {
  const capped = capCustodianHit(amount, s.maxHp);
  return Math.max(1, Math.round(capped * rt.vulnerability * (1 - rt.shieldDr)));
}

/**
 * Phase 1 -> 2 on health alone. Phase 2 -> 3 also needs the phase-2 add wave dead (Mithrix's
 * rule): if adds are still up at a third health the boss holds and becomes immune, so the crew
 * has to clear the room. A forced breather they earn.
 */
export function custodianPhase(rt: CustodianRuntime, s: EnemyState, ctx: BossContext): 1 | 2 | 3 {
  const current = (s.bossPhase ?? 1) as 1 | 2 | 3;
  const hp = s.hp;
  let next: 1 | 2 | 3 = hp > s.maxHp * 2 / 3 ? 1 : hp > s.maxHp / 3 ? 2 : 3;
  if (next === 3 && rt.waveTag !== null && ctx.aliveWithTag(rt.waveTag)) next = 2;
  if (next < current) next = current;
  return Math.min(rt.maxPhase, next) as 1 | 2 | 3;
}

/** Everything that happens on a transition: the rest beat, the twist, the shield. */
export function onCustodianPhase(rt: CustodianRuntime, s: EnemyState, ctx: BossContext, phase: 1 | 2 | 3): void {
  rt.vulnerability = 1;
  rt.sweep = null;
  rt.haul = null;
  rt.pull = 0;
  rt.pylons = null;
  rt.pending = [];
  rt.field = { patternId: null, tiles: [], live: false, remainingMs: 0, corrupted: rt.field.corrupted };
  rt.chainOwed = 0;
  ctx.emit({ type: 'boss_phase_changed', enemyId: s.id, phase, title: custodianTitle(rt.custodian, phase) });
  if (phase === 2) {
    corruptTerrain(rt, s, ctx);
    summonPhaseWave(rt, s, ctx);
  }
  if (phase === 3) {
    // The shield IS the relays: a room without them (a practice arena, a legacy final room with
    // no ritual) simply gets the phase-3 moveset and no damage reduction.
    rt.shielded = ctx.relays() !== null;
    rt.shieldDr = rt.shielded ? CUSTODIAN_SHIELD_DR[0]! : 0;
    s.shieldDr = rt.shieldDr;
    rt.inertRelay = 0;
    rt.inertMs = RELAY_INERT_ROTATE_MS;
    rt.patternId = rt.custodian.moves[2]!.patternId;
    rt.firstUse = !rt.used.has(rt.patternId);
  }
}

/**
 * The phase-2 twist: the biome joins in. Conduits and rubble the crew has been using all fight
 * turn hostile. A room with neither gets the arena-shrink fallback, which closes one ring of
 * hazard every 20 s to a maximum of three — capped so a room can never become impassable.
 */
function corruptTerrain(rt: CustodianRuntime, s: EnemyState, ctx: BossContext): void {
  if (rt.corruptionDone) return;
  rt.corruptionDone = true;
  const own: string[] = [];
  for (let row = 0; row < ctx.room.height; row++) {
    for (let col = 0; col < ctx.room.width; col++) {
      const tile = terrainTileAt(ctx.room, col, row);
      if (tile === '+' || tile === ':') own.push(tileKey(col, row));
    }
  }
  if (own.length > 0) {
    rt.field.corrupted = own;
    rt.ringStep = 0;
  } else {
    rt.ringStep = 1;
    rt.ringMs = RING_CLOSE_MS;
    rt.field.corrupted = perimeterTiles(ctx.room, 1);
  }
  ctx.emit({ type: 'terrain_corrupted', roomId: ctx.room.id, enemyId: s.id, tilesChanged: rt.field.corrupted.length });
}

/** One add wave at the phase-2 gate, whether or not `summon_choir` was drawn. Phase 3 waits on it. */
function summonPhaseWave(rt: CustodianRuntime, s: EnemyState, ctx: BossContext): void {
  const pool = ctx.enemyPool().filter((id) => id !== 'guardian');
  if (pool.length === 0) return;
  const tag = `wave-${s.id}`;
  const rng = rngFor(s.id, 'wave');
  let spawned = 0;
  for (let i = 0; i < 3; i++) if (ctx.spawnAdd(rng.pick(pool), s, tag)) spawned++;
  rt.waveTag = spawned > 0 ? tag : null;
}

/** What the snapshot carries about the boss's floor: arena marks plus permanent corruption. */
export function bossFieldSnapshot(rt: CustodianRuntime): BossField | null {
  if (rt.field.tiles.length === 0 && rt.field.corrupted.length === 0) return null;
  return {
    patternId: rt.field.patternId,
    tiles: [...rt.field.tiles],
    live: rt.field.live,
    remainingMs: rt.field.remainingMs,
    corrupted: [...rt.field.corrupted],
  };
}

export { gatekeeperTier };
