import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PreparedWorldSchema, WorldRecipeSchema,
  type GameEvent, type GenerationRequest, type PlayerIntent, type PreparedWorld, type RoomBlueprint, type RoomSpec,
} from '../../src/shared/contracts';
import { PLAYER_RADIUS, tileToWorld } from '../../src/shared/conventions';
import {
  ENEMY_INFO, MOTIF_IDS, PROP_IDS, TERRAIN_DENSITIES, TERRAIN_FEATURE_IDS, TERRAIN_LAYOUT_IDS,
} from '../../src/shared/registry';
import { buildSolidGrid, circleHitsSolid } from '../../src/sim/collision';
import { chaseWaypoint, clearPath, nearestOpenPosition } from '../../src/sim/combat';
import { createSimulation } from '../../src/sim';
import * as compiler from '../../src/server/generation/compiler';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';
import { createLiveGenerationService } from '../../src/server/generation/liveService';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const recipe = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
const propIds: RoomBlueprint['propIds'] = ['root_mass', 'monolith_shard', 'pillar', 'crate', 'terminal', 'crystal_cluster'];
const pocketRecipe = WorldRecipeSchema.parse({
  ...recipe,
  rooms: recipe.rooms.map((room) => ({
    ...room, motifIds: ['crystals'], propIds, enemyIds: ['husk', 'sentinel', 'lurker'],
    terrain: { features: [], layout: 'scattered', density: 'dense' },
  })),
});
const denseRecipe = WorldRecipeSchema.parse({
  ...recipe,
  rooms: recipe.rooms.map((room) => ({
    ...room, motifIds: ['ruined_machinery'], propIds, enemyIds: ['warden', 'sentinel', 'husk'],
    terrain: { features: ['breakable_walls', 'bridges', 'rubble', 'conduits'], layout: 'crossroads', density: 'dense' },
  })),
});
const request: GenerationRequest = {
  requestId: 'readiness', sessionId: 'readiness-session', contributions: [], plannedRoomCount: 3, seed: 135,
};

function accessibleTiles(room: RoomSpec): Set<string> {
  const grid = buildSolidGrid(room);
  const y = room.tiles.findIndex((line) => line.includes('P'));
  const start = { x: room.tiles[y]!.indexOf('P'), y };
  const queue = [start];
  const seen = new Set([`${start.x},${start.y}`]);
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = point.x + dx;
      const y = point.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || room.tiles[y]?.[x] === '~' ||
        !clearPath(grid, tileToWorld(point.x, point.y), tileToWorld(x, y), PLAYER_RADIUS)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}

