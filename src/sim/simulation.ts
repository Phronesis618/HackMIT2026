import type {
  AnchorState, EnemyState, EnemyTelegraph, GameEvent, GameEventInput, GamePhase,
  GameSnapshot, LoreNode, PlayerIdentity, PlayerIntent, PlayerState, PreparedWorld, ProjectileState, RoomSpec,
} from '../shared/contracts';
import {
  ABILITY_UNLOCK_COST, ANCHOR_HOLD_MS, ANCHOR_RANGE, ATTACK_DURATION_MS,
  DASH_COOLDOWN_MS, DASH_DURATION_MS, DASH_INVULNERABLE_MS, DASH_SPEED,
  LORE_PICKUP_RANGE, LORE_READ_MS, LORE_READ_RANGE,
  PLAYER_MAX_HP, PLAYER_RADIUS, REVIVE_DURATION_MS, REVIVE_HP, REVIVE_RANGE,
  ROOM_CLEAR_REWARD, TICK_MS, TILE_SIZE, tileToWorld, worldToTile,
} from '../shared/conventions';
import { CLASS_ABILITIES, ENEMY_INFO, ULT_CHARGE_MAX, ULT_CHARGE_PER_DAMAGE, ULT_CHARGE_PER_KILL, type ClassId, type EnemyId } from '../shared/registry';
import { buildSolidGrid, circleHitsSolid, moveCircle, type SolidGrid } from './collision';
import {
  CHANNEL_PATTERN, CLASS_COMBAT, ENEMY_COMBAT, ENEMY_PROJECTILE_PATTERN,
  GUARDIAN_RING_DAMAGE, GUARDIAN_RING_PATTERN, GUARDIAN_VOLLEY_DAMAGE, GUARDIAN_VOLLEY_PATTERN,
  LURKER_SPORE_DAMAGE, LURKER_SPORE_PATTERN, chaseWaypoint, clearPath, decay, distance, inArc,
  nearestOpenPosition, type Point, type ProjectilePattern,
} from './combat';
import { headquartersRoom } from './headquarters';
import { terrainSpeedMultiplier, type TerrainState } from '../shared/terrain';
import { createTerrainState, strikeBreakableWalls } from './terrain';
import { ANCHOR_DISCHARGE_MS, ANCHOR_PULSE_SPEED, ANCHOR_PULSE_WARNING_MS, guardianPhase, RELAY_ACTIVATION_RANGE } from '../shared/finale';
import {
  custodianMaxHp, gatekeeperMaxHp, gatekeeperTier, PHASE_CHANGE_RECOVERY_MS, resolveCustodian,
  type ResolvedCustodian,
} from '../shared/custodian';
import {
  beginCustodianPattern, bossFieldSnapshot, createCustodianRuntime, custodianBusy, custodianEngagement,
  custodianIncomingDamage, custodianPhase, onCustodianPhase, resolveCustodianPattern, stepCustodian,
  type BossContext, type CustodianRuntime,
} from './boss';
import { TRAINING_REGEN_PER_TICK, TRAINING_RESPAWN_MS, TRAINING_WAKE_RANGE, trainingRoom } from './training';
import { FLOOR_ENTRANCE_ROOM_ID } from '../shared/floors';
import { createRoomProvider, type RoomProvider } from './floorProvider';
import {
  FLOOR_TUNING, TREASURE_REWARD, advanceBiome, clearReward, connectedTiles, createFloorsRun, doorArrival, floorRunState, focusPoint,
  markCleared, markVisited, sealsDoors, tierMultiplier, type FloorsRun,
} from './floors';

type LivePlayerState = PlayerState & Required<Pick<PlayerState,
  'resources' | 'abilityEUnlocked' | 'abilityQCooldownMs' | 'abilityECooldownMs' |
  'shieldMs' | 'shroudMs' | 'rallyMs' | 'reviveProgress' | 'ultCharge' | 'abilityRCooldownMs'>>;

interface PlayerRuntime {
  state: LivePlayerState;
  intent: PlayerIntent | null;
  unlockedClasses: Set<ClassId>;
  dashRemainingMs: number;
  dashDirection: Point;
  attackRemainingMs: number;
  hitRemainingMs: number;
  onExit: boolean;
  interacting: boolean;
  interactHeld: boolean;
  interactPressed: boolean;
  damagedThisTick: boolean;
  history: Array<Point & { hp: number }>;
}

interface EnemyRuntime {
  state: EnemyState;
  cooldownMs: number;
  hitMs: number;
  attackCount: number;
  /** Where it was placed; training targets respawn here. */
  spawn: Point;
  respawnMs: number;
  /** Channeler's rotating spiral: >0 while mid-channel, firing one bolt per `shotIntervalMs`. */
  channelMsRemaining: number;
  channelAngle: number;
  channelTimerMs: number;
  /** Floors gatekeepers are Custodians held to their first phase. */
  maxBossPhase?: 1 | 2 | 3;
  /** Custodians and gatekeepers: the pattern registry runtime (src/sim/boss.ts). */
  custodian?: CustodianRuntime;
  /** Adds summoned by a boss pattern, so phase 3 can gate on the phase-2 wave. */
  waveTag?: string;
  /** Mirror-shade decoys: they telegraph, they deal nothing, they hold one point. */
  decoy?: boolean;
}

/** Floors: the crew arrives through a door, on its `entry` tile, facing `inward`. */
interface DoorArrival {
  entry: { x: number; y: number };
  inward: { x: number; y: number };
}

interface ProjectileRuntime {
  id: string;
  ownerEnemyId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  remainingMs: number;
  homingTurnRate?: number;
}

interface LoreNodeRuntime {
  state: LoreNode;
  holdMs: number;
}

interface RoomProgress {
  enemies: EnemyRuntime[];
  anchor: AnchorState | null;
  cleared: boolean;
  loreNodes: LoreNodeRuntime[];
  pulseHitPlayers: Set<string>;
  terrain: TerrainState;
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
  /** HQ permits room previews; active expeditions must clear the room before using its exits. */
  enterRoom(roomIndex: number): GameEvent[];
  returnToHeadquarters(): GameEvent[];
  /** From HQ only: the practice range (respawning targets, all abilities, no run). */
  enterTraining(): GameEvent[];
  /** Floors co-op: whose `chooseBiome` decides. Null = the first operative (solo). */
  setHostPlayerId(playerId: string | null): void;
  /** Floors: vote while the biome choice is open; the host's vote moves the crew on the next step. */
  chooseBiome(playerId: string, biomeId: string): void;
  unlockAbility(playerId: string): GameEvent[];
  /** Buttons are pressed this tick; interact is held this tick. */
  applyIntent(intent: PlayerIntent): void;
  step(): GameEvent[];
  getSnapshot(): GameSnapshot;
  getTick(): number;
}

export interface SimulationOptions {
  headquarters?: RoomSpec;
  /** Floors worlds: how room addresses become RoomSpecs. Tests inject doubles; default = createRoomProvider. */
  roomProvider?: (world: PreparedWorld) => RoomProvider | null;
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  const hq = options.headquarters ?? headquartersRoom;
  let world: PreparedWorld | null = null;
  let room = hq;
  let grid: SolidGrid = buildSolidGrid(room);
  let phase: GamePhase = 'headquarters';
  let tick = 0;
  let eventCounter = 0;
  const players = new Map<string, PlayerRuntime>();
  /** Per-room persistent state. Legacy rooms key by index, floors rooms by `biomeId:roomId`. */
  const rooms = new Map<number | string, RoomProgress>();
  const roomKey = (spec: RoomSpec): number | string => spec.roomId !== undefined ? spec.id : spec.index;
  let roomProvider: RoomProvider | null = null;
  /** Non-null exactly while a floors expedition (or its debrief) is running. */
  let floorsRun: FloorsRun | null = null;
  let hostPlayerId: string | null = null;
  /** Floors tier scaling of enemy damage; 1 everywhere else. */
  let enemyDamageScale = 1;
  let progress: RoomProgress = { enemies: [], anchor: null, cleared: false, loreNodes: [], pulseHitPlayers: new Set(), terrain: createTerrainState() };
  /** Ephemeral bullet-hell bolts; never persisted across room switches (combat gates exits). */
  let projectiles: ProjectileRuntime[] = [];
  let projectileCounter = 0;
  /** Fragment indices found this run; relics stay readable but remains drop only once per kind. */
  let discoveredLore = new Set<number>();
  /** The world's Custodian identity and its three patterns; resolved once per world. */
  let custodianCache: { worldId: string; resolved: ResolvedCustodian } | null = null;

  function emit(data: GameEventInput): GameEvent {
    return { ...data, id: `${tick}:${eventCounter++}`, tick, timeMs: tick * TICK_MS };
  }

  function orderedPlayers(): PlayerRuntime[] {
    return [...players.values()].sort((a, b) => a.state.id < b.state.id ? -1 : a.state.id > b.state.id ? 1 : 0);
  }

  function playerIds(): string[] {
    return orderedPlayers().map((p) => p.state.id);
  }

  function findTile(ch: string): Point | null {
    for (let row = 0; row < room.height; row++) {
      const col = room.tiles[row]?.indexOf(ch) ?? -1;
      if (col >= 0) return tileToWorld(col, row);
    }
    return null;
  }

  function resetTransient(p: PlayerRuntime): void {
    Object.assign(p.state, {
      vx: 0, vy: 0, state: p.state.hp > 0 ? 'idle' : 'down',
      dashCooldownMs: 0, attackCooldownMs: 0, invulnerableMs: 0,
      abilityQCooldownMs: 0, abilityECooldownMs: 0, abilityRCooldownMs: 0,
      shieldMs: 0, shroudMs: 0, rallyMs: 0, reviveProgress: 0,
    });
    p.intent = null;
    p.dashRemainingMs = 0;
    p.attackRemainingMs = 0;
    p.hitRemainingMs = 0;
    p.interacting = false;
    p.interactHeld = false;
    p.interactPressed = false;
    p.damagedThisTick = false;
    p.history = [];
    p.onExit = false;
  }

