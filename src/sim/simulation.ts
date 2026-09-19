/**
 * RELAY simulation — pure TypeScript, deterministic, engine-agnostic.
 *
 * NO Phaser, React, DOM, HTTP or timers in this folder. The same code runs inside
 * LocalSession (single-player) and inside the host's server process (LAN multiplayer).
 *
 * Implemented today (honest list):
 *  - players join/leave, spawn at 'P', per-axis sliding collision vs walls/props
 *  - movement, facing from aim, dash (burst + cooldown + invulnerability window)
 *  - attack STATE + `player_attacked` event — hit resolution/damage NOT yet (Agent A slice)
 *  - enemies spawn from RoomSpec.encounters and stand still (no AI yet)
 *  - exit detection -> `exit_reached`; anchor site exposed as dormant (planting planned)
 *  - headquarters is a room too; its exit tile is the portal
 */
import type {
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
  AnchorState,
} from '../shared/contracts';
import {
  ATTACK_COOLDOWN_MS,
  ATTACK_DURATION_MS,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_INVULNERABLE_MS,
  DASH_SPEED,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_MS,
  TILE_SIZE,
  tileToWorld,
  worldToTile,
} from '../shared/conventions';
import { ENEMY_INFO } from '../shared/registry';
import { buildSolidGrid, circleHitsSolid, moveCircle, type SolidGrid } from './collision';
import { headquartersRoom } from './headquarters';

interface PlayerRuntime {
  identity: PlayerIdentity;
  state: PlayerState;
  intent: PlayerIntent | null;
  dashRemainingMs: number;
  dashDirX: number;
  dashDirY: number;
  attackRemainingMs: number;
  onExit: boolean;
}

export interface Simulation {
  addPlayer(identity: PlayerIdentity): void;
  removePlayer(playerId: string): void;
  hasPlayer(playerId: string): boolean;
  updatePlayerIdentity(identity: PlayerIdentity): void;
  getPlayerIds(): string[];

  setWorld(world: PreparedWorld | null): void;
  getWorld(): PreparedWorld | null;
  getRoom(): RoomSpec;
  getPhase(): GamePhase;

  /** Load a committed expedition room and spawn everyone at its 'P'. Emits room_entered. */
  enterRoom(roomIndex: number): GameEvent[];
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

export function createSimulation(options: SimulationOptions = {}): Simulation {
  const hq = options.headquarters ?? headquartersRoom;

  let world: PreparedWorld | null = null;
  let room: RoomSpec = hq;
  let grid: SolidGrid = buildSolidGrid(room);
  let phase: GamePhase = 'headquarters';
  let tick = 0;
  let eventCounter = 0;

  const players = new Map<string, PlayerRuntime>();
  let enemies: EnemyState[] = [];
  let anchor: AnchorState | null = null;

  // ---- events ---------------------------------------------------------------

  function emit<T extends GameEventType>(type: T, data: Omit<GameEventOf<T>, 'id' | 'tick' | 'timeMs' | 'type'>): GameEvent {
    const event: unknown = {
      id: `${tick}:${eventCounter++}`,
      tick,
      timeMs: tick * TICK_MS,
      type,
      ...data,
    };
    return event as GameEvent;
  }

  // ---- room loading ---------------------------------------------------------

  function findTile(ch: string): { col: number; row: number } | null {
    for (let row = 0; row < room.height; row++) {
      const col = room.tiles[row]?.indexOf(ch) ?? -1;
      if (col >= 0) return { col, row };
    }
    return null;
  }

  function placePlayersAtSpawn(): void {
    const spawn = findTile('P') ?? { col: 1, row: 1 };
    const base = tileToWorld(spawn.col, spawn.row);
    let i = 0;
    for (const p of players.values()) {
      // Ring offsets so co-op players do not overlap; fall back to the spawn centre.
      const angle = (i / Math.max(1, players.size)) * Math.PI * 2;
      const r = i === 0 ? 0 : TILE_SIZE * 0.7;
      let x = base.x + Math.cos(angle) * r;
      let y = base.y + Math.sin(angle) * r;
      if (circleHitsSolid(grid, x, y, PLAYER_RADIUS)) {
        x = base.x;
        y = base.y;
      }
      p.state.x = x;
      p.state.y = y;
      p.state.vx = 0;
      p.state.vy = 0;
      p.state.state = 'idle';
      p.dashRemainingMs = 0;
      p.attackRemainingMs = 0;
      p.onExit = true; // avoid re-triggering an exit if spawn overlaps one
      i++;
    }
  }

  function spawnEnemies(): void {
    enemies = [];
    for (const enc of room.encounters) {
      const info = ENEMY_INFO[enc.enemyId];
      for (let i = 0; i < enc.count; i++) {
        const base = tileToWorld(enc.x, enc.y);
        const offset = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (info.radius * 2 + 6);
        let x = base.x + offset;
        const y = base.y;
        if (circleHitsSolid(grid, x, y, info.radius)) x = base.x;
        enemies.push({
          id: `${enc.id}-${i}`,
          enemyId: enc.enemyId,
          x,
          y,
          facing: Math.PI,
          hp: info.maxHp,
          maxHp: info.maxHp,
          state: 'idle',
        });
      }
    }
  }

  function loadRoom(next: RoomSpec, nextPhase: GamePhase): void {
    room = next;
    grid = buildSolidGrid(room);
    phase = nextPhase;
    placePlayersAtSpawn();
    spawnEnemies();
    const anchorTile = room.isFinal ? findTile('A') : null;
    anchor = anchorTile ? { ...tileToWorld(anchorTile.col, anchorTile.row), state: 'dormant', progress: 0 } : null;
  }

  // ---- players --------------------------------------------------------------

  function makePlayerState(identity: PlayerIdentity): PlayerState {
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
    };
  }

