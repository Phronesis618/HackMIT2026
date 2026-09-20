import type {
  AnchorState, EnemyState, EnemyTelegraph, GameEvent, GameEventInput, GamePhase,
  GameSnapshot, PlayerIdentity, PlayerIntent, PlayerState, PreparedWorld, ProjectileState, RoomSpec,
} from '../shared/contracts';
import {
  ABILITY_UNLOCK_COST, ANCHOR_HOLD_MS, ANCHOR_RANGE, ATTACK_DURATION_MS,
  DASH_COOLDOWN_MS, DASH_DURATION_MS, DASH_INVULNERABLE_MS, DASH_SPEED,
  PLAYER_MAX_HP, PLAYER_RADIUS, REVIVE_DURATION_MS, REVIVE_HP, REVIVE_RANGE,
  ROOM_CLEAR_REWARD, TICK_MS, TILE_SIZE, tileToWorld, worldToTile,
} from '../shared/conventions';
import { CLASS_ABILITIES, ENEMY_INFO, type ClassId } from '../shared/registry';
import { buildSolidGrid, circleHitsSolid, moveCircle, type SolidGrid } from './collision';
import {
  CHANNEL_PATTERN, CLASS_COMBAT, ENEMY_COMBAT, ENEMY_PROJECTILE_PATTERN,
  GUARDIAN_RING_DAMAGE, GUARDIAN_RING_PATTERN, GUARDIAN_VOLLEY_DAMAGE, GUARDIAN_VOLLEY_PATTERN,
  LURKER_SPORE_DAMAGE, LURKER_SPORE_PATTERN, chaseWaypoint, clearPath, decay, distance, inArc,
  nearestOpenPosition, type Point, type ProjectilePattern,
} from './combat';
import { headquartersRoom } from './headquarters';

type LivePlayerState = PlayerState & Required<Pick<PlayerState,
  'resources' | 'abilityEUnlocked' | 'abilityQCooldownMs' | 'abilityECooldownMs' |
  'shieldMs' | 'shroudMs' | 'rallyMs' | 'reviveProgress'>>;

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
  damagedThisTick: boolean;
  history: Array<Point & { hp: number }>;
}