  function doorsLocked(): boolean {
    return floorsRun !== null && phase === 'expedition' && sealsDoors(room) && !progress.cleared;
  }

  function rebuildGrid(): void {
    grid = buildSolidGrid(room, progress.terrain.brokenWalls, doorsLocked());
  }

  function placePlayers(arrival?: DoorArrival): void {
    if (arrival) {
      // Doors count as solid for placement so nobody lands on one and bounces straight back.
      const placement = buildSolidGrid(room, progress.terrain.brokenWalls, true);
      const base = tileToWorld(arrival.entry.x, arrival.entry.y);
      const { inward } = arrival;
      const slots: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [1, -1]];
      orderedPlayers().forEach((p, i) => {
        const [forward, side] = slots[i] ?? [2, 0];
        Object.assign(p.state, nearestOpenPosition(placement, {
          x: base.x + (inward.x * forward - inward.y * side) * TILE_SIZE * 0.9,
          y: base.y + (inward.y * forward + inward.x * side) * TILE_SIZE * 0.9,
        }, PLAYER_RADIUS));
        resetTransient(p);
      });
      return;
    }
    const spawn = findTile('P') ?? tileToWorld(1, 1);
    orderedPlayers().forEach((p, i) => {
      // Fan the crew out right / down / up first: spawns sit against the west wall, so an
      // angle of π would land inside it and collapse everyone onto the same point.
      const angle = [0, 0, Math.PI / 2, -Math.PI / 2, Math.PI][i] ?? (i * Math.PI) / 3;
      const offset = i === 0 ? 0 : TILE_SIZE * 0.9;
      const point = nearestOpenPosition(grid, {
        x: spawn.x + Math.cos(angle) * offset, y: spawn.y + Math.sin(angle) * offset,
      }, PLAYER_RADIUS);
      Object.assign(p.state, point);
      resetTransient(p);
    });
  }

  /**
   * The world's Custodian: the model's, when the recipe carries one, otherwise three patterns
   * derived from the world seed. Resolved once per world so every gatekeeper previews the same
   * fight the crew will meet in the last room.
   */
  function worldCustodian(): ResolvedCustodian {
    if (custodianCache?.worldId === (world?.worldId ?? '')) return custodianCache.resolved;
    const recipe = world?.recipe;
    const pool = [...new Set((recipe?.rooms ?? []).flatMap((blueprint) => blueprint.enemyIds))].filter((id) => id !== 'guardian');
    const resolved = resolveCustodian({
      spec: recipe?.custodian ?? undefined,
      seed: world?.worldId ?? 'relay',
      motifIds: recipe?.motifIds ?? [],
      enemyPool: pool,
    });
    custodianCache = { worldId: world?.worldId ?? '', resolved };
    return resolved;
  }

  /** Non-boss enemy kinds this room's biome may spawn; what `summon_choir` and the wave draw from. */
  function biomeEnemyPool(): EnemyId[] {
    const brief = floorsRun ? floorsRun.provider.brief(floorsRun.biomeId) : null;
    const pool = brief ? brief.enemyPool : (world?.recipe.rooms ?? []).flatMap((blueprint) => blueprint.enemyIds);
    const roomPool = room.encounters.map((encounter) => encounter.enemyId);
    return [...new Set([...pool, ...roomPool])].filter((id) => id !== 'guardian');
  }

  function spawnAdd(enemyId: EnemyId, near: Point, tag: string, hpScale = 1): string | null {
    if (progress.enemies.length > 40) return null;
    const info = ENEMY_INFO[enemyId];
    const spawn = nearestOpenPosition(grid, { x: near.x + (progress.enemies.length % 3 - 1) * info.radius * 3, y: near.y }, info.radius);
    const decoy = hpScale === 0;
    const maxHp = decoy ? 1 : Math.max(1, Math.round(info.maxHp * hpScale * (floorsRun ? tierMultiplier(floorsRun.tier) : 1)));
    const id = `${tag}-${progress.enemies.length}`.slice(0, 60);
    progress.enemies.push({
      state: {
        id, enemyId, ...spawn, facing: Math.PI, hp: maxHp, maxHp, state: 'idle',
        telegraph: null, slowMs: 0, stunMs: 0, markMs: 0,
        ...(enemyId === 'guardian' ? { bossPhase: 1 as const, recoveryMs: 0 } : {}),
      },
      cooldownMs: 700, hitMs: 0, attackCount: 0, spawn, respawnMs: 0,
      channelMsRemaining: 0, channelAngle: 0, channelTimerMs: 0,
      waveTag: tag, ...(decoy ? { decoy: true, maxBossPhase: 1 as const } : {}),
    });
    return id;
  }

  /** Everything the Custodian may do to the world, handed to `src/sim/boss.ts` once per tick. */
  function bossContext(events: GameEvent[]): BossContext {
    return {
      room,
      players: () => orderedPlayers().filter((p) => p.state.hp > 0)
        .map((p) => ({ id: p.state.id, x: p.state.x, y: p.state.y, hp: p.state.hp, hidden: (p.state.shroudMs ?? 0) > 0 })),
      damagePlayer: (playerId, sourceEnemyId, damage, ranged) => {
        const p = players.get(playerId);
        // Boss numbers are absolute: the tier curve scales the biome's enemies, never the Custodian.
        return p ? damagePlayer(p, sourceEnemyId, damage, ranged, events, false) : false;
      },
      pushPlayer: (playerId, dx, dy) => {
        const p = players.get(playerId);
        if (!p || p.state.hp <= 0) return;
        const moved = moveCircle(grid, p.state.x, p.state.y, PLAYER_RADIUS, dx, dy);
        p.state.x = moved.x;
        p.state.y = moved.y;
      },
      slowPlayer: (playerId, ms) => {
        const p = players.get(playerId);
        if (p) p.state.slowMs = Math.max(p.state.slowMs ?? 0, ms);
      },
      pushEnemy: (enemyId, dx, dy) => {
        const e = progress.enemies.find((candidate) => candidate.state.id === enemyId);
        if (!e || e.state.hp <= 0) return;
        const moved = moveCircle(grid, e.state.x, e.state.y, ENEMY_INFO[e.state.enemyId].radius, dx, dy);
        e.state.x = moved.x;
        e.state.y = moved.y;
      },
      teleportEnemy: (enemyId, x, y) => {
        const e = progress.enemies.find((candidate) => candidate.state.id === enemyId);
        if (!e || e.state.hp <= 0) return;
        const at = nearestOpenPosition(grid, { x, y }, ENEMY_INFO[e.state.enemyId].radius);
        e.state.x = at.x;
        e.state.y = at.y;
      },
      sees: (a, b) => clearPath(grid, a, b),
      fireBolts: (ownerEnemyId, x, y, facing, kind, bolts, damage) =>
        firePattern(ownerEnemyId, x, y, facing, kind, bolts, damage),
      spawnAdd,
      otherEnemies: () => progress.enemies.filter((e) => e.state.hp > 0).map((e) => ({ id: e.state.id, x: e.state.x, y: e.state.y })),
      aliveWithTag: (tag) => progress.enemies.some((e) => e.waveTag === tag && e.state.hp > 0),
      enemyPool: biomeEnemyPool,
      emit: (event) => { events.push(emit(event)); },
      relays: () => progress.anchor?.ritual?.relays.map((relay) => ({ x: relay.x, y: relay.y })) ?? null,
      setRelayState: (index, state) => {
        const relay = progress.anchor?.ritual?.relays[index];
        if (!relay) return;
        relay.latchedMs = state.latchedMs;
        relay.inert = state.inert;
      },
    };
  }

  /** The boss's floor, for the renderer and the HUD: marked tiles now, corrupted tiles for good. */
  function bossFieldFor(): { bossField?: NonNullable<GameSnapshot['bossField']> } {
    const boss = progress.enemies.find((e) => e.custodian && e.state.hp > 0);
    const field = boss?.custodian ? bossFieldSnapshot(boss.custodian) : null;
    return field ? { bossField: field } : {};
  }

  function spawnEnemies(): EnemyRuntime[] {
    const enemies: EnemyRuntime[] = [];
    const encounters = [...room.encounters];
    if (room.isFinal && !encounters.some((e) => e.enemyId === 'guardian')) {
      const at = findTile('A') ?? findTile('P') ?? tileToWorld(1, 1);
      const tile = worldToTile(at.x, at.y);
      encounters.push({ id: 'anchor-guardian', enemyId: 'guardian', x: tile.col, y: tile.row, count: 1 });
    }
    const hpScale = floorsRun && phase === 'expedition' ? tierMultiplier(floorsRun.tier) : 1;
    for (const planned of encounters) {
      // Floors biome exits: the gatekeeper is a one-phase Custodian until B1 gives it its own fight.
      const gatekeeper = floorsRun !== null && planned.role === 'gatekeeper';
      const encounter = gatekeeper ? { ...planned, enemyId: 'guardian' as const, count: 1 } : planned;
      const info = ENEMY_INFO[encounter.enemyId];
      // The Custodian is the Anchor's keeper: the pattern registry, the crew-sized health and the
      // phase structure belong to the boss that stands over a relay ring, plus the gatekeepers that
      // preview it. A guardian in a room with no relays stays the plain room-3 encounter it was.
      const boss = encounter.enemyId === 'guardian' && (gatekeeper || room.anchorRelays !== undefined);
      const tier = gatekeeper ? floorsRun?.tier ?? 0 : 4;
      // Their health is absolute (BOSS_FINALE §3.1, §5): it scales with the crew, not with the tier,
      // so the last fight lasts a readable minute wherever the crew arrives from.
      const maxHp = boss
        ? (gatekeeper ? gatekeeperMaxHp(tier, players.size) : custodianMaxHp(players.size))
        : Math.round(info.maxHp * hpScale);
      let reachable: Set<number> | undefined;
      for (let i = 0; i < encounter.count; i++) {
        const base = tileToWorld(encounter.x, encounter.y);
        const offset = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (info.radius * 2 + 6);
        let spawn = nearestOpenPosition(grid, { x: base.x + offset, y: base.y }, info.radius);
        if (floorsRun && i > 0) {
          // Pack members fan out sideways; never into a pocket the crew cannot reach (sealed doors would never open).
          reachable ??= connectedTiles(grid, { col: encounter.x, row: encounter.y });
          const tile = worldToTile(spawn.x, spawn.y);
          if (!reachable.has(tile.row * grid.width + tile.col)) spawn = nearestOpenPosition(grid, base, info.radius);
        }
        enemies.push({
          state: {
            id: `${encounter.id.slice(0, 61)}-${i}`, enemyId: encounter.enemyId,
            ...spawn,
            facing: Math.PI, hp: maxHp, maxHp, state: 'idle',
            telegraph: null, slowMs: 0, stunMs: 0, markMs: 0,
            ...(encounter.enemyId === 'guardian' ? { bossPhase: 1, recoveryMs: 0 } : {}),
          },
          cooldownMs: 500, hitMs: 0, attackCount: 0, spawn, respawnMs: 0,
          channelMsRemaining: 0, channelAngle: 0, channelTimerMs: 0,
          ...(gatekeeper ? { maxBossPhase: 1 as const } : {}),
          ...(boss ? { custodian: createCustodianRuntime({
            custodian: worldCustodian(),
            // A gatekeeper previews ONE of the final boss's three patterns, so by the time the
            // crew reaches the last room they have been shown the fight three times.
            ...(gatekeeper ? {
              moveIndices: [...gatekeeperTier(tier).moveIndices],
              telegraphScale: gatekeeperTier(tier).telegraphScale,
              maxPhase: 1 as const,
            } : {}),
          }) } : {}),
        });
      }
    }
    return enemies;
  }

  /** Training targets come back a few seconds after being defeated. */
  function respawnTrainingTargets(): void {
    for (const e of progress.enemies) {
      if (e.state.hp > 0) continue;
      e.respawnMs = e.respawnMs === 0 ? TRAINING_RESPAWN_MS : decay(e.respawnMs);
      if (e.respawnMs > 0) continue;
      const info = ENEMY_INFO[e.state.enemyId];
      Object.assign(e.state, { ...e.spawn, hp: info.maxHp, state: 'idle', telegraph: null, slowMs: 0, stunMs: 0, markMs: 0 });
      e.cooldownMs = 600;
      e.hitMs = 0;
    }
  }

  function loadRoom(next: RoomSpec, nextPhase: GamePhase, arrival?: DoorArrival): void {
    room = next;
    phase = nextPhase;
    grid = buildSolidGrid(room);
    projectiles = [];
    enemyDamageScale = floorsRun && nextPhase === 'expedition' ? tierMultiplier(floorsRun.tier) : 1;
    const saved = nextPhase === 'expedition' ? rooms.get(roomKey(next)) : undefined;
    const anchorPoint = room.isFinal ? findTile('A') : null;
    progress = saved ?? {
      enemies: nextPhase === 'expedition' || nextPhase === 'training' ? spawnEnemies() : [],
      anchor: anchorPoint ? {
        ...anchorPoint, state: 'dormant', progress: 0,
        ...(room.anchorRelays ? { ritual: {
          stage: 'locked' as const,
          relays: room.anchorRelays.map((relay) => ({ ...tileToWorld(relay.x, relay.y), activated: false })),
          activeRelay: 0, pulseRadius: 0, pulseWarningMs: ANCHOR_PULSE_WARNING_MS, dischargeMs: 0,
        } } : {}),
      } : null,
      cleared: false,
      pulseHitPlayers: new Set(),
      terrain: createTerrainState(),
      loreNodes: nextPhase === 'expedition' ? room.relics.map((relic) => ({
        state: {
          id: relic.id, kind: 'relic', ...tileToWorld(relic.x, relic.y), fragmentIndex: relic.fragmentIndex,
          state: discoveredLore.has(relic.fragmentIndex) ? 'collected' : 'sealed', progress: 0,
        },
        holdMs: 0,
      })) : [],
    };
    if (nextPhase === 'expedition') rooms.set(roomKey(next), progress);
    // Floors: a room with nobody to fight is open from the start and pays nothing.
    if (floorsRun && nextPhase === 'expedition' && !saved && progress.enemies.length === 0) progress.cleared = true;
    rebuildGrid();
    placePlayers(arrival);
  }

  /** Floors: load a room of the current biome and record it on the map. */
  function enterFloorRoom(next: RoomSpec, arrival: DoorArrival | undefined, events: GameEvent[]): void {
    if (!floorsRun || !world || next.biomeId === undefined || next.roomId === undefined) return;
    loadRoom(next, 'expedition', arrival);
    markVisited(floorsRun, { biomeId: next.biomeId, roomId: next.roomId });
    // Rest sites and caches show as cleared on the map once they are used, not on entry.
    if (progress.cleared && next.feature !== 'rest' && next.feature !== 'treasure') markCleared(floorsRun, next.roomId);
    events.push(emit({ type: 'room_entered', worldId: world.worldId, roomIndex: next.index, roomId: next.id, roomName: next.name,
      playerIds: playerIds(), biomeId: next.biomeId, floorRoomId: next.roomId, kind: next.kind }));
  }

  /** Floors: the host's pick resolved last tick; move the crew to the next biome's entrance. */
  function enterChosenBiome(events: GameEvent[]): void {
    const run = floorsRun;
    const choice = run?.choice;
    if (!run || !choice?.chosenBiomeId || !world || phase !== 'expedition') return;
    const biomeId = choice.chosenBiomeId;
    const decider = run.hostPlayerId ?? playerIds()[0];
    const chosenBy = decider !== undefined && choice.votes[decider] === biomeId ? decider : null;
    rooms.clear(); // no way back to the biome we leave
    advanceBiome(run, biomeId);
    events.push(emit({ type: 'biome_entered', worldId: world.worldId, biomeId, biomeName: run.provider.brief(biomeId).name,
      tier: run.tier, chosenByPlayerId: chosenBy, playerIds: playerIds() }));
    enterFloorRoom(run.provider.getRoom({ biomeId, roomId: FLOOR_ENTRANCE_ROOM_ID }), undefined, events);
  }

  /** Floors room kinds: rest sites, caches and the biome choice site all sit on the room's focus. */
  function updateFloorFeatures(living: PlayerRuntime[], busy: Set<string>, events: GameEvent[]): void {
    const run = floorsRun;
    const site = focusPoint(room);
    if (!run || !world || !site || room.roomId === undefined) return;
    const near = (p: PlayerRuntime) => distance(p.state, site) <= FLOOR_TUNING.featureRange;
    if (room.feature === 'rest' && !run.usedFeatures.has(room.roomId)) {
      const visitor = living.find(near);
      if (!visitor || !living.some((p) => p.state.hp < p.state.maxHp)) return;
      run.usedFeatures.add(room.roomId);
      markCleared(run, room.roomId);
      for (const p of living) heal(p, visitor, Math.ceil(p.state.maxHp * FLOOR_TUNING.restHealFraction), events);
    } else if (room.feature === 'treasure' && !run.usedFeatures.has(room.roomId)) {
      if (!living.some(near)) return;
      run.usedFeatures.add(room.roomId);
      markCleared(run, room.roomId);
      for (const p of players.values()) p.state.resources += TREASURE_REWARD;
      events.push(emit({ type: 'room_cleared', worldId: world.worldId, roomIndex: room.index, roomId: room.id, playerIds: playerIds(), reward: TREASURE_REWARD }));
    } else if (room.feature === 'biome_exit' && progress.cleared && !run.choice) {
      const opener = living.find((p) => !busy.has(p.state.id) && p.interactPressed && near(p));
      const options = run.provider.nextBiomeChoices(run.biomeId).slice(0, 2);
      if (!opener || options.length === 0) return;
      run.choice = { fromBiomeId: run.biomeId, options, votes: {}, hostPlayerId: run.hostPlayerId, chosenBiomeId: null };
      events.push(emit({ type: 'biome_choice_offered', worldId: world.worldId, fromBiomeId: run.biomeId, options }));
    }
  }

  function makePlayer(identity: PlayerIdentity): PlayerRuntime {
    return {
      state: {
        ...identity, x: 0, y: 0, vx: 0, vy: 0, facing: 0,
        hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, state: 'idle',
        dashCooldownMs: 0, attackCooldownMs: 0, invulnerableMs: 0,
        // New operatives start with exactly one unlock's worth of resources so the E ability
        // can be unlocked at HQ before the first expedition.
        resources: ABILITY_UNLOCK_COST, abilityEUnlocked: false, abilityQCooldownMs: 0, abilityECooldownMs: 0,
        shieldMs: 0, shroudMs: 0, rallyMs: 0, reviveProgress: 0, ultCharge: 0, abilityRCooldownMs: 0,
      },
      intent: null, unlockedClasses: new Set(), dashRemainingMs: 0,
      dashDirection: { x: 1, y: 0 }, attackRemainingMs: 0, hitRemainingMs: 0,
      onExit: false, interacting: false, interactHeld: false, interactPressed: false, damagedThisTick: false, history: [],
    };
  }

  function livingEnemies(): EnemyRuntime[] {
    return progress.enemies.filter((e) => e.state.hp > 0);
  }

  function damageEnemy(e: EnemyRuntime, p: PlayerRuntime, damage: number, events: GameEvent[]): void {
    const s = e.state;
    if (s.hp <= 0) return;
    const marked = Math.round(damage * ((s.markMs ?? 0) > 0 ? 1.3 : 1));
    // The Custodian caps single hits at 12% of its health, applies its phase-3 shield and any
    // vulnerability window it has opened (BOSS_FINALE §3.2, §4.2).
    const amount = Math.min(s.hp, e.custodian ? custodianIncomingDamage(e.custodian, s, marked) : marked);
    s.hp -= amount;
    e.hitMs = 130;
    s.state = s.hp === 0 ? 'dead' : s.telegraph ? 'attacking' : 'hit';
    // Ultimates charge from real combat: damage dealt plus a bonus per kill.
    p.state.ultCharge = Math.min(ULT_CHARGE_MAX, p.state.ultCharge + amount * ULT_CHARGE_PER_DAMAGE + (s.hp === 0 ? ULT_CHARGE_PER_KILL : 0));
    events.push(emit({ type: 'enemy_damaged', enemyId: s.id, byPlayerId: p.state.id, amount, remainingHp: s.hp }));
    if (s.hp === 0) {
      s.telegraph = null;
      events.push(emit({ type: 'enemy_defeated', enemyId: s.id, byPlayerId: p.state.id }));
      dropRemains(e);
    }
  }

  /** The first kill of each enemy kind leaves its lore behind where it fell. */
  function dropRemains(e: EnemyRuntime): void {
    const lore = world?.recipe.lore ?? [];
    const fragmentIndex = lore.findIndex((f) => f.kind === 'remains' && f.enemyId === e.state.enemyId);
    if (fragmentIndex < 0 || discoveredLore.has(fragmentIndex)) return;
    if (progress.loreNodes.some((n) => n.state.fragmentIndex === fragmentIndex)) return;
    progress.loreNodes.push({
      state: { id: `remains-${e.state.id}`, kind: 'remains', x: e.state.x, y: e.state.y, fragmentIndex, state: 'sealed', progress: 0 },
      holdMs: 0,
    });
  }

  function discoverLore(node: LoreNodeRuntime, by: PlayerRuntime, events: GameEvent[]): void {
    const fragment = world?.recipe.lore[node.state.fragmentIndex];
    node.state.state = 'collected';
    node.state.progress = 1;
    node.holdMs = 0;
    discoveredLore.add(node.state.fragmentIndex);
    if (!fragment) return;
    events.push(emit({
      type: 'lore_discovered', playerId: by.state.id, fragmentIndex: node.state.fragmentIndex, kind: fragment.kind,
      title: fragment.title, source: fragment.source, text: fragment.text, x: node.state.x, y: node.state.y,
    }));
  }

  /**
   * Remains are picked up by touch; relics take a short uninterrupted F-hold so reading is a
   * deliberate beat rather than an accident mid-fight. Rescuers stay reserved for revives.
   */
  function updateLore(living: PlayerRuntime[], busy: Set<string>, events: GameEvent[]): void {
    for (const node of progress.loreNodes) {
      if (node.state.state === 'collected') continue;
      if (node.state.kind === 'remains') {
        const finder = living.find((p) => distance(p.state, node.state) <= LORE_PICKUP_RANGE + PLAYER_RADIUS);
        if (finder) discoverLore(node, finder, events);
        continue;
      }
      const reader = living.find((p) => !busy.has(p.state.id) && p.interacting && !p.damagedThisTick &&
        distance(p.state, node.state) <= LORE_READ_RANGE && clearPath(grid, p.state, node.state));
      if (!reader) {
        node.holdMs = 0;
        node.state.state = 'sealed';
        node.state.progress = 0;
        continue;
      }
      busy.add(reader.state.id);
      node.holdMs += TICK_MS;
      node.state.state = 'reading';
      node.state.progress = Math.min(1, node.holdMs / LORE_READ_MS);
      if (node.state.progress >= 1 - 1e-7) discoverLore(node, reader, events);
    }
    progress.loreNodes = progress.loreNodes.filter((n) => !(n.state.kind === 'remains' && n.state.state === 'collected'));
  }

  function damagePlayer(p: PlayerRuntime, sourceEnemyId: string, damage: number, ranged: boolean, events: GameEvent[], scaled = true): boolean {
    const s = p.state;
    if (s.hp <= 0 || s.invulnerableMs > 0 || (ranged && s.shieldMs > 0)) return false;
    if (scaled && enemyDamageScale !== 1 && sourceEnemyId !== 'anchor-pulse') damage = Math.round(damage * enemyDamageScale);
    let amount = Math.min(s.hp, s.shieldMs > 0 ? Math.ceil(damage * 0.2) : damage);
    // Training range: hits land (so the telegraphs teach), but nobody goes down.
    if (phase === 'training') amount = Math.min(amount, Math.max(0, s.hp - 1));
    if (amount <= 0) return false;
    s.hp -= amount;
    s.invulnerableMs = 350;
    s.reviveProgress = 0;
    p.damagedThisTick = true;
    p.hitRemainingMs = 160;
    events.push(emit({ type: 'player_damaged', playerId: s.id, amount, remainingHp: s.hp, sourceEnemyId }));
    if (s.hp === 0) {
      s.state = 'down';
      s.vx = s.vy = 0;
      s.shieldMs = s.shroudMs = s.rallyMs = 0;
      p.dashRemainingMs = p.attackRemainingMs = 0;
      p.interacting = false;
      events.push(emit({ type: 'player_downed', playerId: s.id }));
    } else {
      s.state = 'hit';
    }
    return true;
  }

  function heal(p: PlayerRuntime, by: PlayerRuntime, amount: number, events: GameEvent[]): void {
    if (p.state.hp <= 0) return;
    const restored = Math.max(0, Math.min(p.state.maxHp - p.state.hp, amount));
    if (restored === 0) return;
    p.state.hp += restored;
    events.push(emit({ type: 'player_healed', playerId: p.state.id, byPlayerId: by.state.id, amount: restored, remainingHp: p.state.hp }));
  }

  function spawnProjectile(
    x: number, y: number, angle: number, speed: number, radius: number,
    damage: number, life: number, ownerEnemyId: string, homingTurnRate?: number,
  ): void {
    if (projectiles.length > 400) projectiles.shift();
    projectiles.push({
      id: `${ownerEnemyId.slice(0, 24)}-p${projectileCounter++}`, ownerEnemyId,
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      radius, damage, remainingMs: life, homingTurnRate,
    });
  }

  /**
   * Fires one burst of bolts from a single resolved attack.
   *  - `spread`: bolts fan out around `facing` by `pattern.spacing` radians.
   *  - `ring`: bolts fan out in a full circle, the first one aligned to `facing` (still aimed).
   *  - `volley`: bolts share one aim line, staggered `pattern.spacing` px apart so they land
   *    in sequence like a burst of shots rather than a single simultaneous fan.
   *  - `homing`/`spiral-shot`: a single aimed bolt (spiral's rotation is handled by the caller).
   */
  function firePattern(
    ownerEnemyId: string, x: number, y: number, facing: number,
    kind: 'spread' | 'ring' | 'volley' | 'homing' | 'spiral-shot',
    pattern: ProjectilePattern, damage: number,
  ): void {
    for (let i = 0; i < pattern.count; i++) {
      let angle = facing;
      let px = x;
      let py = y;
      if (kind === 'spread') angle = facing + (i - (pattern.count - 1) / 2) * pattern.spacing;
      else if (kind === 'ring') angle = facing + i * pattern.spacing;
      else if (kind === 'volley') {
        px = x - Math.cos(facing) * i * pattern.spacing;
        py = y - Math.sin(facing) * i * pattern.spacing;
      }
      spawnProjectile(px, py, angle, pattern.speed, pattern.radius, damage, pattern.life, ownerEnemyId,
        kind === 'homing' ? pattern.homingTurnRate : undefined);
    }
  }

  function stepProjectiles(events: GameEvent[]): void {
    if (projectiles.length === 0) return;
    const alive: ProjectileRuntime[] = [];
    for (const pr of projectiles) {
      pr.remainingMs = decay(pr.remainingMs);
      if (pr.remainingMs === 0) continue;
      if (pr.homingTurnRate) {
        const target = orderedPlayers().filter((p) => p.state.hp > 0 && (p.state.shroudMs ?? 0) === 0)
          .sort((a, b) => distance(pr, a.state) - distance(pr, b.state))[0];
        if (target) {
          const desired = Math.atan2(target.state.y - pr.y, target.state.x - pr.x);
          const current = Math.atan2(pr.vy, pr.vx);
          const diff = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
          const maxTurn = pr.homingTurnRate * TICK_MS / 1000;
          const turned = current + Math.max(-maxTurn, Math.min(maxTurn, diff));
          const speed = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(turned) * speed;
          pr.vy = Math.sin(turned) * speed;
        }
      }
      const nx = pr.x + pr.vx * TICK_MS / 1000;
      const ny = pr.y + pr.vy * TICK_MS / 1000;
      if (circleHitsSolid(grid, nx, ny, pr.radius)) continue;
      pr.x = nx;
      pr.y = ny;
      let hit = false;
      for (const p of orderedPlayers()) {
        if (p.state.hp <= 0) continue;
        if (distance(pr, p.state) <= pr.radius + PLAYER_RADIUS) {
          damagePlayer(p, pr.ownerEnemyId, pr.damage, true, events);
          hit = true;
          break;
        }
      }
      if (!hit) alive.push(pr);
    }
    projectiles = alive;
  }

  function arcTargets(origin: Point, facing: number, range: number, arc: number): EnemyRuntime[] {
    return livingEnemies().filter((e) =>
      inArc(origin, e.state, facing, range, arc, ENEMY_INFO[e.state.enemyId].radius) &&
      clearPath(grid, origin, e.state),
    ).sort((a, b) => distance(origin, a.state) - distance(origin, b.state));
  }

  function basicAttack(p: PlayerRuntime, events: GameEvent[]): void {
    const s = p.state;
    const spec = CLASS_COMBAT[s.classId];
    let targets = arcTargets(s, s.facing, spec.range, spec.arc);
    if (s.classId === 'beacon' || s.classId === 'shade') targets = targets.slice(0, 1);
    const bonus = s.shroudMs > 0 ? 18 : 0;
    s.shroudMs = 0;
    p.attackRemainingMs = ATTACK_DURATION_MS;
    s.attackCooldownMs = spec.cooldown * (s.rallyMs > 0 ? 0.75 : 1);
    events.push(emit({ type: 'player_attacked', playerId: s.id, x: s.x, y: s.y, facing: s.facing,
      range: spec.range, arcRad: spec.arc, hitEnemyIds: targets.map((e) => e.state.id) }));
    for (const e of targets) {
      damageEnemy(e, p, spec.damage + bonus, events);
      if (s.classId === 'weaver') e.state.slowMs = Math.max(e.state.slowMs ?? 0, 1000);
    }
    const terrainStrike = strikeBreakableWalls(room, grid, progress.terrain, {
      x: s.x, y: s.y, facing: s.facing, range: spec.range, arc: spec.arc, damage: spec.damage + bonus,
    });
    progress.terrain = terrainStrike.state;
    if (terrainStrike.hits.some((hit) => hit.destroyed)) rebuildGrid();
  }

  /** Push an enemy away from (or toward, with negative distance) a point, respecting walls. */
  function shove(e: EnemyRuntime, from: Point, distancePx: number): void {
    const d = distance(from, e.state) || 1;
    const moved = moveCircle(grid, e.state.x, e.state.y, ENEMY_INFO[e.state.enemyId].radius,
      ((e.state.x - from.x) / d) * distancePx, ((e.state.y - from.y) / d) * distancePx);
    e.state.x = moved.x;
    e.state.y = moved.y;
  }

  function useAbility(p: PlayerRuntime, slot: 'q' | 'e' | 'r', intent: PlayerIntent, events: GameEvent[]): void {
    const s = p.state;
    // E is an HQ unlock during expeditions; the training range unlocks everything for practice.
    if (slot === 'e' && !s.abilityEUnlocked && phase !== 'training') return;
    if (slot === 'r' && (s.ultCharge < ULT_CHARGE_MAX || s.abilityRCooldownMs > 0)) return;
    if ((slot === 'q' ? s.abilityQCooldownMs : slot === 'e' ? s.abilityECooldownMs : 0) > 0) return;
    const id = CLASS_ABILITIES[s.classId][slot];
    const spec = CLASS_COMBAT[s.classId];
    if (slot === 'q') s.abilityQCooldownMs = spec.qCooldown;
    else if (slot === 'e') s.abilityECooldownMs = spec.eCooldown;
    else {
      s.ultCharge = 0;
      s.abilityRCooldownMs = 1200;
    }
    const hits: string[] = [];
    events.push(emit({ type: 'ability_used', playerId: s.id, abilityId: id, x: s.x, y: s.y, facing: s.facing, hitEnemyIds: hits }));
    const strike = (e: EnemyRuntime, damage: number): void => {
      hits.push(e.state.id);
      damageEnemy(e, p, damage, events);
    };
    const aimPoint = (maxRange: number): Point => {
      const aimDistance = Math.min(maxRange, distance(s, { x: intent.aimX, y: intent.aimY }));
      return moveCircle(grid, s.x, s.y, 2, Math.cos(s.facing) * aimDistance, Math.sin(s.facing) * aimDistance);
    };
    switch (id) {
      // ---- ultimates ------------------------------------------------------------
      case 'bastion.r.aegis_slam':
        s.shieldMs = Math.max(s.shieldMs, 1800);
        for (const e of arcTargets(s, s.facing, 170, Math.PI * 2)) {
          strike(e, 60);
          if (e.state.hp <= 0) continue;
          e.state.stunMs = 2000;
          e.state.telegraph = null;
          shove(e, s, 110);
        }
        break;
      case 'shade.r.blade_storm':
        s.invulnerableMs = Math.max(s.invulnerableMs, 900);
        s.shroudMs = Math.max(s.shroudMs, 900);
        for (const e of arcTargets(s, s.facing, 120, Math.PI * 2)) {
          for (let cut = 0; cut < 3 && e.state.hp > 0; cut++) strike(e, 22);
          if (e.state.hp > 0) e.state.slowMs = Math.max(e.state.slowMs ?? 0, 1500);
        }
        break;
      case 'beacon.r.solar_lance':
        for (const e of livingEnemies()) {
          // Everything within 26 px of the aim line up to 420 px, walls included, is scorched.
          const dx = Math.cos(s.facing);
          const dy = Math.sin(s.facing);
          const along = (e.state.x - s.x) * dx + (e.state.y - s.y) * dy;
          if (along < 0 || along > 420) continue;
          const across = Math.abs(-(e.state.x - s.x) * dy + (e.state.y - s.y) * dx);
          if (across > 26 + ENEMY_INFO[e.state.enemyId].radius) continue;
          strike(e, 55);
          if (e.state.hp > 0) e.state.markMs = 5000;
        }
        break;
      case 'weaver.r.collapse': {
        const centre = aimPoint(260);
        for (const e of livingEnemies()) {
          if (distance(centre, e.state) > 200 + ENEMY_INFO[e.state.enemyId].radius) continue;
          const d = distance(centre, e.state);
          shove(e, centre, -Math.max(0, d - 30)); // drag toward the singularity
          strike(e, 45);
          if (e.state.hp <= 0) continue;
          e.state.stunMs = 1200;
          e.state.slowMs = 3000;
          e.state.telegraph = null;
        }
        break;
      }
      case 'bastion.q.bulwark':
        s.shieldMs = 2200;
        break;
      case 'bastion.e.shockwave':
        for (const e of arcTargets(s, s.facing, 135, Math.PI * 2)) {
          strike(e, 35);
          if (e.state.hp <= 0) continue;
          e.state.stunMs = 1500;
          e.state.telegraph = null;
          const d = distance(s, e.state) || 1;
          const moved = moveCircle(grid, e.state.x, e.state.y, ENEMY_INFO[e.state.enemyId].radius,
            (e.state.x - s.x) / d * 70, (e.state.y - s.y) / d * 70);
          e.state.x = moved.x;
          e.state.y = moved.y;
        }
        break;
      case 'shade.q.blink_strike': {
        const start = { x: s.x, y: s.y };
        const moved = moveCircle(grid, s.x, s.y, PLAYER_RADIUS, Math.cos(s.facing) * 112, Math.sin(s.facing) * 112);
        s.x = moved.x;
        s.y = moved.y;
        s.invulnerableMs = Math.max(s.invulnerableMs, 250);
        for (const e of livingEnemies()) {
          const dx = s.x - start.x;
          const dy = s.y - start.y;
          const lengthSquared = dx * dx + dy * dy;
          const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((e.state.x - start.x) * dx + (e.state.y - start.y) * dy) / lengthSquared));
          const closest = { x: start.x + dx * t, y: start.y + dy * t };
          if (distance(closest, e.state) <= 24 + ENEMY_INFO[e.state.enemyId].radius && clearPath(grid, closest, e.state)) strike(e, 32);
        }
        break;
      }
      case 'shade.e.shroud':
        s.shroudMs = 2200;
        s.invulnerableMs = Math.max(s.invulnerableMs, 600);
        break;
      case 'beacon.q.flare': {
        const aimDistance = Math.min(240, distance(s, { x: intent.aimX, y: intent.aimY }));
        const moved = moveCircle(grid, s.x, s.y, 2, Math.cos(s.facing) * aimDistance, Math.sin(s.facing) * aimDistance);
        for (const e of arcTargets(moved, s.facing, 70, Math.PI * 2)) {
          strike(e, 24);
          e.state.markMs = 4000;
        }
        break;
      }
      case 'beacon.e.rally':
        for (const ally of orderedPlayers()) {
          if (ally.state.hp <= 0 || distance(s, ally.state) > 200 || !clearPath(grid, s, ally.state)) continue;
          heal(ally, p, 35, events);
          ally.state.rallyMs = 4000;
        }
        break;
      case 'weaver.q.tether': {
        const e = arcTargets(s, s.facing, 220, Math.PI * 0.35)[0];
        if (!e) break;
        strike(e, 12);
        if (e.state.hp <= 0) break;
        e.state.slowMs = 3000;
        e.state.telegraph = null;
        e.cooldownMs = Math.max(e.cooldownMs, 600);
        const d = distance(s, e.state) || 1;
        const pull = Math.max(0, d - 55);
        const moved = moveCircle(grid, e.state.x, e.state.y, ENEMY_INFO[e.state.enemyId].radius,
          (s.x - e.state.x) / d * pull, (s.y - e.state.y) / d * pull);
        e.state.x = moved.x;
        e.state.y = moved.y;
        break;
      }
      case 'weaver.e.rewind': {
        const past = p.history[0];
        if (past) {
          s.x = past.x;
          s.y = past.y;
          heal(p, p, Math.max(0, past.hp - s.hp), events);
        }
        s.invulnerableMs = Math.max(s.invulnerableMs, 500);
        break;
      }
    }
  }

  function stepPlayer(p: PlayerRuntime, events: GameEvent[]): void {
    const s = p.state;
    for (const key of ['dashCooldownMs', 'attackCooldownMs', 'invulnerableMs', 'abilityQCooldownMs', 'abilityECooldownMs', 'abilityRCooldownMs', 'shieldMs', 'shroudMs', 'rallyMs'] as const) s[key] = decay(s[key]);
    p.hitRemainingMs = decay(p.hitRemainingMs);
    s.slowMs = decay(s.slowMs ?? 0);
    p.damagedThisTick = false;
    const intent = p.intent;
    p.intent = null;
    p.interacting = intent?.interact === true && s.hp > 0;
    p.interactPressed = p.interacting && !p.interactHeld;
    if (intent) p.interactHeld = intent.interact === true;
    if (s.hp <= 0) {
      s.state = 'down';
      s.vx = s.vy = 0;
      return;
    }
    // Training range: health regenerates once the hit invulnerability has passed.
    if (phase === 'training' && s.invulnerableMs === 0 && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + TRAINING_REGEN_PER_TICK);
    p.history.push({ x: s.x, y: s.y, hp: s.hp });
    if (p.history.length > Math.round(3000 / TICK_MS)) p.history.shift();
    const moveX = intent?.moveX ?? 0;
    const moveY = intent?.moveY ?? 0;
    const length = Math.hypot(moveX, moveY);
    if (intent && distance(s, { x: intent.aimX, y: intent.aimY }) > 0.001) s.facing = Math.atan2(intent.aimY - s.y, intent.aimX - s.x);
    if (intent?.dash && s.dashCooldownMs === 0 && p.dashRemainingMs === 0) {
      p.dashDirection = length > 0 ? { x: moveX / length, y: moveY / length } : { x: Math.cos(s.facing), y: Math.sin(s.facing) };
      p.dashRemainingMs = DASH_DURATION_MS;
      p.attackRemainingMs = 0;
      s.dashCooldownMs = DASH_COOLDOWN_MS;
      s.invulnerableMs = Math.max(s.invulnerableMs, DASH_INVULNERABLE_MS);
      // The event's facing is the direction of travel (renderers draw the trail behind it),
      // not the aim direction — you can dash sideways while looking at an enemy.
      events.push(emit({ type: 'player_dashed', playerId: s.id, x: s.x, y: s.y, facing: Math.atan2(p.dashDirection.y, p.dashDirection.x) }));
    } else if (p.dashRemainingMs === 0 && intent?.ability) {
      useAbility(p, intent.ability, intent, events);
    } else if (p.dashRemainingMs === 0 && intent?.attack && s.attackCooldownMs === 0 && p.attackRemainingMs === 0) {
      basicAttack(p, events);
    }
    if (p.dashRemainingMs > 0) {
      s.vx = p.dashDirection.x * DASH_SPEED;
      s.vy = p.dashDirection.y * DASH_SPEED;
    } else {
      const speed = CLASS_COMBAT[s.classId].speed * (p.attackRemainingMs > 0 ? 0.35 : 1) *
        (s.shroudMs > 0 ? 1.4 : 1) * (s.rallyMs > 0 ? 1.2 : 1) * ((s.slowMs ?? 0) > 0 ? 0.6 : 1) *
        terrainSpeedMultiplier(room, s.x, s.y, progress.terrain.brokenWalls);
      s.vx = length > 0 ? moveX / length * speed : 0;
      s.vy = length > 0 ? moveY / length * speed : 0;
    }
    const moved = moveCircle(grid, s.x, s.y, PLAYER_RADIUS, s.vx * TICK_MS / 1000, s.vy * TICK_MS / 1000);
    s.x = moved.x;
    s.y = moved.y;
    if (moved.blockedX) s.vx = 0;
    if (moved.blockedY) s.vy = 0;
    s.state = p.dashRemainingMs > 0 ? 'dashing' : p.attackRemainingMs > 0 ? 'attacking' :
      p.hitRemainingMs > 0 ? 'hit' : s.vx !== 0 || s.vy !== 0 ? 'moving' : 'idle';
    p.dashRemainingMs = decay(p.dashRemainingMs);
    p.attackRemainingMs = decay(p.attackRemainingMs);
    if (s.state === 'dashing' || s.state === 'attacking' || intent?.ability || length > 0) p.interacting = false;
  }

  function attackKindFor(s: EnemyState, e: EnemyRuntime): { kind: EnemyTelegraph['kind']; range: number; arc: number } {
    const spec = ENEMY_COMBAT[s.enemyId];
    // A Custodian with a pattern registry uses it; the legacy moveset stays for anything without one.
    if (e.custodian) return custodianEngagement(e.custodian);
    if (s.enemyId === 'guardian') {
      if ((s.bossPhase ?? 1) >= 2) {
        const pattern = (s.bossPhase === 3 ? ['charge', 'ring', 'beam', 'burst', 'ring'] : ['beam', 'charge', 'ring', 'burst']) as Array<EnemyTelegraph['kind']>;
        const kind = pattern[e.attackCount % pattern.length]!;
        return { kind, range: kind === 'charge' ? 220 : kind === 'beam' ? 340 : kind === 'ring' ? 260 : 125,
          arc: kind === 'charge' ? 0.3 : kind === 'beam' ? 0.22 : Math.PI * 2 };
      }
      const phase = e.attackCount % 4;
      if (phase === 0) return { kind: 'burst', range: spec.range, arc: spec.arc };
      if (phase === 1) return { kind: 'volley', range: spec.range, arc: 0.2 };
      if (phase === 2) return { kind: 'ring', range: spec.range, arc: Math.PI * 2 };
      return { kind: 'beam', range: 300, arc: 0.25 };
    }
    switch (s.enemyId) {
      case 'sentinel': return { kind: 'volley', range: spec.range, arc: 0.14 };
      case 'lurker': return { kind: 'charge', range: spec.range, arc: spec.arc };
      case 'spewer': return { kind: 'spread', range: spec.range, arc: 0.6 };
      case 'warden': return { kind: 'homing', range: spec.range, arc: 0.12 };
      case 'channeler': return { kind: 'spiral', range: spec.range, arc: Math.PI * 2 };
      default: return { kind: 'melee', range: spec.range, arc: spec.arc };
    }
  }

  function resolveEnemyAttack(e: EnemyRuntime, telegraph: EnemyTelegraph, events: GameEvent[]): void {
    const s = e.state;
    const spec = ENEMY_COMBAT[s.enemyId];
    const hits: string[] = [];
    events.push(emit({ type: 'enemy_attacked', enemyId: s.id, x: telegraph.x, y: telegraph.y, facing: telegraph.facing, hitPlayerIds: hits }));
    // Mirror-shade decoys go through the whole motion and deal nothing; the rim light is the tell.
    if (e.decoy) {
      s.telegraph = null;
      e.cooldownMs = spec.cooldown;
      e.attackCount++;
      return;
    }
    if (e.custodian) {
      const resolution = resolveCustodianPattern(e.custodian, s, telegraph, bossContext(events));
      s.telegraph = null;
      s.recoveryMs = resolution.recoveryMs;
      s.patternId = e.custodian.patternId;
      e.cooldownMs = resolution.cooldownMs;
      e.attackCount++;
      return;
    }
    if (telegraph.kind === 'melee' || telegraph.kind === 'beam' || telegraph.kind === 'burst' || telegraph.kind === 'charge') {
      for (const p of orderedPlayers()) {
        if (!inArc(telegraph, p.state, telegraph.facing, telegraph.range, telegraph.arcRad, PLAYER_RADIUS) ||
          !clearPath(grid, telegraph, p.state)) continue;
        if (damagePlayer(p, s.id, spec.damage, telegraph.kind === 'beam', events)) hits.push(p.state.id);
      }
      if (telegraph.kind === 'charge') {
        const moved = moveCircle(grid, s.x, s.y, ENEMY_INFO[s.enemyId].radius,
          Math.cos(telegraph.facing) * telegraph.range, Math.sin(telegraph.facing) * telegraph.range);
        s.x = moved.x;
        s.y = moved.y;
        if (s.enemyId === 'lurker') firePattern(s.id, s.x, s.y, telegraph.facing, 'ring', LURKER_SPORE_PATTERN, LURKER_SPORE_DAMAGE);
      }
    } else if (telegraph.kind === 'volley' || telegraph.kind === 'spread' || telegraph.kind === 'ring' || telegraph.kind === 'homing') {
      if (s.enemyId === 'guardian') {
        const isVolleyPhase = telegraph.kind === 'volley';
        const ringPattern = s.bossPhase === 3
          ? { ...GUARDIAN_RING_PATTERN, count: 12, spacing: Math.PI / 6, speed: 240, life: 1600 }
          : GUARDIAN_RING_PATTERN;
        const angle = telegraph.facing + (isVolleyPhase ? 0 : (e.attackCount % 2) * ringPattern.spacing / 2);
        firePattern(s.id, telegraph.x, telegraph.y, angle, isVolleyPhase ? 'volley' : 'ring',
          isVolleyPhase ? GUARDIAN_VOLLEY_PATTERN : ringPattern,
          isVolleyPhase ? GUARDIAN_VOLLEY_DAMAGE : GUARDIAN_RING_DAMAGE);
      } else {
        const pattern = ENEMY_PROJECTILE_PATTERN[s.enemyId];
        if (pattern) firePattern(s.id, telegraph.x, telegraph.y, telegraph.facing, telegraph.kind, pattern, spec.damage);
      }
    }
    s.telegraph = null;
    e.cooldownMs = spec.cooldown;
    if (s.enemyId === 'guardian') {
      s.recoveryMs = telegraph.kind === 'charge' || telegraph.kind === 'burst' ? 1100 : 650;
      e.cooldownMs = s.bossPhase === 3 ? 1200 : 1600;
    }
    e.attackCount++;
  }

  function startChannel(e: EnemyRuntime, telegraph: EnemyTelegraph, events: GameEvent[]): void {
    const s = e.state;
    events.push(emit({ type: 'enemy_attacked', enemyId: s.id, x: telegraph.x, y: telegraph.y, facing: telegraph.facing, hitPlayerIds: [] }));
    e.channelMsRemaining = CHANNEL_PATTERN.durationMs;
    e.channelAngle = telegraph.facing;
    e.channelTimerMs = 0;
    s.telegraph = null;
  }

  function stepChannel(e: EnemyRuntime): void {
    const s = e.state;
    s.state = 'attacking';
    e.channelTimerMs -= TICK_MS;
    if (e.channelTimerMs <= 0) {
      firePattern(s.id, s.x, s.y, e.channelAngle, 'spiral-shot',
        { count: 1, spacing: 0, speed: CHANNEL_PATTERN.speed, radius: CHANNEL_PATTERN.radius, life: CHANNEL_PATTERN.life },
        ENEMY_COMBAT[s.enemyId].damage);
      e.channelAngle += CHANNEL_PATTERN.spacingRad;
      e.channelTimerMs += CHANNEL_PATTERN.shotIntervalMs;
    }
    e.channelMsRemaining = Math.max(0, e.channelMsRemaining - TICK_MS);
    if (e.channelMsRemaining === 0) {
      e.cooldownMs = ENEMY_COMBAT[s.enemyId].cooldown;
      s.state = 'idle';
    }
  }

  function stepEnemy(e: EnemyRuntime, events: GameEvent[]): void {
    const s = e.state;
    if (s.hp <= 0) return;
    const spec = ENEMY_COMBAT[s.enemyId];
    if (s.enemyId === 'guardian') {
      const ctx = e.custodian ? bossContext(events) : null;
      const nextPhase = e.custodian && ctx
        ? custodianPhase(e.custodian, s, ctx)
        : Math.min(e.maxBossPhase ?? 3, guardianPhase(s.hp, s.maxHp)) as 1 | 2 | 3;
      if (nextPhase !== s.bossPhase) {
        s.bossPhase = nextPhase;
        s.telegraph = null;
        // The transition IS the rest beat: invulnerable, no projectiles, a new title card.
        s.recoveryMs = e.custodian ? PHASE_CHANGE_RECOVERY_MS : 1400;
        e.cooldownMs = 1500;
        e.attackCount = 0;
        projectiles = projectiles.filter((projectile) => projectile.ownerEnemyId !== s.id);
        if (e.custodian && ctx) onCustodianPhase(e.custodian, s, ctx, nextPhase);
      }
      s.recoveryMs = decay(s.recoveryMs ?? 0);
      if (e.custodian && ctx) {
        stepCustodian(e.custodian, s, ctx);
        s.patternId = e.custodian.patternId;
      }
    }
    s.slowMs = decay(s.slowMs ?? 0);
    s.stunMs = decay(s.stunMs ?? 0);
    s.markMs = decay(s.markMs ?? 0);
    e.cooldownMs = decay(e.cooldownMs);
    e.hitMs = decay(e.hitMs);
    if (s.stunMs > 0) {
      s.telegraph = null;
      s.state = 'hit';
      return;
    }
    if ((s.recoveryMs ?? 0) > 0) {
      s.state = 'idle';
      return;
    }
    // A live sweep, vent purge or pylon channel holds the Custodian in place until it ends.
    if (e.custodian && custodianBusy(e.custodian)) {
      s.state = 'attacking';
      return;
    }
    if (e.channelMsRemaining > 0) {
      stepChannel(e);
      return;
    }
    if (s.telegraph) {
      s.state = 'attacking';
      s.telegraph.remainingMs = decay(s.telegraph.remainingMs);
      if (s.telegraph.remainingMs === 0) {
        if (s.telegraph.kind === 'spiral') startChannel(e, s.telegraph, events);
        else resolveEnemyAttack(e, s.telegraph, events);
        s.state = 'idle';
      }
      return;
    }
    const target = orderedPlayers().filter((p) => p.state.hp > 0 && p.state.shroudMs === 0)
      .sort((a, b) => distance(s, a.state) - distance(s, b.state))[0];
    if (!target || (phase === 'training' && distance(s, target.state) > TRAINING_WAKE_RANGE)) {
      // Training targets doze in their pens until an operative walks up to them.
      s.state = 'idle';
      return;
    }
    s.facing = Math.atan2(target.state.y - s.y, target.state.x - s.x);
    const { kind, range, arc } = attackKindFor(s, e);
    if (e.cooldownMs === 0 && distance(s, target.state) <= range && clearPath(grid, s, target.state)) {
      // The Custodian's wind-up comes from the pattern registry (phase scale, ×1.4 on first use)
      // and, for shatter_step, so does the after-image's position.
      const start = e.custodian ? beginCustodianPattern(e.custodian, s, bossContext(events)) : null;
      s.telegraph = { kind, x: start?.x ?? s.x, y: start?.y ?? s.y, facing: s.facing, range, arcRad: arc,
        remainingMs: start?.remainingMs ?? (s.bossPhase === 3 ? 900 : spec.windup) };
      s.state = 'attacking';
      events.push(emit({ type: 'enemy_telegraphed', enemyId: s.id, telegraph: { ...s.telegraph } }));
      return;
    }
    const ranged = kind !== 'melee' && kind !== 'charge';
    const stopRange = s.enemyId === 'guardian' ? 85 : ranged ? range * 0.7 : 34;
    if (distance(s, target.state) > stopRange || !clearPath(grid, s, target.state)) {
      const waypoint = chaseWaypoint(grid, s, target.state, ENEMY_INFO[s.enemyId].radius);
      const d = distance(s, waypoint);
      const step = Math.min(d, spec.speed * (s.slowMs > 0 ? 0.35 : 1) *
        terrainSpeedMultiplier(room, s.x, s.y, progress.terrain.brokenWalls) * TICK_MS / 1000);
      if (d > 0) {
        const moved = moveCircle(grid, s.x, s.y, ENEMY_INFO[s.enemyId].radius,
          (waypoint.x - s.x) / d * step, (waypoint.y - s.y) / d * step);
        s.x = moved.x;
        s.y = moved.y;
      }
      s.state = e.hitMs > 0 ? 'hit' : 'chasing';
    } else {
      s.state = e.hitMs > 0 ? 'hit' : 'idle';
    }
  }

  function finishRun(outcome: 'anchored' | 'collapsed' | 'aborted', events: GameEvent[]): void {
    if (phase !== 'expedition' || !world) return;
    phase = 'debrief';
    for (const p of players.values()) {
      p.intent = null;
      p.state.vx = p.state.vy = 0;
    }
    events.push(emit({ type: 'run_ended', worldId: world.worldId, outcome, playerIds: playerIds() }));
  }

  function updateObjectives(events: GameEvent[]): void {
    if (phase !== 'expedition' || !world) return;
    const living = orderedPlayers().filter((p) => p.state.hp > 0);
    if (players.size > 0 && living.length === 0) {
      finishRun('collapsed', events);
      return;
    }
    const busy = new Set<string>();
    for (const downed of orderedPlayers().filter((p) => p.state.hp === 0)) {
      const rescuer = living.find((p) => !busy.has(p.state.id) && p.interacting && !p.damagedThisTick &&
        distance(p.state, downed.state) <= REVIVE_RANGE && clearPath(grid, p.state, downed.state));
      if (!rescuer) {
        downed.state.reviveProgress = 0;
        continue;
      }
      busy.add(rescuer.state.id);
      downed.state.reviveProgress = Math.min(1, downed.state.reviveProgress + TICK_MS / REVIVE_DURATION_MS);
      if (downed.state.reviveProgress >= 1 - 1e-7) {
        downed.state.hp = Math.min(REVIVE_HP, downed.state.maxHp);
        resetTransient(downed);
        downed.state.invulnerableMs = 1000;
        events.push(emit({ type: 'player_revived', playerId: downed.state.id, byPlayerId: rescuer.state.id, hp: downed.state.hp }));
      }
    }
    updateLore(living, busy, events);
    if (!progress.cleared && living.length > 0 && livingEnemies().length === 0) {
      progress.cleared = true;
      const reward = floorsRun ? clearReward(room) : ROOM_CLEAR_REWARD;
      for (const p of players.values()) p.state.resources += reward;
      events.push(emit({ type: 'room_cleared', worldId: world.worldId, roomIndex: room.index, roomId: room.id, playerIds: playerIds(), reward }));
      if (floorsRun && room.roomId !== undefined) {
        markCleared(floorsRun, room.roomId);
        rebuildGrid(); // the doors unseal
      }
    }
    if (floorsRun) updateFloorFeatures(living, busy, events);
    const anchor = progress.anchor;
    if (!anchor || anchor.state === 'planted' || !progress.cleared) return;
    if (anchor.ritual) {
      updateAnchorRitual(anchor, living, busy, events);
      return;
    }
    const planters = living.filter((p) => p.interacting && !p.damagedThisTick && !busy.has(p.state.id) &&
      distance(p.state, anchor) <= ANCHOR_RANGE && clearPath(grid, p.state, anchor));
    if (planters.length === 0) {
      anchor.state = 'dormant';
      anchor.progress = 0;
      return;
    }
    anchor.state = 'planting';
    anchor.progress = Math.min(1, anchor.progress + TICK_MS / ANCHOR_HOLD_MS);
    if (anchor.progress >= 1 - 1e-7) {
      anchor.progress = 1;
      anchor.state = 'planted';
      events.push(emit({ type: 'anchor_planted', worldId: world.worldId, roomIndex: room.index, playerIds: playerIds() }));
      finishRun('anchored', events);
    }
  }

  function updateAnchorRitual(anchor: AnchorState, living: PlayerRuntime[], busy: Set<string>, events: GameEvent[]): void {
    const ritual = anchor.ritual;
    if (!ritual || !world) return;
    if (ritual.stage === 'locked') {
      ritual.stage = 'relays';
      projectiles = [];
    }
    if (ritual.stage === 'discharging') {
      ritual.dischargeMs = Math.min(ANCHOR_DISCHARGE_MS, ritual.dischargeMs + TICK_MS);
      anchor.progress = 0.75 + 0.25 * ritual.dischargeMs / ANCHOR_DISCHARGE_MS;
      if (ritual.dischargeMs >= ANCHOR_DISCHARGE_MS - 1e-7) {
        ritual.stage = 'complete';
        anchor.state = 'planted';
        anchor.progress = 1;
        events.push(emit({ type: 'anchor_planted', worldId: world.worldId, roomIndex: room.index, playerIds: playerIds() }));
        finishRun('anchored', events);
      }
      return;
    }
    if (ritual.activeRelay > 0) {
      if (ritual.pulseWarningMs > 0) ritual.pulseWarningMs = decay(ritual.pulseWarningMs);
      else {
        const previousRadius = ritual.pulseRadius;
        ritual.pulseRadius += ANCHOR_PULSE_SPEED * TICK_MS / 1000;
        for (const p of living) {
          const d = distance(p.state, anchor);
          if (progress.pulseHitPlayers.has(p.state.id) || d < previousRadius - PLAYER_RADIUS - 5 ||
            d > ritual.pulseRadius + PLAYER_RADIUS + 5) continue;
          progress.pulseHitPlayers.add(p.state.id);
          damagePlayer(p, 'anchor-pulse', 12, false, events);
        }
        if (ritual.pulseRadius > Math.hypot(room.width, room.height) * TILE_SIZE) {
          ritual.pulseRadius = 0;
          ritual.pulseWarningMs = ANCHOR_PULSE_WARNING_MS;
          progress.pulseHitPlayers.clear();
        }
      }
    }
    const target = ritual.stage === 'core' ? anchor : ritual.relays[ritual.activeRelay];
    if (!target) return;
    const actor = living.find((p) => !busy.has(p.state.id) && p.state.hp > 0 && p.interactPressed && !p.damagedThisTick &&
      distance(p.state, target) <= RELAY_ACTIVATION_RANGE && clearPath(grid, p.state, target));
    if (!actor) return;
    anchor.state = 'planting';
    if (ritual.stage === 'core') {
      ritual.stage = 'discharging';
      ritual.pulseRadius = 0;
      ritual.pulseWarningMs = 0;
      return;
    }
    ritual.relays[ritual.activeRelay]!.activated = true;
    ritual.activeRelay++;
    anchor.progress = ritual.activeRelay / 4;
    if (ritual.activeRelay === ritual.relays.length) ritual.stage = 'core';
  }

  function updateExits(events: GameEvent[]): void {
    if (phase === 'debrief') return;
    const open = phase === 'headquarters' || phase === 'training' || progress.cleared;
    for (const p of orderedPlayers()) {
      const { col, row } = worldToTile(p.state.x, p.state.y);
      const exit = room.exits.find((e) => e.x === col && e.y === row);
      if (exit && open && p.state.hp > 0 && !p.onExit && floorsRun && phase === 'expedition' && exit.toRoomId !== undefined) {
        // Floors: the sim walks the graph itself. Same group rule as legacy exits: the first
        // operative through a door takes the whole crew along.
        const arrival = doorArrival(floorsRun, room, exit.toRoomId);
        if (!arrival) continue;
        events.push(emit({ type: 'exit_reached', playerId: p.state.id, roomIndex: room.index, toRoomIndex: exit.toRoomIndex, toRoomId: exit.toRoomId }));
        enterFloorRoom(arrival.room, arrival, events);
        return;
      }
      if (exit && open && p.state.hp > 0 && !p.onExit) {
        events.push(emit({ type: 'exit_reached', playerId: p.state.id, roomIndex: room.index, toRoomIndex: exit.toRoomIndex }));
      }
      p.onExit = Boolean(exit && open && p.state.hp > 0);
    }
  }

  const sim: Simulation = {
    addPlayer(identity) {
      if (players.has(identity.id)) return;
      const p = makePlayer(identity);
      players.set(identity.id, p);
      const spawn = findTile('P') ?? tileToWorld(1, 1);
      Object.assign(p.state, nearestOpenPosition(grid, {
        x: spawn.x + (players.size - 1) * TILE_SIZE * 0.7, y: spawn.y,
      }, PLAYER_RADIUS));
    },
    removePlayer(playerId) { players.delete(playerId); },
    hasPlayer(playerId) { return players.has(playerId); },
    updatePlayerIdentity(identity) {
      const p = players.get(identity.id);
      if (!p) return;
      p.state.displayName = identity.displayName;
      if (phase === 'headquarters') {
        p.state.classId = identity.classId;
        p.state.abilityEUnlocked = p.unlockedClasses.has(identity.classId);
        resetTransient(p);
      }
    },
    getPlayerIds: playerIds,
    setWorld(next) {
      if (phase !== 'headquarters' && world?.worldId !== next?.worldId) return;
      if (world?.worldId !== next?.worldId) {
        rooms.clear();
        discoveredLore = new Set();
      }
      world = next;
      // Outside a run the provider follows the latest copy of the world (briefs may arrive late).
      if (!floorsRun) roomProvider = next?.floors ? (options.roomProvider ?? createRoomProvider)(next) : null;
    },
    getWorld() { return world; },
    getRoom() { return room; },
    getPhase() { return phase; },
    enterRoom(roomIndex) {
      if (!world) throw new Error('enterRoom: no world prepared');
      const next = world.rooms[roomIndex];
      if (!next) throw new Error(`enterRoom: room ${roomIndex} is not committed yet`);
      if (phase === 'debrief' || phase === 'training') return [];
      if (roomProvider) {
        // Floors world: the portal leads to the opening biome's entrance; after that the sim
        // moves the crew through doors itself, so sessions have nothing to enter by index.
        if (phase !== 'headquarters' || roomIndex !== 0) return [];
        floorsRun = createFloorsRun(roomProvider, hostPlayerId);
        const events: GameEvent[] = [emit({ type: 'biome_entered', worldId: world.worldId, biomeId: floorsRun.biomeId,
          biomeName: roomProvider.brief(floorsRun.biomeId).name, tier: floorsRun.tier, chosenByPlayerId: null, playerIds: playerIds() })];
        enterFloorRoom(roomProvider.getRoom(roomProvider.entranceRef()), undefined, events);
        return events;
      }
      if (phase === 'expedition' && (
        room.index === roomIndex || !progress.cleared || livingEnemies().length > 0 ||
        !orderedPlayers().some((p) => p.state.hp > 0) ||
        !room.exits.some((exit) => exit.toRoomIndex === roomIndex) ||
        (room.isFinal && progress.anchor?.state !== 'planted')
      )) return [];
      loadRoom(next, 'expedition');
      return [emit({ type: 'room_entered', worldId: world.worldId, roomIndex: next.index,
        roomId: next.id, roomName: next.name, playerIds: playerIds() })];
    },
    returnToHeadquarters() {
      const events: GameEvent[] = [];
      finishRun('aborted', events);
      floorsRun = null;
      rooms.clear();
      discoveredLore = new Set();
      for (const p of players.values()) {
        p.state.hp = p.state.maxHp;
        p.state.ultCharge = 0;
      }
      loadRoom(hq, 'headquarters');
      return events;
    },
    enterTraining() {
      if (phase !== 'headquarters') return [];
      loadRoom(trainingRoom, 'training');
      for (const p of players.values()) p.state.ultCharge = ULT_CHARGE_MAX; // try the ultimate immediately
      return [emit({ type: 'room_entered', worldId: 'training', roomIndex: 0, roomId: trainingRoom.id, roomName: trainingRoom.name, playerIds: playerIds() })];
    },
    unlockAbility(playerId) {
      const p = players.get(playerId);
      if (!p || phase === 'debrief' || p.state.hp <= 0 || p.state.abilityEUnlocked || p.state.resources < ABILITY_UNLOCK_COST) return [];
      p.state.resources -= ABILITY_UNLOCK_COST;
      p.state.abilityEUnlocked = true;
      p.unlockedClasses.add(p.state.classId);
      return [emit({ type: 'ability_unlocked', playerId, abilityId: CLASS_ABILITIES[p.state.classId].e,
        cost: ABILITY_UNLOCK_COST, remainingResources: p.state.resources })];
    },
    setHostPlayerId(playerId) {
      hostPlayerId = playerId;
      if (floorsRun) floorsRun.hostPlayerId = playerId;
    },
    chooseBiome(playerId, biomeId) {
      const choice = floorsRun?.choice;
      if (!choice || phase !== 'expedition' || choice.chosenBiomeId || !players.has(playerId) || !choice.options.includes(biomeId)) return;
      choice.votes[playerId] = biomeId;
      if (playerId === (hostPlayerId ?? playerIds()[0])) choice.chosenBiomeId = biomeId;
    },
    applyIntent(intent) {
      const p = players.get(intent.playerId);
      if (!p || phase === 'debrief') return;
      const previous = p.intent;
      p.intent = { ...intent, attack: intent.attack || (previous?.attack ?? false),
        dash: intent.dash || (previous?.dash ?? false), ability: intent.ability ?? previous?.ability ?? null };
    },
    step() {
      tick++;
      eventCounter = 0;
      if (phase === 'debrief') return [];
      const events: GameEvent[] = [];
      enterChosenBiome(events);
      for (const p of orderedPlayers()) stepPlayer(p, events);
      if (phase === 'expedition') {
        for (const e of progress.enemies) stepEnemy(e, events);
        stepProjectiles(events);
        updateObjectives(events);
      } else if (phase === 'training') {
        for (const e of progress.enemies) stepEnemy(e, events);
        respawnTrainingTargets();
      }
      updateExits(events);
      return events;
    },
    getSnapshot() {
      return {
        tick, timeMs: tick * TICK_MS, phase,
        worldId: phase === 'headquarters' ? null : world?.worldId ?? null,
        roomIndex: phase === 'headquarters' ? null : room.index,
        roomId: room.id, players: orderedPlayers().map((p) => ({ ...p.state })),
        enemies: progress.enemies.map((e) => ({ ...e.state, telegraph: e.state.telegraph ? { ...e.state.telegraph } : null })),
        projectiles: projectiles.map((pr): ProjectileState => ({
          id: pr.id, ownerEnemyId: pr.ownerEnemyId, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, radius: pr.radius,
        })),
        loreNodes: progress.loreNodes.map((n) => ({ ...n.state })),
        discoveredLore: [...discoveredLore].sort((a, b) => a - b),
        anchor: progress.anchor ? { ...progress.anchor,
          ...(progress.anchor.ritual ? { ritual: { ...progress.anchor.ritual,
            relays: progress.anchor.ritual.relays.map((relay) => ({ ...relay })) } } : {}) } : null,
        roomCleared: phase !== 'headquarters' && progress.cleared,
        ...bossFieldFor(),
        terrain: { brokenWalls: [...progress.terrain.brokenWalls], wallDamage: { ...progress.terrain.wallDamage } },
        ...(floorsRun && phase !== 'headquarters' ? { floor: floorRunState(floorsRun, doorsLocked()) } : {}),
      };
    },
    getTick() { return tick; },
  };
  return sim;
}
