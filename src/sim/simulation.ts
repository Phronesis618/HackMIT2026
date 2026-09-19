/**
 * RELAY simulation — pure TypeScript, deterministic, engine-agnostic.
 *
 * NO Phaser, React, DOM, HTTP or timers in this folder. The same code runs inside
 * LocalSession (single-player) and inside the host process (LAN multiplayer).
 *
 * Implemented:
 *  - players join/leave, spawn at 'P', per-axis sliding collision vs walls/props
 *  - movement, facing from aim, dash (burst + cooldown + i-frames)
 *  - basic attack: windup -> arc hit resolution -> enemy_damaged / enemy_defeated (+ shards)
 *  - enemies: seeded melee brain (idle -> chase -> telegraphed strike -> recover), separation,
 *    hit flinch, stun; player_damaged / player_downed with hit invulnerability
 *  - Bastion Q Bulwark (directional shield blocks frontal strikes) and E Magnetic Tether
 *    (cone pull + stagger; requires unlock)
 *  - room objective: clear all enemies -> room_cleared (+ reward) unlocks exits
 *  - final room: hold interact at the Anchor -> anchor_planted -> run_ended('anchored')
 *  - all players down -> run_ended('collapsed'); down/revive by holding interact (co-op)
 *  - headquarters is a room too; its exit tile is the portal; entering room 0 starts a run
 * Not implemented yet: other classes' abilities, guardian patterns, projectiles.
 */
import type {
  AnchorState,
  EnemyState,
  GameEvent,
  GameEventOf,
  GameEventType,
  GamePhase,
  GameSnapshot,
  PlayerIdentity,
  PlayerIntent,
  PlayerState,
  PreparedWorld,
  RoomSpec,
  RoomStatus,
  RunState,
} from '../shared/contracts';
import {
  ANCHOR_PLANT_MS,
  ANCHOR_PLANT_RANGE,
  ATTACK_ARC_RAD,
  ATTACK_COOLDOWN_MS,
  ATTACK_DAMAGE,
  ATTACK_DURATION_MS,
  ATTACK_RANGE,
  ATTACK_WINDUP_MS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_INVULNERABLE_MS,
  DASH_SPEED,
  ENEMY_CORPSE_MS,
  PLAYER_HIT_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  REVIVE_MS,
  REVIVE_RANGE,
  RUN_END_RETURN_MS,
  SHIELD_ARC_RAD,
  SHIELD_DURATION_MS,
  TETHER_ARC_RAD,
  TETHER_PULL_DISTANCE,
  TETHER_RANGE,
  TETHER_STUN_MS,
  TICK_MS,
  TILE_SIZE,
  tileToWorld,
  worldToTile,
} from '../shared/conventions';
import { hashString } from '../shared/ids';
import { ABILITY_INFO, ENEMY_INFO, type AbilityId, type EnemyInfo } from '../shared/registry';
import { buildSolidGrid, circleHitsSolid, moveCircle, type SolidGrid } from './collision';
import { headquartersRoom } from './headquarters';
import { createRng, type Rng } from './rng';

interface PlayerRuntime {
  identity: PlayerIdentity;
  state: PlayerState;
  intent: PlayerIntent | null;
  dashRemainingMs: number;
  dashDirX: number;
  dashDirY: number;
  attackRemainingMs: number;
  attackHitPending: boolean;
  attackFacing: number;
  onExit: boolean;
  /** Held flag kept separate from the edge-triggered buttons (never OR-ed across ticks). */
  intentInteract: boolean;
}

interface EnemyRuntime {
  state: EnemyState;
  info: EnemyInfo;
  targetId: string | null;
  attackHitPending: boolean;
  currentWindupMs: number;
  stunMs: number;
  corpseMs: number;
}

export interface Simulation {
  addPlayer(identity: PlayerIdentity, unlockedAbilityIds?: AbilityId[]): void;
  removePlayer(playerId: string): void;
  hasPlayer(playerId: string): boolean;
  updatePlayerIdentity(identity: PlayerIdentity): void;
  /** Permanent unlocks come from the profile (client) or host validation (LAN). */
  setPlayerUnlocks(playerId: string, unlockedAbilityIds: AbilityId[]): void;
  getPlayerIds(): string[];

