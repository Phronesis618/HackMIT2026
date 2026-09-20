/**
 * Test bot for floors runs: walks the FloorPlan graph door by door and fights with real
 * intents only (move, aim, attack, abilities, interact). No sim internals are touched.
 */
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import { PreparedWorldSchema, WorldFixtureSchema, type GameEvent, type GameSnapshot, type PlayerIntent, type PreparedWorld, type RoomSpec } from '../../src/shared/contracts';
import { PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../src/shared/conventions';
import { DOOR_SIDES, type BiomeBrief, type FloorPlan } from '../../src/shared/floors';
import { upgradeToFloors } from '../../src/shared/floorgen';
import { DANGEROUS_TILES, ENEMY_INFO, WALKABLE_TILES } from '../../src/shared/registry';
import { buildSolidGrid, createRoomProvider, type RoomProvider, type Simulation } from '../../src/sim';
import { chaseWaypoint, clearPath } from '../../src/sim/combat';

// These tests exercise the sim's own derivation (seeded patterns, default names, offline laws),
// so the fixture's authored laws / look / custodian are stripped here.
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };

const legacyWorld = (seed: string) => PreparedWorldSchema.parse({
  worldId: `floors-${seed}`, createdAt: 0, recipe: fixture.recipe, art: fixture.art,
  rooms: fixture.rooms, plannedRoomCount: 3,
  provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
  receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Test floors', lines: [] },
});

/** A seeded floors world on the fixture recipe. `tweak` may edit the briefs (e.g. ask for a rest room). */
export function floorsWorld(seed: string, tweak?: (briefs: BiomeBrief[]) => void): PreparedWorld {
  const world = upgradeToFloors(legacyWorld(seed), seed);
  if (!tweak) return world;
  const briefs = structuredClone(world.floors!.briefs);
  tweak(briefs);
  const floors = { ...world.floors!, briefs };
  const provider = createRoomProvider({ floors, recipe: world.recipe })!;
  return PreparedWorldSchema.parse({ ...world, floors, rooms: [provider.getRoom(provider.entranceRef())] });
}

/** Room ids from `from` to `to` along the plan (a tree, so the path is unique), excluding `from`. */
export function planPath(plan: FloorPlan, from: string, to: string): string[] {
  const parents = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const room = plan.rooms.find((candidate) => candidate.id === queue[i])!;
    for (const side of DOOR_SIDES) {
      const next = room.doors[side];
      if (next === undefined || parents.has(next)) continue;
      parents.set(next, room.id);
      queue.push(next);
    }
  }
  const path: string[] = [];
  for (let at: string | null = to; at !== null && at !== from; at = parents.get(at) ?? null) path.unshift(at);
  return path;
}

type Operative = GameSnapshot['players'][number];

/** One BFS waypoint toward `target` on the room's solid grid (`sealed`: treat doors as walls). */
export function steerIntent(room: RoomSpec, snapshot: GameSnapshot, player: { x: number; y: number }, target: { x: number; y: number }, sealed: boolean): { moveX: number; moveY: number } {
  const grid = buildSolidGrid(room, snapshot.terrain?.brokenWalls ?? [], sealed);
  const waypoint = chaseWaypoint(grid, player, target, PLAYER_RADIUS);
  const d = Math.hypot(waypoint.x - player.x, waypoint.y - player.y);
  return d < 1 ? { moveX: 0, moveY: 0 } : { moveX: (waypoint.x - player.x) / d, moveY: (waypoint.y - player.y) / d };
}

/** The nearest tile that is walkable and does not damage. Null when the bot is already safe. */
function stepOffHazard(room: RoomSpec, player: { x: number; y: number }): { x: number; y: number } | null {
  const col = Math.floor(player.x / TILE_SIZE);
  const row = Math.floor(player.y / TILE_SIZE);
  if (!DANGEROUS_TILES.has(room.tiles[row]?.[col] ?? '')) return null;
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  room.tiles.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      if (!WALKABLE_TILES.has(line[x]!) || DANGEROUS_TILES.has(line[x]!)) continue;
      const at = tileToWorld(x, y);
      const d = Math.hypot(at.x - player.x, at.y - player.y);
      if (d < bestDistance) { bestDistance = d; best = at; }
    }
  });
  return best;
}

/** Ranged kiting: close to sight range, back off when crowded, strafe otherwise; revive when it is quiet. */
export function fightIntent(room: RoomSpec, snapshot: GameSnapshot, player: Operative): Partial<PlayerIntent> {
  if (player.hp <= 0) return {};
  // Nobody stands in a fire they can walk out of. The bot is not smart about hazards, but it is
  // at least this smart, or terrain would decide every fight it is in (docs/design/TILES.md T0).
  const safety = stepOffHazard(room, player);
  if (safety) {
    const target = snapshot.enemies.find((enemy) => enemy.hp > 0);
    return { ...steerIntent(room, snapshot, player, safety, true), aimX: target?.x ?? player.x, aimY: target?.y ?? player.y };
  }
  const living = snapshot.enemies.filter((enemy) => enemy.hp > 0);
  const grid = buildSolidGrid(room, snapshot.terrain?.brokenWalls ?? [], true);
  const downed = snapshot.players.find((other) => other.hp <= 0);
  if (downed && living.every((enemy) => Math.hypot(enemy.x - player.x, enemy.y - player.y) > 160)) {
    const d = Math.hypot(downed.x - player.x, downed.y - player.y);
    return d > 30 ? steerIntent(room, snapshot, player, downed, true) : { interact: true };
  }
  const target = [...living].sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
  if (!target) return {};
  const d = Math.hypot(target.x - player.x, target.y - player.y) || 1;
  // Same rule the sim uses (TILES.md T4): '-' cover blocks the shot, but a strike inside one
  // tile reaches over it. Without this the bot walks up to a barricade and never swings.
  const sight = clearPath(grid, player, target) ||
    (d <= TILE_SIZE + ENEMY_INFO[target.enemyId].radius && clearPath(grid, player, target, 1, 'solid'));
  let move = { moveX: 0, moveY: 0 };
  if (!sight || d > 200) move = steerIntent(room, snapshot, player, target, true);
  else if (d < 130) move = { moveX: (player.x - target.x) / d, moveY: (player.y - target.y) / d };
  else move = { moveX: -(target.y - player.y) / d, moveY: (target.x - player.x) / d }; // strafe
  const hurt = player.hp < player.maxHp * 0.6;
  return {
    ...move, aimX: target.x, aimY: target.y, attack: sight,
    ability: hurt && player.abilityEUnlocked && (player.abilityECooldownMs ?? 0) === 0 ? 'e'
      : (player.ultCharge ?? 0) >= 100 && sight ? 'r' : (player.abilityQCooldownMs ?? 0) === 0 && sight ? 'q' : null,
  };
}

