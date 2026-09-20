import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { tileToWorld } from '../../src/shared/conventions';
import { createSimulation, type Simulation } from '../../src/sim';

function arena(tile: string, index = 0): RoomSpec {
  const tiles: string[][] = Array.from({ length: 10 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => x === 0 || x === 15 || y === 0 || y === 9 ? '#' : '.'));
  tiles[4]![4] = 'P';
  tiles[4]![5] = tile;
  tiles[4]![14] = 'X';
  return RoomSpecSchema.parse({
    id: `terrain-arena-${index}`, index, name: 'Terrain arena', description: '', width: 16, height: 10,
    tiles: tiles.map((row) => row.join('')), props: [], encounters: [], attributions: [],
    exits: [{ x: 14, y: 4, toRoomIndex: index === 0 ? 1 : 0, direction: 'east' }], isFinal: false,
  });
}

function tick(sim: Simulation, input: Partial<PlayerIntent> = {}) {
  const player = sim.getSnapshot().players[0]!;
  sim.applyIntent({
    playerId: player.id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
    attack: false, dash: false, ability: null, ...input,
  });
  return sim.step();
}

function setup(tile = 'B') {
  const sim = createSimulation({ headquarters: arena(tile) });
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
  return sim;
}

describe('terrain in the authoritative simulation', () => {
  it('breaks a barrier only on accepted attacks and exposes isolated snapshot state', () => {
    const sim = setup();
    tick(sim, { attack: true });
    expect(sim.getSnapshot().terrain).toEqual({ brokenWalls: [], wallDamage: { '5,4': 20 } });
    for (let i = 0; i < 5; i++) tick(sim, { attack: true });
    expect(sim.getSnapshot().terrain!.brokenWalls).toEqual([]);
    for (let i = 0; i < 30; i++) tick(sim);
    tick(sim, { attack: true });
    expect(sim.getSnapshot().terrain!.brokenWalls).toEqual(['5,4']);
    const copy = sim.getSnapshot();
    copy.terrain!.brokenWalls.length = 0;
    copy.terrain!.wallDamage['5,4'] = 1000;
    expect(sim.getSnapshot().terrain!.brokenWalls).toEqual(['5,4']);
    expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);
    for (let i = 0; i < 45; i++) tick(sim, { moveX: 1 });
    expect(sim.getSnapshot().players[0]!.x).toBeGreaterThan(tileToWorld(5, 4).x);
  });

  it('blocks movement before destruction and allows a raised crossing', () => {
    const blocked = setup();
    const crossing = setup('=');
    for (let i = 0; i < 30; i++) {
      tick(blocked, { moveX: 1 });
      tick(crossing, { moveX: 1 });
    }
    expect(blocked.getSnapshot().players[0]!.x).toBeLessThan(5 * 32);
    expect(crossing.getSnapshot().players[0]!.x).toBeGreaterThan(6 * 32);
  });

  it('applies rubble and conduit speed to walking while leaving dashes consistent', () => {
    function startOn(tile: string) {
      const base = arena(tile);
      const room = { ...base, tiles: base.tiles.map((row, y) => y === 4 ? row.slice(0, 5) + tile.repeat(8) + row.slice(13) : row) };
      const sim = createSimulation({ headquarters: room });
      sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
      while (sim.getSnapshot().players[0]!.x < 5 * 32) tick(sim, { moveX: 1 });
      return sim;
    }
    const normal = startOn('.');
    const rubble = startOn(':');
    const conduit = startOn('+');
    tick(normal, { moveX: 1 }); tick(rubble, { moveX: 1 }); tick(conduit, { moveX: 1 });
    expect(rubble.getSnapshot().players[0]!.vx).toBeCloseTo(normal.getSnapshot().players[0]!.vx * 0.65);
    expect(conduit.getSnapshot().players[0]!.vx).toBeCloseTo(normal.getSnapshot().players[0]!.vx * 1.25);
    tick(normal, { moveX: 1, dash: true }); tick(rubble, { moveX: 1, dash: true }); tick(conduit, { moveX: 1, dash: true });
    expect(rubble.getSnapshot().players[0]!.vx).toBe(normal.getSnapshot().players[0]!.vx);
    expect(conduit.getSnapshot().players[0]!.vx).toBe(normal.getSnapshot().players[0]!.vx);
  });

  it('persists destroyed barriers on revisits and restores them on a fresh run', () => {
    const sim = setup();
    const fixture = WorldFixtureSchema.parse(fixtureJson);
    sim.setWorld(PreparedWorldSchema.parse({
      worldId: 'terrain-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
      rooms: [arena('B'), arena('.', 1), fixture.rooms[2]], plannedRoomCount: 3,
      provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
      receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Terrain', lines: [] },
    }));
    sim.enterRoom(0);
    tick(sim, { attack: true });
    for (let i = 0; i < 30; i++) tick(sim);
    tick(sim, { attack: true });
    sim.enterRoom(1);
    tick(sim);
    sim.enterRoom(0);
    expect(sim.getSnapshot().terrain!.brokenWalls).toEqual(['5,4']);
    for (let i = 0; i < 45; i++) tick(sim, { moveX: 1 });
    expect(sim.getSnapshot().players[0]!.x).toBeGreaterThan(tileToWorld(5, 4).x);
    sim.returnToHeadquarters();
    sim.enterRoom(0);
    expect(sim.getSnapshot().terrain!.brokenWalls).toEqual([]);
  });
});