  setWorld(world: PreparedWorld | null): void;
  getWorld(): PreparedWorld | null;
  getRoom(): RoomSpec;
  getPhase(): GamePhase;
  getRun(): RunState;

  /** Load a committed expedition room and spawn everyone at its 'P'. Room 0 from HQ starts a run. */
  enterRoom(roomIndex: number): GameEvent[];
  /** Back to HQ. Ends an active run as 'aborted'. */
  returnToHeadquarters(): GameEvent[];

  /** Latest intent wins; consumed on the next step(). Buttons mean "pressed this tick". */
  applyIntent(intent: PlayerIntent): void;
  /** Advance exactly one fixed tick (TICK_MS). Returns this tick's events in order. */
  step(): GameEvent[];
  getSnapshot(): GameSnapshot;
  getTick(): number;
}

export interface SimulationOptions {
  headquarters?: RoomSpec;
}

const IDLE_RUN: RunState = { runId: null, status: 'idle', roomsCleared: 0, shardsEarned: 0, returnCountdownMs: 0 };

export function createSimulation(options: SimulationOptions = {}): Simulation {
  const hq = options.headquarters ?? headquartersRoom;

  let world: PreparedWorld | null = null;
  let room: RoomSpec = hq;
  let grid: SolidGrid = buildSolidGrid(room);
  let phase: GamePhase = 'headquarters';
  let tick = 0;
  let eventCounter = 0;
  let runCounter = 0;
  let rng: Rng = createRng(1);

  const players = new Map<string, PlayerRuntime>();
  const enemies: EnemyRuntime[] = [];
  let anchor: AnchorState | null = null;
  let roomCleared = false;
  let run: RunState = { ...IDLE_RUN };

  // ---- events ---------------------------------------------------------------

  function emit<T extends GameEventType>(type: T, data: Omit<GameEventOf<T>, 'id' | 'tick' | 'timeMs' | 'type'>): GameEvent {
    const event: unknown = { id: `${tick}:${eventCounter++}`, tick, timeMs: tick * TICK_MS, type, ...data };
    return event as GameEvent;
  }

  // ---- helpers ----------------------------------------------------------------

  function findTile(ch: string): { col: number; row: number } | null {
    for (let row = 0; row < room.height; row++) {
      const col = room.tiles[row]?.indexOf(ch) ?? -1;
      if (col >= 0) return { col, row };
    }
    return null;
  }

  const alivePlayers = (): PlayerRuntime[] => [...players.values()].filter((p) => p.state.state !== 'down');
  const aliveEnemies = (): EnemyRuntime[] => enemies.filter((e) => e.state.state !== 'dead');
  const normalizeAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

  function exitsLocked(): boolean {
    return phase === 'expedition' && room.encounters.length > 0 && !roomCleared;
  }

  function objectiveText(): string {
    if (phase === 'headquarters') return world ? 'Step onto the portal to enter the world.' : 'Prepare a world, then step onto the portal.';
    const remaining = aliveEnemies().length;
    if (run.status === 'anchored') return 'Anchor planted. The world holds. Returning to headquarters…';
    if (run.status === 'collapsed') return 'All operatives down. Returning to headquarters…';
    if (!roomCleared && remaining > 0) return `Clear ${remaining} hostile${remaining === 1 ? '' : 's'} to unlock the exit.`;
    if (room.isFinal) return anchor?.state === 'planting' ? 'Planting the Anchor — hold F…' : 'Room clear. Hold F at the Anchor site.';
    const dir = room.exits[0]?.direction;
    return `Room clear. Exit unlocked${dir ? ` — head ${dir}` : ''}.`;
  }

  // ---- room loading ---------------------------------------------------------

  function placePlayersAtSpawn(): void {
    const spawn = findTile('P') ?? { col: 1, row: 1 };
    const base = tileToWorld(spawn.col, spawn.row);
    let i = 0;
    for (const p of players.values()) {
      const angle = (i / Math.max(1, players.size)) * Math.PI * 2;
      const r = i === 0 ? 0 : TILE_SIZE * 0.7;
      let x = base.x + Math.cos(angle) * r;
      let y = base.y + Math.sin(angle) * r;
      if (circleHitsSolid(grid, x, y, PLAYER_RADIUS)) {
        x = base.x;
        y = base.y;
      }
      Object.assign(p.state, { x, y, vx: 0, vy: 0, state: p.state.state === 'down' ? 'down' : 'idle', interactProgress: 0 });
      p.dashRemainingMs = 0;
      p.attackRemainingMs = 0;
      p.attackHitPending = false;
      p.onExit = true; // do not re-trigger an exit if the spawn overlaps one
      i++;
    }
  }

  /** Nearest position to (x, y) where a circle of radius r fits, searching outward in tile steps. */
  function freeSpotNear(x: number, y: number, r: number): { x: number; y: number } {
    if (!circleHitsSolid(grid, x, y, r)) return { x, y };
    for (let ring = 1; ring <= 3; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const cx = x + dx * TILE_SIZE;
          const cy = y + dy * TILE_SIZE;
          if (!circleHitsSolid(grid, cx, cy, r)) return { x: cx, y: cy };
        }
      }
    }
    return { x, y };
  }

  function spawnEnemies(): void {
    enemies.length = 0;
    for (const enc of room.encounters) {
      const info = ENEMY_INFO[enc.enemyId];
      for (let i = 0; i < enc.count; i++) {
        const base = tileToWorld(enc.x, enc.y);
        const offset = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (info.radius * 2 + 6);
        const spot = freeSpotNear(base.x + offset, base.y, info.radius);
        const x = spot.x;
        const y = spot.y;
        enemies.push({
          state: { id: `${enc.id}-${i}`, enemyId: enc.enemyId, x, y, facing: Math.PI, hp: info.maxHp, maxHp: info.maxHp, state: 'idle', stateMs: 0, windupMs: 0 },
          info,
          targetId: null,
          attackHitPending: false,
          currentWindupMs: info.windupMs,
          stunMs: 0,
          corpseMs: 0,
        });
      }
    }
  }

  function loadRoom(next: RoomSpec, nextPhase: GamePhase): void {
    room = next;
    grid = buildSolidGrid(room);
    phase = nextPhase;
    rng = createRng(hashString(`${world?.worldId ?? 'hq'}:${room.id}:${run.runId ?? ''}`));
    placePlayersAtSpawn();
    spawnEnemies();
    // Rooms without encounters count as cleared on entry (no reward, exits open).
    roomCleared = room.encounters.length === 0;
    if (roomCleared && nextPhase === 'expedition' && run.status === 'active') run.roomsCleared += 1;
    const anchorTile = room.isFinal ? findTile('A') : null;
    anchor = anchorTile ? { ...tileToWorld(anchorTile.col, anchorTile.row), state: 'dormant', progress: 0 } : null;
  }

  // ---- players --------------------------------------------------------------

  function defaultUnlocks(identity: PlayerIdentity): AbilityId[] {
    const q = (Object.values(ABILITY_INFO).find((a) => a.slot === 'q' && a.classId === identity.classId) ?? null)?.id;
    return q ? ['attack', 'dash', q] : ['attack', 'dash'];
  }

  function makePlayerState(identity: PlayerIdentity, unlocks: AbilityId[]): PlayerState {
    return {
      id: identity.id,
      displayName: identity.displayName,
      classId: identity.classId,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      state: 'idle',
      dashCooldownMs: 0,
      attackCooldownMs: 0,
      invulnerableMs: 0,
      qCooldownMs: 0,
      eCooldownMs: 0,
      unlockedAbilityIds: unlocks,
      shieldMs: 0,
      shieldFacing: 0,
      shards: 0,
      interactProgress: 0,
      reviveProgress: 0,
    };
  }

  function abilityFor(p: PlayerRuntime, slot: 'q' | 'e'): AbilityId | null {
    const info = Object.values(ABILITY_INFO).find((a) => a.slot === slot && a.classId === p.state.classId);
    if (!info) return null;
    return p.state.unlockedAbilityIds.includes(info.id) ? info.id : null;
  }

  function useAbility(p: PlayerRuntime, slot: 'q' | 'e', events: GameEvent[]): void {
    const s = p.state;
    const abilityId = abilityFor(p, slot);
    if (!abilityId) return;
    if (slot === 'q' && s.qCooldownMs > 0) return;
    if (slot === 'e' && s.eCooldownMs > 0) return;
    const targets: string[] = [];

    switch (abilityId) {
      case 'bastion.q.bulwark':
        s.shieldMs = SHIELD_DURATION_MS;
        s.shieldFacing = s.facing;
        break;
      case 'bastion.e.shockwave': {
        const landX = s.x + Math.cos(s.facing) * TETHER_PULL_DISTANCE;
        const landY = s.y + Math.sin(s.facing) * TETHER_PULL_DISTANCE;
        let k = 0;
        for (const e of aliveEnemies()) {
          const d = dist(s.x, s.y, e.state.x, e.state.y);
          if (d > TETHER_RANGE + e.info.radius) continue;
          const diff = normalizeAngle(Math.atan2(e.state.y - s.y, e.state.x - s.x) - s.facing);
          if (Math.abs(diff) > TETHER_ARC_RAD / 2) continue;
          const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * (e.info.radius * 2 + 4);
          const px = landX + Math.cos(s.facing + Math.PI / 2) * side;
          const py = landY + Math.sin(s.facing + Math.PI / 2) * side;
          if (!circleHitsSolid(grid, px, py, e.info.radius)) {
            e.state.x = px;
            e.state.y = py;
          }
          e.state.state = 'stunned';
          e.state.stateMs = 0;
          e.state.windupMs = 0;
          e.stunMs = TETHER_STUN_MS;
          e.attackHitPending = false;
          targets.push(e.state.id);
          k++;
        }
        break;
      }
      default:
        return; // other classes: planned
    }

    if (slot === 'q') s.qCooldownMs = ABILITY_INFO[abilityId].cooldownMs;
    else s.eCooldownMs = ABILITY_INFO[abilityId].cooldownMs;
    events.push(emit('ability_used', { playerId: s.id, abilityId, x: s.x, y: s.y, facing: s.facing, targetEnemyIds: targets }));
  }

  function resolvePlayerAttack(p: PlayerRuntime, events: GameEvent[]): void {
    const s = p.state;
    for (const e of aliveEnemies()) {
      const d = dist(s.x, s.y, e.state.x, e.state.y);
      if (d > ATTACK_RANGE + e.info.radius) continue;
      const diff = normalizeAngle(Math.atan2(e.state.y - s.y, e.state.x - s.x) - p.attackFacing);
      if (Math.abs(diff) > ATTACK_ARC_RAD / 2) continue;
      e.state.hp = Math.max(0, e.state.hp - ATTACK_DAMAGE);
      events.push(emit('enemy_damaged', { enemyId: e.state.id, byPlayerId: s.id, amount: ATTACK_DAMAGE, remainingHp: e.state.hp }));
      if (e.state.hp <= 0) {
        e.state.state = 'dead';
        e.state.stateMs = 0;
        e.state.windupMs = 0;
        e.corpseMs = ENEMY_CORPSE_MS;
        e.attackHitPending = false;
        s.shards += e.info.shards;
        run.shardsEarned += e.info.shards;
        events.push(emit('enemy_defeated', { enemyId: e.state.id, byPlayerId: s.id }));
      } else if (e.state.state === 'idle' || e.state.state === 'chasing') {
        e.state.state = 'hit';
        e.state.stateMs = 0;
        e.targetId = s.id;
      }
    }
  }

  function stepPlayer(p: PlayerRuntime, events: GameEvent[]): void {
    const s = p.state;
    const dt = TICK_MS / 1000;
    s.dashCooldownMs = Math.max(0, s.dashCooldownMs - TICK_MS);
    s.attackCooldownMs = Math.max(0, s.attackCooldownMs - TICK_MS);
    s.invulnerableMs = Math.max(0, s.invulnerableMs - TICK_MS);
    s.qCooldownMs = Math.max(0, s.qCooldownMs - TICK_MS);
    s.eCooldownMs = Math.max(0, s.eCooldownMs - TICK_MS);
    s.shieldMs = Math.max(0, s.shieldMs - TICK_MS);

    const intent = p.intent;
    p.intent = null;
    const down = s.state === 'down';
    const moveX = down ? 0 : (intent?.moveX ?? 0);
    const moveY = down ? 0 : (intent?.moveY ?? 0);
    const moveLen = Math.hypot(moveX, moveY);

    if (intent && !down) {
      const dx = intent.aimX - s.x;
      const dy = intent.aimY - s.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.001) s.facing = Math.atan2(dy, dx);
    }

    const runEnded = run.status !== 'active' && phase === 'expedition';
    if (!down && !runEnded && intent) {
      if (intent.dash && s.dashCooldownMs <= 0 && p.dashRemainingMs <= 0) {
        if (moveLen > 0) {
          p.dashDirX = moveX / moveLen;
          p.dashDirY = moveY / moveLen;
        } else {
          p.dashDirX = Math.cos(s.facing);
          p.dashDirY = Math.sin(s.facing);
        }
        p.dashRemainingMs = DASH_DURATION_MS;
        p.attackRemainingMs = 0;
        p.attackHitPending = false;
        s.dashCooldownMs = DASH_COOLDOWN_MS;
        s.invulnerableMs = Math.max(s.invulnerableMs, DASH_INVULNERABLE_MS);
        events.push(emit('player_dashed', { playerId: s.id, x: s.x, y: s.y, facing: s.facing }));
      } else if (intent.attack && s.attackCooldownMs <= 0 && p.attackRemainingMs <= 0 && p.dashRemainingMs <= 0) {
        p.attackRemainingMs = ATTACK_DURATION_MS;
        p.attackHitPending = true;
        p.attackFacing = s.facing;
        s.attackCooldownMs = ATTACK_COOLDOWN_MS;
        events.push(emit('player_attacked', { playerId: s.id, x: s.x, y: s.y, facing: s.facing, hitEnemyIds: [] }));
      }
      if (intent.ability && p.dashRemainingMs <= 0) useAbility(p, intent.ability, events);
    }

    // Attack hit window (after the windup, once).
    if (p.attackRemainingMs > 0) {
      const elapsed = ATTACK_DURATION_MS - p.attackRemainingMs;
      if (p.attackHitPending && elapsed >= ATTACK_WINDUP_MS) {
        p.attackHitPending = false;
        resolvePlayerAttack(p, events);
      }
      p.attackRemainingMs -= TICK_MS;
    }

    if (p.dashRemainingMs > 0) {
      s.vx = p.dashDirX * DASH_SPEED;
      s.vy = p.dashDirY * DASH_SPEED;
      p.dashRemainingMs -= TICK_MS;
    } else if (moveLen > 0) {
      const speed = PLAYER_SPEED * (p.attackRemainingMs > 0 ? 0.35 : 1);
      s.vx = (moveX / moveLen) * speed;
      s.vy = (moveY / moveLen) * speed;
    } else {
      s.vx = 0;
      s.vy = 0;
    }

    if (s.vx !== 0 || s.vy !== 0) {
      const moved = moveCircle(grid, s.x, s.y, PLAYER_RADIUS, s.vx * dt, s.vy * dt);
      s.x = moved.x;
      s.y = moved.y;
      if (moved.blockedX) s.vx = 0;
      if (moved.blockedY) s.vy = 0;
    }

    if (!down) {
      s.state =
        p.dashRemainingMs > 0 ? 'dashing' : p.attackRemainingMs > 0 ? 'attacking' : s.vx !== 0 || s.vy !== 0 ? 'moving' : 'idle';
    }

    // Exit detection (edge-triggered per visit; locked exits do nothing).
    const { col, row } = worldToTile(s.x, s.y);
    const onExitTile = room.tiles[row]?.[col] === 'X';
    if (onExitTile && !p.onExit && !down && !exitsLocked() && !runEnded) {
      const exit = room.exits.find((e) => e.x === col && e.y === row);
      if (exit) events.push(emit('exit_reached', { playerId: s.id, roomIndex: room.index, toRoomIndex: exit.toRoomIndex }));
    }
    p.onExit = onExitTile;

    // Interact: revive a downed ally (co-op) or plant the Anchor (handled in stepObjectives).
    s.interactProgress = 0;
    if (intent?.interact && !down && !runEnded) {
      for (const other of players.values()) {
        if (other === p || other.state.state !== 'down') continue;
        if (dist(s.x, s.y, other.state.x, other.state.y) > REVIVE_RANGE + PLAYER_RADIUS) continue;
        other.state.reviveProgress = Math.min(1, other.state.reviveProgress + TICK_MS / REVIVE_MS);
        s.interactProgress = other.state.reviveProgress;
        if (other.state.reviveProgress >= 1) {
          other.state.state = 'idle';
          other.state.hp = Math.round(other.state.maxHp * 0.5);
          other.state.reviveProgress = 0;
          other.state.invulnerableMs = PLAYER_HIT_INVULNERABLE_MS * 2;
          events.push(emit('player_revived', { playerId: other.state.id, byPlayerId: s.id }));
        }
        break;
      }
    }
  }

  // ---- enemies ----------------------------------------------------------------

  function damagePlayer(target: PlayerRuntime, enemy: EnemyRuntime, events: GameEvent[]): void {
    const t = target.state;
    if (t.state === 'down' || t.invulnerableMs > 0) return;
    if (t.shieldMs > 0) {
      const fromEnemy = Math.atan2(enemy.state.y - t.y, enemy.state.x - t.x);
      if (Math.abs(normalizeAngle(fromEnemy - t.shieldFacing)) <= SHIELD_ARC_RAD / 2) {
        events.push(emit('attack_blocked', { playerId: t.id, enemyId: enemy.state.id }));
        return;
      }
    }
    t.hp = Math.max(0, t.hp - enemy.info.damage);
    t.invulnerableMs = PLAYER_HIT_INVULNERABLE_MS;
    events.push(emit('player_damaged', { playerId: t.id, amount: enemy.info.damage, remainingHp: t.hp, sourceEnemyId: enemy.state.id }));
    if (t.hp <= 0) {
      t.state = 'down';
      t.vx = 0;
      t.vy = 0;
      t.shieldMs = 0;
      t.reviveProgress = 0;
      target.attackHitPending = false;
      target.attackRemainingMs = 0;
      target.dashRemainingMs = 0;
      events.push(emit('player_downed', { playerId: t.id }));
    }
  }

  function stepEnemy(e: EnemyRuntime, events: GameEvent[]): void {
    const s = e.state;
    const dt = TICK_MS / 1000;
    s.stateMs += TICK_MS;
    if (s.state === 'dead') {
      e.corpseMs -= TICK_MS;
      return;
    }
    if (run.status !== 'active') return; // frozen once the run has ended

    // Target: nearest living player.
    let target: PlayerRuntime | null = null;
    let best = Infinity;
    for (const p of alivePlayers()) {
      const d = dist(s.x, s.y, p.state.x, p.state.y);
      if (d < best) {
        best = d;
        target = p;
      }
    }
    e.targetId = target?.state.id ?? null;
    if (!target) {
      s.state = 'idle';
      return;
    }
    const reach = e.info.radius + PLAYER_RADIUS + e.info.attackRange;

    switch (s.state) {
      case 'stunned':
        if (s.stateMs >= e.stunMs) {
          s.state = 'chasing';
          s.stateMs = 0;
        }
        return;
      case 'hit':
        if (s.stateMs >= 140) {
          s.state = 'chasing';
          s.stateMs = 0;
        }
        return;
      case 'idle':
        if (best <= e.info.aggroRange) {
          s.state = 'chasing';
          s.stateMs = 0;
        }
        return;
      case 'chasing': {
        s.facing = Math.atan2(target.state.y - s.y, target.state.x - s.x);
        if (best <= reach) {
          s.state = 'attacking';
          s.stateMs = 0;
          e.currentWindupMs = Math.round(e.info.windupMs * rng.range(0.85, 1.15));
          s.windupMs = e.currentWindupMs;
          e.attackHitPending = true;
          return;
        }
        const dx = Math.cos(s.facing) * e.info.speed * dt;
        const dy = Math.sin(s.facing) * e.info.speed * dt;
        const moved = moveCircle(grid, s.x, s.y, e.info.radius, dx, dy);
        s.x = moved.x;
        s.y = moved.y;
        return;
      }
      case 'attacking':
        if (e.attackHitPending && s.stateMs >= e.currentWindupMs) {
          e.attackHitPending = false;
          if (dist(s.x, s.y, target.state.x, target.state.y) <= reach + 10) damagePlayer(target, e, events);
          s.state = 'recovering';
          s.stateMs = 0;
          s.windupMs = 0;
        }
        return;
      case 'recovering':
        if (s.stateMs >= e.info.recoverMs) {
          s.state = 'chasing';
          s.stateMs = 0;
        }
        return;
      default:
        return;
    }
  }

  function separateEnemies(): void {
    const list = aliveEnemies();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!.state;
        const b = list[j]!.state;
        const minDist = list[i]!.info.radius + list[j]!.info.radius;
        const d = dist(a.x, a.y, b.x, b.y);
        if (d >= minDist || d === 0) continue;
        const push = (minDist - d) / 2;
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        if (!circleHitsSolid(grid, a.x - nx * push, a.y - ny * push, list[i]!.info.radius)) {
          a.x -= nx * push;
          a.y -= ny * push;
        }
        if (!circleHitsSolid(grid, b.x + nx * push, b.y + ny * push, list[j]!.info.radius)) {
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
    // Remove finished corpses.
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]!;
      if (e.state.state === 'dead' && e.corpseMs <= 0) enemies.splice(i, 1);
    }
  }

  // ---- objectives -------------------------------------------------------------

  function endRun(outcome: 'anchored' | 'collapsed' | 'aborted', events: GameEvent[]): void {
    if (run.status !== 'active' || !world) return;
    run = { ...run, status: outcome, returnCountdownMs: outcome === 'aborted' ? 0 : RUN_END_RETURN_MS };
    events.push(
      emit('run_ended', {
        worldId: world.worldId,
        outcome,
        playerIds: sim.getPlayerIds(),
        shardsEarned: run.shardsEarned,
        roomsCleared: run.roomsCleared,
      }),
    );
  }

  function stepObjectives(events: GameEvent[]): void {
    if (phase !== 'expedition' || !world) return;

    if (run.status !== 'active') {
      run.returnCountdownMs = Math.max(0, run.returnCountdownMs - TICK_MS);
      return;
    }

    if (!roomCleared && aliveEnemies().length === 0) {
      roomCleared = true;
      run.roomsCleared += 1;
      const reward = 10 + room.index * 10;
      for (const p of alivePlayers()) {
        p.state.shards += reward;
        p.state.hp = Math.min(p.state.maxHp, p.state.hp + 20);
      }
      run.shardsEarned += reward * Math.max(1, alivePlayers().length);
      events.push(emit('room_cleared', { worldId: world.worldId, roomIndex: room.index, roomName: room.name, rewardShards: reward, playerIds: sim.getPlayerIds() }));
    }

    if (anchor && anchor.state !== 'planted' && roomCleared) {
      let planting = false;
      for (const p of players.values()) {
        const wants = p.state.state !== 'down' && p.intentInteract;
        if (!wants) continue;
        if (dist(p.state.x, p.state.y, anchor.x, anchor.y) > ANCHOR_PLANT_RANGE + PLAYER_RADIUS) continue;
        planting = true;
        anchor.progress = Math.min(1, anchor.progress + TICK_MS / ANCHOR_PLANT_MS);
        p.state.interactProgress = anchor.progress;
      }
      anchor.state = planting ? 'planting' : 'dormant';
      if (!planting) anchor.progress = Math.max(0, anchor.progress - TICK_MS / (ANCHOR_PLANT_MS * 2));
      if (anchor.progress >= 1) {
        anchor.state = 'planted';
        anchor.progress = 1;
        events.push(emit('anchor_planted', { worldId: world.worldId, roomIndex: room.index, playerIds: sim.getPlayerIds() }));
        endRun('anchored', events);
        return;
      }
    }

    if (players.size > 0 && alivePlayers().length === 0) endRun('collapsed', events);
  }

  // ---- public API -----------------------------------------------------------

  const sim: Simulation = {
    addPlayer(identity, unlockedAbilityIds) {
      if (players.has(identity.id)) return;
      const runtime: PlayerRuntime = {
        identity,
        state: makePlayerState(identity, [...new Set([...defaultUnlocks(identity), ...(unlockedAbilityIds ?? [])])]),
        intent: null,
        dashRemainingMs: 0,
        dashDirX: 1,
        dashDirY: 0,
        attackRemainingMs: 0,
        attackHitPending: false,
        attackFacing: 0,
        onExit: false,
        intentInteract: false,
      };
      players.set(identity.id, runtime);
      const spawn = findTile('P') ?? { col: 1, row: 1 };
      const base = tileToWorld(spawn.col, spawn.row);
      runtime.state.x = base.x + (players.size - 1) * TILE_SIZE * 0.7;
      runtime.state.y = base.y;
      if (circleHitsSolid(grid, runtime.state.x, runtime.state.y, PLAYER_RADIUS)) runtime.state.x = base.x;
      runtime.onExit = room.tiles[spawn.row]?.[spawn.col] === 'X';
    },
    removePlayer(playerId) {
      players.delete(playerId);
    },
    hasPlayer(playerId) {
      return players.has(playerId);
    },
    updatePlayerIdentity(identity) {
      const p = players.get(identity.id);
      if (!p) return;
      const classChanged = p.identity.classId !== identity.classId;
      p.identity = identity;
      p.state.displayName = identity.displayName;
      p.state.classId = identity.classId;
      if (classChanged) p.state.unlockedAbilityIds = defaultUnlocks(identity);
    },
    setPlayerUnlocks(playerId, unlockedAbilityIds) {
      const p = players.get(playerId);
      if (!p) return;
      const base = defaultUnlocks(p.identity);
      p.state.unlockedAbilityIds = [...new Set([...base, ...unlockedAbilityIds])];
    },
    getPlayerIds() {
      return [...players.keys()];
    },

    setWorld(next) {
      world = next;
    },
    getWorld() {
      return world;
    },
    getRoom() {
      return room;
    },
    getPhase() {
      return phase;
    },
    getRun() {
      return { ...run };
    },

    enterRoom(roomIndex) {
      if (!world) throw new Error('enterRoom: no world prepared');
      const next = world.rooms[roomIndex];
      if (!next) throw new Error(`enterRoom: room ${roomIndex} is not committed yet`);
      const events: GameEvent[] = [];
      if (phase === 'headquarters' || run.status !== 'active') {
        runCounter += 1;
        run = { runId: `run-${hashString(world.worldId).toString(36)}-${runCounter}`, status: 'active', roomsCleared: 0, shardsEarned: 0, returnCountdownMs: 0 };
        for (const p of players.values()) {
          Object.assign(p.state, { hp: p.state.maxHp, state: 'idle', shards: 0, shieldMs: 0, qCooldownMs: 0, eCooldownMs: 0, reviveProgress: 0, invulnerableMs: 0 });
        }
      }
      loadRoom(next, 'expedition');
      events.push(emit('room_entered', { worldId: world.worldId, roomIndex: next.index, roomId: next.id, roomName: next.name, playerIds: sim.getPlayerIds() }));
      return events;
    },
    returnToHeadquarters() {
      const events: GameEvent[] = [];
      if (run.status === 'active') endRun('aborted', events);
      run = { ...IDLE_RUN };
      for (const p of players.values()) Object.assign(p.state, { hp: p.state.maxHp, state: 'idle', shieldMs: 0, reviveProgress: 0 });
      loadRoom(hq, 'headquarters');
      return events;
    },

    applyIntent(intent) {
      const p = players.get(intent.playerId);
      if (!p) return;
      const prev = p.intent;
      p.intent = {
        ...intent,
        attack: intent.attack || (prev?.attack ?? false),
        dash: intent.dash || (prev?.dash ?? false),
        ability: intent.ability ?? prev?.ability ?? null,
      };
      p.intentInteract = intent.interact;
    },

    step() {
      tick++;
      eventCounter = 0;
      const events: GameEvent[] = [];
      for (const p of players.values()) stepPlayer(p, events);
      for (const e of enemies) stepEnemy(e, events);
      separateEnemies();
      stepObjectives(events);
      return events;
    },

    getSnapshot() {
      const status: RoomStatus | null = {
        cleared: phase === 'headquarters' ? true : roomCleared,
        enemiesRemaining: aliveEnemies().length,
        exitsLocked: exitsLocked(),
        objective: objectiveText(),
      };
      return {
        tick,
        timeMs: tick * TICK_MS,
        phase,
        worldId: phase === 'headquarters' ? null : (world?.worldId ?? null),
        roomIndex: phase === 'headquarters' ? null : room.index,
        roomId: room.id,
        players: [...players.values()].map((p) => ({ ...p.state, unlockedAbilityIds: [...p.state.unlockedAbilityIds] })),
        enemies: enemies.map((e) => ({ ...e.state })),
        anchor: anchor ? { ...anchor } : null,
        roomStatus: status,
        run: { ...run },
      };
    },
    getTick() {
      return tick;
    },
  };

  return sim;
}