export class FloorsBot {
  readonly events: GameEvent[] = [];
  private seq = 0;

  constructor(readonly sim: Simulation, readonly provider: RoomProvider, readonly playerIds: string[]) {}

  snapshot(): GameSnapshot { return this.sim.getSnapshot(); }
  floor() {
    const floor = this.snapshot().floor;
    if (!floor) throw new Error('not a floors run');
    return floor;
  }
  room(): RoomSpec {
    const floor = this.floor();
    return this.provider.getRoom({ biomeId: floor.biomeId, roomId: floor.roomId });
  }
  plan(): FloorPlan { return this.provider.plan(this.floor().biomeId); }

  /** One tick; `decide` returns each operative's partial intent. */
  tick(decide: (player: GameSnapshot['players'][number], snapshot: GameSnapshot) => Partial<PlayerIntent> = () => ({})): GameEvent[] {
    const snapshot = this.snapshot();
    for (const player of snapshot.players) {
      if (!this.playerIds.includes(player.id)) continue;
      this.sim.applyIntent({
        playerId: player.id, seq: this.seq++, moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
        attack: false, dash: false, ability: null, interact: false, ...decide(player, snapshot),
      });
    }
    const events = this.sim.step();
    this.events.push(...events);
    return events;
  }

  private steer(player: { x: number; y: number }, target: { x: number; y: number }, sealed: boolean): { moveX: number; moveY: number } {
    return steerIntent(this.room(), this.snapshot(), player, target, sealed);
  }

  /** Fight until the room is clear. Throws if the crew wipes or the fight stalls. */
  fight(maxTicks = 6000): void {
    for (let i = 0; i < maxTicks; i++) {
      const snapshot = this.snapshot();
      if (snapshot.phase !== 'expedition') throw new Error(`fight ended in phase ${snapshot.phase}`);
      const living = snapshot.enemies.filter((enemy) => enemy.hp > 0);
      if (living.length === 0 && snapshot.roomCleared) return;
      const room = this.room();
      this.tick((player) => fightIntent(room, snapshot, player));
    }
    throw new Error(`fight in ${this.room().id} did not finish`);
  }

  /** Walk the lead operative to a point in the current room (the rest follow it). */
  walkTo(target: { x: number; y: number }, options: { interact?: boolean; until?: () => boolean; maxTicks?: number; reach?: number } = {}): boolean {
    const startRoom = this.snapshot().roomId;
    for (let i = 0; i < (options.maxTicks ?? 1500); i++) {
      const snapshot = this.snapshot();
      if (options.until?.() || snapshot.roomId !== startRoom || snapshot.phase !== 'expedition') return true;
      // The operative with the most Integrity left walks point. Picking the first living seat
      // instead made a long walk over damaging terrain turn on which seat happened to be hurt.
      const lead = [...snapshot.players].filter((player) => player.hp > 0).sort((a, b) => b.hp - a.hp)[0];
      if (!lead) throw new Error('crew is down');
      if (Math.hypot(target.x - lead.x, target.y - lead.y) <= (options.reach ?? 4)) return true;
      this.tick((player) => player.id === lead.id ? this.steer(player, target, false) : this.steer(player, lead, false));
    }
    return false;
  }

  /** Walk through the door to a neighbouring room. Returns false if the door would not let us through. */
  useDoor(toRoomId: string, maxTicks = 1500): boolean {
    const door = this.room().exits.find((exit) => exit.toRoomId === toRoomId);
    if (!door) throw new Error(`${this.room().id} has no door to ${toRoomId}`);
    this.walkTo(tileToWorld(door.x, door.y), { maxTicks, until: () => this.floor().roomId === toRoomId });
    return this.floor().roomId === toRoomId;
  }

  /** Travel along the plan to `roomId`, clearing every fight on the way. */
  travel(roomId: string, onArrive?: (roomId: string) => void): void {
    for (const next of planPath(this.plan(), this.floor().roomId, roomId)) {
      if (!this.useDoor(next)) throw new Error(`could not pass from ${this.floor().roomId} to ${next}`);
      onArrive?.(next);
      if (!this.snapshot().roomCleared) this.fight();
    }
  }

  /** Interact at the room's focus (rest / treasure / biome choice site). */
  useFocus(): void {
    const focus = this.room().focus!;
    this.walkTo(tileToWorld(focus.x, focus.y), { reach: 12 });
    this.tick(() => ({ interact: true }));
    this.tick();
  }
}

export function makeProvider(world: PreparedWorld): RoomProvider {
  const provider = createRoomProvider(world);
  if (!provider) throw new Error('world has no floors');
  return provider;
}