function assertAccessibleEncounters(room: RoomSpec): void {
  const grid = buildSolidGrid(room);
  const reached = accessibleTiles(room);
  for (const encounter of room.encounters) {
    const center = tileToWorld(encounter.x, encounter.y);
    const radius = ENEMY_INFO[encounter.enemyId].radius;
    expect(circleHitsSolid(grid, center.x, center.y, radius), `${room.id}: ${encounter.id} clearance`).toBe(false);
    expect(nearestOpenPosition(grid, center, radius)).toEqual(center);
    expect(reached.has(`${encounter.x},${encounter.y}`), `${room.id}: ${encounter.id} access`).toBe(true);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('mandatory encounter readiness', () => {
  it('keeps the seed-331 sentinel out of a permanently isolated pocket', () => {
    const compiled = compiler.compileWorldRecipe(pocketRecipe, { seed: 331, plannedRoomCount: 3 });
    for (const room of compiled.rooms) assertAccessibleEncounters(room);
    expect(compiled.rooms[2]!.encounters.find((encounter) => encounter.id === 'room-2-encounter-1'))
      .not.toMatchObject({ x: 22, y: 10 });
  });

  it('fits the required Guardian alongside dense terrain and six props at seed 135', () => {
    const compiled = compiler.compileWorldRecipe(denseRecipe, { seed: 135, plannedRoomCount: 3 });
    for (const room of compiled.rooms) assertAccessibleEncounters(room);
    expect(compiled.rooms[2]!.encounters.map((encounter) => encounter.enemyId))
      .toEqual(['warden', 'sentinel', 'husk', 'guardian']);
    for (const committedRoomCount of [1, 2]) {
      const prefix = compiler.compileWorldRecipe(denseRecipe, { seed: 135, plannedRoomCount: 3, committedRoomCount });
      expect(JSON.stringify(prefix.rooms)).toBe(JSON.stringify(compiled.rooms.slice(0, committedRoomCount)));
    }
  });

  it('uses runtime radii across motifs, terrain layouts, densities and prop combinations', () => {
    for (const [motifIndex, motif] of MOTIF_IDS.entries()) {
      for (const [layoutIndex, layout] of TERRAIN_LAYOUT_IDS.entries()) {
        for (const [densityIndex, density] of TERRAIN_DENSITIES.entries()) {
          const seed = motifIndex * 31 + layoutIndex * 7 + densityIndex;
          const compiled = compiler.compileWorldRecipe({
            ...recipe,
            rooms: recipe.rooms.map((room) => ({
              ...room, motifIds: [motif], propIds: [...PROP_IDS.slice(seed % 4, seed % 4 + 6)],
              enemyIds: ['warden', 'sentinel', 'husk'], hazards: seed % 2 === 0,
              terrain: { features: [...TERRAIN_FEATURE_IDS], layout, density },
            })),
          }, { seed, plannedRoomCount: 3 });
          for (const room of compiled.rooms) assertAccessibleEncounters(room);
        }
      }
    }
  });

  it('lets a solo Bastion clear the seed-331 final room using ordinary attacks and a shield', async () => {
    const service = createLiveGenerationService({
      provider: { generate: async () => ({ recipe: pocketRecipe }) }, model: 'test', fixtures, log: () => {},
    });
    const world = await service.prepareWorld({ ...request, seed: 331 });
    expect(world.provenance.source).toBe('live');
    const sim = createSimulation();
    const playerId = 'solo-bastion';
    sim.addPlayer({ id: playerId, displayName: 'Bastion', classId: 'bastion' });
    sim.setWorld(world);
    sim.enterRoom(2);
    const grid = buildSolidGrid(sim.getRoom());
    const events: GameEvent[] = [];
    for (let tick = 0; tick < 6_000; tick++) {
      const snapshot = sim.getSnapshot();
      const player = snapshot.players[0]!;
      const enemy = snapshot.enemies.filter((value) => value.hp > 0)
        .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y))[0];
      if (!enemy || player.hp === 0) break;
      const waypoint = chaseWaypoint(grid, player, enemy, PLAYER_RADIUS);
      const distance = Math.hypot(waypoint.x - player.x, waypoint.y - player.y);
      const close = Math.hypot(enemy.x - player.x, enemy.y - player.y) <= 38 && clearPath(grid, player, enemy);
      const intent: PlayerIntent = {
        playerId, seq: tick,
        moveX: close || distance === 0 ? 0 : (waypoint.x - player.x) / distance,
        moveY: close || distance === 0 ? 0 : (waypoint.y - player.y) / distance,
        aimX: enemy.x, aimY: enemy.y, attack: true, dash: false,
        ability: player.abilityQCooldownMs === 0 ? 'q' : null,
      };
      sim.applyIntent(intent);
      events.push(...sim.step());
    }
    expect(sim.getSnapshot().players[0]!.hp).toBeGreaterThan(0);
    expect(sim.getSnapshot().enemies.every((enemy) => enemy.hp === 0)).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'room_cleared', roomIndex: 2 }));
    expect(sim.getSnapshot().anchor!.ritual!.stage).toBe('relays');
  });
});