  function stepPlayer(p: PlayerRuntime, events: GameEvent[]): void {
    const s = p.state;
    const dt = TICK_MS / 1000;
    s.dashCooldownMs = Math.max(0, s.dashCooldownMs - TICK_MS);
    s.attackCooldownMs = Math.max(0, s.attackCooldownMs - TICK_MS);
    s.invulnerableMs = Math.max(0, s.invulnerableMs - TICK_MS);

    const intent = p.intent;
    p.intent = null; // buttons are single-tick; movement is re-sent every frame anyway
    const moveX = intent?.moveX ?? 0;
    const moveY = intent?.moveY ?? 0;
    const moveLen = Math.hypot(moveX, moveY);

    if (intent) {
      const dx = intent.aimX - s.x;
      const dy = intent.aimY - s.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.001) s.facing = Math.atan2(dy, dx);
    }

    if (s.state !== 'down') {
      if (intent?.dash && s.dashCooldownMs <= 0 && p.dashRemainingMs <= 0) {
        if (moveLen > 0) {
          p.dashDirX = moveX / moveLen;
          p.dashDirY = moveY / moveLen;
        } else {
          p.dashDirX = Math.cos(s.facing);
          p.dashDirY = Math.sin(s.facing);
        }
        p.dashRemainingMs = DASH_DURATION_MS;
        p.attackRemainingMs = 0;
        s.dashCooldownMs = DASH_COOLDOWN_MS;
        s.invulnerableMs = DASH_INVULNERABLE_MS;
        events.push(emit('player_dashed', { playerId: s.id, x: s.x, y: s.y, facing: s.facing }));
      } else if (intent?.attack && s.attackCooldownMs <= 0 && p.attackRemainingMs <= 0 && p.dashRemainingMs <= 0) {
        p.attackRemainingMs = ATTACK_DURATION_MS;
        s.attackCooldownMs = ATTACK_COOLDOWN_MS;
        // Hit resolution/damage is Agent A's first slice; the event exists so C can build the effect now.
        events.push(emit('player_attacked', { playerId: s.id, x: s.x, y: s.y, facing: s.facing, hitEnemyIds: [] }));
      }
    }

