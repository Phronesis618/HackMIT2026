/** Test helper (F3): the bundled fixture as a floors world + its runtime + fake run states. */
import { PreparedWorldSchema, WorldFixtureSchema, type PreparedWorld } from '../../src/shared/contracts';
import { createWorldFloorRuntime, upgradeToFloors } from '../../src/shared/floorgen';
import type { FloorRunState } from '../../src/shared/floors';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';

export function floorsWorld(seed = 'f3'): PreparedWorld {
  const fixture = WorldFixtureSchema.parse(fixtureJson);
  const legacy = PreparedWorldSchema.parse({
    worldId: `world-${seed}`, createdAt: 1, recipe: fixture.recipe, art: fixture.art, rooms: fixture.rooms, plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 1, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'test', lines: [] },
  });
  return upgradeToFloors(legacy, seed);
}

export function floorsFixture(seed = 'f3') {
  const world = floorsWorld(seed);
  const runtime = createWorldFloorRuntime(world);
  const entrance = runtime.getRoom(runtime.entranceRef());
  const biomeId = entrance.biomeId!;
  const runState = (visited: string[], overrides: Partial<FloorRunState> = {}): FloorRunState => ({
    biomeId, roomId: visited[visited.length - 1]!, tier: runtime.tier(biomeId), path: [biomeId],
    map: runtime.mapRooms(biomeId, visited), doorsLocked: false, biomeChoice: null, ...overrides,
  });
  return { world, runtime, entrance, biomeId, runState };
}