describe('deterministic live preflight', () => {
  it('compiles the complete plan exactly once before yielding any room', async () => {
    const compile = vi.spyOn(compiler, 'compileWorldRecipe');
    const service = createLiveGenerationService({
      provider: { generate: async () => ({ recipe }) }, model: 'test', fixtures, log: () => {},
    });
    const stream = service.prepareWorldStream(request);
    const first = (await stream.next()).value as PreparedWorld;
    expect(first.provenance.source).toBe('live');
    expect(first.rooms).toHaveLength(1);
    expect(compile).toHaveBeenCalledExactlyOnceWith(expect.anything(), { plannedRoomCount: 3, seed: 135 });
    expect(compile.mock.results[0]!.value.rooms).toHaveLength(3);
    await stream.next();
    await stream.next();
    expect((await stream.next()).done).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('finishes seed 135 with immutable live prefixes or a complete labelled fallback', async () => {
    const generate = vi.fn(async () => ({ recipe: denseRecipe }));
    const service = createLiveGenerationService({ provider: { generate }, model: 'test', fixtures, log: () => {} });
    const worlds: PreparedWorld[] = [];
    const serialized: string[] = [];
    for await (const world of service.prepareWorldStream(request)) {
      PreparedWorldSchema.parse(world);
      worlds.push(world);
      serialized.push(JSON.stringify(world));
    }
    expect(generate).toHaveBeenCalledTimes(1);
    expect(worlds.at(-1)!.rooms).toHaveLength(3);
    expect(worlds.at(-1)!.rooms.at(-1)!.isFinal).toBe(true);
    expect(worlds.map((world) => JSON.stringify(world))).toEqual(serialized);
    if (worlds[0]!.provenance.source === 'live') {
      expect(worlds.map((world) => world.rooms.length)).toEqual([1, 2, 3]);
      for (const world of worlds) {
        expect(JSON.stringify(world.rooms)).toBe(JSON.stringify(worlds.at(-1)!.rooms.slice(0, world.rooms.length)));
      }
    } else {
      expect(worlds).toHaveLength(1);
      expect(worlds[0]!.provenance.source).toBe('live_fallback_fixture');
    }
  });

  it('falls back before publishing if the final deterministic room fails compilation', async () => {
    const original = compiler.compileWorldRecipe;
    const compile = vi.spyOn(compiler, 'compileWorldRecipe').mockImplementation((value, options) => {
      if ((options.committedRoomCount ?? options.plannedRoomCount) === 3) throw new Error('Final room rejected');
      return original(value, options);
    });
    const service = createLiveGenerationService({
      provider: { generate: async () => ({ recipe }) }, model: 'test', fixtures, log: () => {},
    });
    const worlds: PreparedWorld[] = [];
    for await (const world of service.prepareWorldStream(request)) worlds.push(world);
    // One compile of the recipe as written, one retreat to motif-default terrain (W2), then the fallback.
    expect(compile).toHaveBeenCalledTimes(2);
    expect(worlds).toHaveLength(1);
    expect(worlds[0]!.provenance.source).toBe('live_fallback_fixture');
    expect(worlds[0]!.rooms).toHaveLength(3);
  });

  it('validates the final world schema before publishing the first prefix', async () => {
    const parse = PreparedWorldSchema.parse.bind(PreparedWorldSchema);
    vi.spyOn(PreparedWorldSchema, 'parse').mockImplementation((value, ...options) => {
      if (typeof value === 'object' && value !== null && 'provenance' in value &&
        'rooms' in value && Array.isArray(value.rooms) && value.rooms.length === 3 &&
        typeof value.provenance === 'object' && value.provenance !== null &&
        'source' in value.provenance && value.provenance.source === 'live') {
        throw new Error('Final world schema rejected');
      }
      return parse(value, ...options);
    });
    const service = createLiveGenerationService({
      provider: { generate: async () => ({ recipe }) }, model: 'test', fixtures, log: () => {},
    });
    const worlds: PreparedWorld[] = [];
    for await (const world of service.prepareWorldStream(request)) worlds.push(world);
    expect(worlds).toHaveLength(1);
    expect(worlds[0]!.provenance.source).toBe('live_fallback_fixture');
    expect(worlds[0]!.rooms).toHaveLength(3);
  });
});