    if (p.dashRemainingMs > 0) {
      s.vx = p.dashDirX * DASH_SPEED;
      s.vy = p.dashDirY * DASH_SPEED;
      p.dashRemainingMs -= TICK_MS;
    } else if (moveLen > 0 && s.state !== 'down') {
      const speed = PLAYER_SPEED * (p.attackRemainingMs > 0 ? 0.35 : 1);
      s.vx = (moveX / moveLen) * speed;
      s.vy = (moveY / moveLen) * speed;
    } else {
      s.vx = 0;
      s.vy = 0;
    }
    if (p.attackRemainingMs > 0) p.attackRemainingMs -= TICK_MS;

    if (s.vx !== 0 || s.vy !== 0) {
      const moved = moveCircle(grid, s.x, s.y, PLAYER_RADIUS, s.vx * dt, s.vy * dt);
      s.x = moved.x;
      s.y = moved.y;
      if (moved.blockedX) s.vx = 0;
      if (moved.blockedY) s.vy = 0;
    }

    if (s.state !== 'down') {
      s.state =
        p.dashRemainingMs > 0 ? 'dashing' : p.attackRemainingMs > 0 ? 'attacking' : s.vx !== 0 || s.vy !== 0 ? 'moving' : 'idle';
    }

    // Exit detection (edge-triggered per visit).
    const { col, row } = worldToTile(s.x, s.y);
    const onExitTile = room.tiles[row]?.[col] === 'X';
    if (onExitTile && !p.onExit) {
      const exit = room.exits.find((e) => e.x === col && e.y === row);
      if (exit) {
        events.push(emit('exit_reached', { playerId: s.id, roomIndex: room.index, toRoomIndex: exit.toRoomIndex }));
      }
    }
    p.onExit = onExitTile;
  }

  // ---- public API -----------------------------------------------------------

  const sim: Simulation = {
    addPlayer(identity) {
      if (players.has(identity.id)) return;
      const runtime: PlayerRuntime = {
        identity,
        state: makePlayerState(identity),
        intent: null,
        dashRemainingMs: 0,
        dashDirX: 1,
        dashDirY: 0,
        attackRemainingMs: 0,
        onExit: false,
      };
      players.set(identity.id, runtime);
      const spawn = findTile('P') ?? { col: 1, row: 1 };
      const base = tileToWorld(spawn.col, spawn.row);
      runtime.state.x = base.x + (players.size - 1) * TILE_SIZE * 0.7;
      runtime.state.y = base.y;
      if (circleHitsSolid(grid, runtime.state.x, runtime.state.y, PLAYER_RADIUS)) {
        runtime.state.x = base.x;
      }
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
      p.identity = identity;
      p.state.displayName = identity.displayName;
      p.state.classId = identity.classId;
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

    enterRoom(roomIndex) {
      if (!world) throw new Error('enterRoom: no world prepared');
      const next = world.rooms[roomIndex];
      if (!next) throw new Error(`enterRoom: room ${roomIndex} is not committed yet`);
      loadRoom(next, 'expedition');
      return [
        emit('room_entered', {
          worldId: world.worldId,
          roomIndex: next.index,
          roomId: next.id,
          roomName: next.name,
          playerIds: sim.getPlayerIds(),
        }),
      ];
    },
    returnToHeadquarters() {
      loadRoom(hq, 'headquarters');
      return [];
    },

    applyIntent(intent) {
      const p = players.get(intent.playerId);
      if (!p) return;
      const prev = p.intent;
      // Merge so a button pressed between ticks is never lost.
      p.intent = {
        ...intent,
        attack: intent.attack || (prev?.attack ?? false),
        dash: intent.dash || (prev?.dash ?? false),
        ability: intent.ability ?? prev?.ability ?? null,
      };
    },

    step() {
      tick++;
      eventCounter = 0;
      const events: GameEvent[] = [];
      for (const p of players.values()) stepPlayer(p, events);
      return events;
    },

    getSnapshot() {
      return {
        tick,
        timeMs: tick * TICK_MS,
        phase,
        worldId: phase === 'headquarters' ? null : (world?.worldId ?? null),
        roomIndex: phase === 'headquarters' ? null : room.index,
        roomId: room.id,
        players: [...players.values()].map((p) => ({ ...p.state })),
        enemies: enemies.map((e) => ({ ...e })),
        anchor: anchor ? { ...anchor } : null,
      };
    },
    getTick() {
      return tick;
    },
  };

  return sim;
}