interface EnemyRuntime {
  state: EnemyState;
  cooldownMs: number;
  hitMs: number;
  attackCount: number;
  /** Channeler's rotating spiral: >0 while mid-channel, firing one bolt per `shotIntervalMs`. */
  channelMsRemaining: number;
  channelAngle: number;
  channelTimerMs: number;
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

interface RoomProgress {
  enemies: EnemyRuntime[];
  anchor: AnchorState | null;
  cleared: boolean;
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
  unlockAbility(playerId: string): GameEvent[];
  /** Buttons are pressed this tick; interact is held this tick. */
  applyIntent(intent: PlayerIntent): void;
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
  let room = hq;
  let grid: SolidGrid = buildSolidGrid(room);
  let phase: GamePhase = 'headquarters';
  let tick = 0;
  let eventCounter = 0;
  const players = new Map<string, PlayerRuntime>();
  const rooms = new Map<number, RoomProgress>();
  let progress: RoomProgress = { enemies: [], anchor: null, cleared: false };
  /** Ephemeral bullet-hell bolts; never persisted across room switches (combat gates exits). */
  let projectiles: ProjectileRuntime[] = [];
  let projectileCounter = 0;

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
      abilityQCooldownMs: 0, abilityECooldownMs: 0,
      shieldMs: 0, shroudMs: 0, rallyMs: 0, reviveProgress: 0,
    });
    p.intent = null;
    p.dashRemainingMs = 0;
    p.attackRemainingMs = 0;
    p.hitRemainingMs = 0;
    p.interacting = false;
    p.damagedThisTick = false;
    p.history = [];
    p.onExit = false;
  }

  function placePlayers(): void {
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

  function spawnEnemies(): EnemyRuntime[] {
    const enemies: EnemyRuntime[] = [];
    const encounters = [...room.encounters];
    if (room.isFinal && !encounters.some((e) => e.enemyId === 'guardian')) {
      const at = findTile('A') ?? findTile('P') ?? tileToWorld(1, 1);
      const tile = worldToTile(at.x, at.y);
      encounters.push({ id: 'anchor-guardian', enemyId: 'guardian', x: tile.col, y: tile.row, count: 1 });
    }
    for (const encounter of encounters) {
      const info = ENEMY_INFO[encounter.enemyId];
      for (let i = 0; i < encounter.count; i++) {
        const base = tileToWorld(encounter.x, encounter.y);
        const offset = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * (info.radius * 2 + 6);
        enemies.push({
          state: {
            id: `${encounter.id.slice(0, 61)}-${i}`, enemyId: encounter.enemyId,
            ...nearestOpenPosition(grid, { x: base.x + offset, y: base.y }, info.radius),
            facing: Math.PI, hp: info.maxHp, maxHp: info.maxHp, state: 'idle',
            telegraph: null, slowMs: 0, stunMs: 0, markMs: 0,
          },
          cooldownMs: 500, hitMs: 0, attackCount: 0,
          channelMsRemaining: 0, channelAngle: 0, channelTimerMs: 0,
        });
      }
    }
    return enemies;
  }

  function loadRoom(next: RoomSpec, nextPhase: GamePhase): void {
    room = next;
    phase = nextPhase;
    grid = buildSolidGrid(room);
    projectiles = [];
    const saved = nextPhase === 'expedition' ? rooms.get(next.index) : undefined;
    const anchorPoint = room.isFinal ? findTile('A') : null;
    progress = saved ?? {
      enemies: nextPhase === 'expedition' ? spawnEnemies() : [],
      anchor: anchorPoint ? { ...anchorPoint, state: 'dormant', progress: 0 } : null,
      cleared: false,
    };
    if (nextPhase === 'expedition') rooms.set(next.index, progress);
    placePlayers();
  }

  function makePlayer(identity: PlayerIdentity): PlayerRuntime {
    return {
      state: {
        ...identity, x: 0, y: 0, vx: 0, vy: 0, facing: 0,
        hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, state: 'idle',
        dashCooldownMs: 0, attackCooldownMs: 0, invulnerableMs: 0,
        resources: 0, abilityEUnlocked: false, abilityQCooldownMs: 0, abilityECooldownMs: 0,
        shieldMs: 0, shroudMs: 0, rallyMs: 0, reviveProgress: 0,
      },
      intent: null, unlockedClasses: new Set(), dashRemainingMs: 0,
      dashDirection: { x: 1, y: 0 }, attackRemainingMs: 0, hitRemainingMs: 0,
      onExit: false, interacting: false, damagedThisTick: false, history: [],
    };
  }

  function livingEnemies(): EnemyRuntime[] {
    return progress.enemies.filter((e) => e.state.hp > 0);
  }

  function damageEnemy(e: EnemyRuntime, p: PlayerRuntime, damage: number, events: GameEvent[]): void {
    const s = e.state;
    if (s.hp <= 0) return;
    const amount = Math.min(s.hp, Math.round(damage * ((s.markMs ?? 0) > 0 ? 1.3 : 1)));
    s.hp -= amount;
    e.hitMs = 130;
    s.state = s.hp === 0 ? 'dead' : s.telegraph ? 'attacking' : 'hit';
    events.push(emit({ type: 'enemy_damaged', enemyId: s.id, byPlayerId: p.state.id, amount, remainingHp: s.hp }));
    if (s.hp === 0) {
      s.telegraph = null;
      events.push(emit({ type: 'enemy_defeated', enemyId: s.id, byPlayerId: p.state.id }));
    }
  }

  function damagePlayer(p: PlayerRuntime, sourceEnemyId: string, damage: number, ranged: boolean, events: GameEvent[]): boolean {
    const s = p.state;
    if (s.hp <= 0 || s.invulnerableMs > 0 || (ranged && s.shieldMs > 0)) return false;
    const amount = Math.min(s.hp, s.shieldMs > 0 ? Math.ceil(damage * 0.2) : damage);
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
  }

  function useAbility(p: PlayerRuntime, slot: 'q' | 'e', intent: PlayerIntent, events: GameEvent[]): void {
    const s = p.state;
    if (slot === 'e' && !s.abilityEUnlocked) return;
    if ((slot === 'q' ? s.abilityQCooldownMs : s.abilityECooldownMs) > 0) return;
    const id = CLASS_ABILITIES[s.classId][slot];
    const spec = CLASS_COMBAT[s.classId];
    if (slot === 'q') s.abilityQCooldownMs = spec.qCooldown;
    else s.abilityECooldownMs = spec.eCooldown;
    const hits: string[] = [];
    events.push(emit({ type: 'ability_used', playerId: s.id, abilityId: id, x: s.x, y: s.y, facing: s.facing, hitEnemyIds: hits }));
    const strike = (e: EnemyRuntime, damage: number): void => {
      hits.push(e.state.id);
      damageEnemy(e, p, damage, events);
    };
    switch (id) {
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
    for (const key of ['dashCooldownMs', 'attackCooldownMs', 'invulnerableMs', 'abilityQCooldownMs', 'abilityECooldownMs', 'shieldMs', 'shroudMs', 'rallyMs'] as const) s[key] = decay(s[key]);
    p.hitRemainingMs = decay(p.hitRemainingMs);
    p.damagedThisTick = false;
    const intent = p.intent;
    p.intent = null;
    p.interacting = intent?.interact === true && s.hp > 0;
    if (s.hp <= 0) {
      s.state = 'down';
      s.vx = s.vy = 0;
      return;
    }
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
      events.push(emit({ type: 'player_dashed', playerId: s.id, x: s.x, y: s.y, facing: s.facing }));
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
        (s.shroudMs > 0 ? 1.4 : 1) * (s.rallyMs > 0 ? 1.2 : 1);
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

  /** Picks the telegraph shape for an enemy's next attack. Guardian cycles four phases. */
  function attackKindFor(s: EnemyState, e: EnemyRuntime): { kind: EnemyTelegraph['kind']; range: number; arc: number } {
    const spec = ENEMY_COMBAT[s.enemyId];
    if (s.enemyId === 'guardian') {
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
        firePattern(s.id, telegraph.x, telegraph.y, telegraph.facing, isVolleyPhase ? 'volley' : 'ring',
          isVolleyPhase ? GUARDIAN_VOLLEY_PATTERN : GUARDIAN_RING_PATTERN,
          isVolleyPhase ? GUARDIAN_VOLLEY_DAMAGE : GUARDIAN_RING_DAMAGE);
      } else {
        const pattern = ENEMY_PROJECTILE_PATTERN[s.enemyId];
        if (pattern) firePattern(s.id, telegraph.x, telegraph.y, telegraph.facing, telegraph.kind, pattern, spec.damage);
      }
    }
    s.telegraph = null;
    e.cooldownMs = spec.cooldown;
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
    if (!target) {
      s.state = 'idle';
      return;
    }
    s.facing = Math.atan2(target.state.y - s.y, target.state.x - s.x);
    const { kind, range, arc } = attackKindFor(s, e);
    if (e.cooldownMs === 0 && distance(s, target.state) <= range && clearPath(grid, s, target.state)) {
      s.telegraph = { kind, x: s.x, y: s.y, facing: s.facing, range, arcRad: arc, remainingMs: spec.windup };
      s.state = 'attacking';
      events.push(emit({ type: 'enemy_telegraphed', enemyId: s.id, telegraph: { ...s.telegraph } }));
      return;
    }
    const ranged = kind !== 'melee' && kind !== 'charge';
    const stopRange = s.enemyId === 'guardian' ? 85 : ranged ? range * 0.7 : 34;
    if (distance(s, target.state) > stopRange || !clearPath(grid, s, target.state)) {
      const waypoint = chaseWaypoint(grid, s, target.state, ENEMY_INFO[s.enemyId].radius);
      const d = distance(s, waypoint);
      const step = Math.min(d, spec.speed * (s.slowMs > 0 ? 0.35 : 1) * TICK_MS / 1000);
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
    if (!progress.cleared && living.length > 0 && livingEnemies().length === 0) {
      progress.cleared = true;
      for (const p of players.values()) p.state.resources += ROOM_CLEAR_REWARD;
      events.push(emit({ type: 'room_cleared', worldId: world.worldId, roomIndex: room.index, roomId: room.id, playerIds: playerIds(), reward: ROOM_CLEAR_REWARD }));
    }
    const anchor = progress.anchor;
    if (!anchor || anchor.state === 'planted' || !progress.cleared) return;
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

  function updateExits(events: GameEvent[]): void {
    if (phase === 'debrief') return;
    const open = phase === 'headquarters' || progress.cleared;
    for (const p of orderedPlayers()) {
      const { col, row } = worldToTile(p.state.x, p.state.y);
      const exit = room.exits.find((e) => e.x === col && e.y === row);
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
      if (world?.worldId !== next?.worldId) rooms.clear();
      world = next;
    },
    getWorld() { return world; },
    getRoom() { return room; },
    getPhase() { return phase; },
    enterRoom(roomIndex) {
      if (!world) throw new Error('enterRoom: no world prepared');
      const next = world.rooms[roomIndex];
      if (!next) throw new Error(`enterRoom: room ${roomIndex} is not committed yet`);
      if (phase === 'debrief') return [];
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
      rooms.clear();
      for (const p of players.values()) p.state.hp = p.state.maxHp;
      loadRoom(hq, 'headquarters');
      return events;
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
      for (const p of orderedPlayers()) stepPlayer(p, events);
      if (phase === 'expedition') {
        for (const e of progress.enemies) stepEnemy(e, events);
        stepProjectiles(events);
        updateObjectives(events);
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
        anchor: progress.anchor ? { ...progress.anchor } : null,
        roomCleared: phase !== 'headquarters' && progress.cleared,
      };
    },
    getTick() { return tick; },
  };
  return sim;
}
