import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { tileToWorld } from '../../src/shared/conventions';
import { createSimulation, type Simulation } from '../../src/sim';
import { collectTerrainTiles, terrainCaption } from '../../src/client/render/terrain';
import { TERRAIN_CAPTION } from '../../src/shared/registry';
import { RoomTerrainSchema, TerrainSkinSchema, WorldRecipeSchema } from '../../src/shared/contracts';
import { DEFAULT_TERRAIN_INTENSITY, terrainTuning } from '../../src/shared/terrain';

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

describe('the world names its terrain, the engine owns it', () => {
  it('lets a world rename a feature and falls back to the built-in caption', () => {
    const room = arena('B');
    const tiles = collectTerrainTiles(room);
    const at = tileToWorld(5, 4);
    expect(terrainCaption(room, tiles, undefined, at)).toBe(TERRAIN_CAPTION.breakable_walls);
    expect(terrainCaption(room, tiles, undefined, at, [
      { featureId: 'breakable_walls', name: 'ledger stacks', caption: 'LEDGER STACK · shove it over' },
    ])).toBe('LEDGER STACK · shove it over');
    // A skin for a feature this tile is not gets ignored, not applied.
    expect(terrainCaption(room, tiles, undefined, at, [
      { featureId: 'vents', name: 'tide gauges', caption: 'TIDE GAUGE · mind the steam' },
    ])).toBe(TERRAIN_CAPTION.breakable_walls);
  });

  it('bounds what a world may say and which mechanics it may name', () => {
    expect(TerrainSkinSchema.safeParse({ featureId: 'pits', name: 'the sump', caption: 'THE SUMP · it is a long way down' }).success).toBe(true);
    for (const bad of [
      { featureId: 'trapdoors', name: 'x', caption: 'y' },
      { featureId: 'pits', name: '', caption: 'y' },
      { featureId: 'pits', name: 'x'.repeat(29), caption: 'y' },
      { featureId: 'pits', name: 'x', caption: 'y'.repeat(61) },
    ]) expect(TerrainSkinSchema.safeParse(bad).success).toBe(false);
    const recipe = WorldRecipeSchema.parse({ ...WorldFixtureSchema.parse(fixtureJson).recipe, terrainSkins: [] });
    expect(recipe.terrainSkins).toEqual([]);
  });

  it('clamps the model\'s intensity into a band it cannot leave, and defaults to the baseline', () => {
    expect(RoomTerrainSchema.parse({ features: [], layout: 'arena', density: 'sparse' }).intensity).toBeUndefined();
    expect(RoomTerrainSchema.safeParse({ features: [], layout: 'arena', density: 'sparse', intensity: 1.5 }).success).toBe(false);
    expect(RoomTerrainSchema.safeParse({ features: [], layout: 'gauntlet', density: 'sparse', intensity: -0.1 }).success).toBe(false);
    // Every tuned number stays inside its endpoints for every legal intensity.
    for (let i = 0; i <= 1.0001; i += 0.05) {
      const tuning = terrainTuning(i);
      expect(tuning.hazardIntervalMs).toBeGreaterThanOrEqual(350);
      expect(tuning.hazardIntervalMs).toBeLessThanOrEqual(600);
      expect(tuning.hazardBase).toBeGreaterThanOrEqual(2);
      expect(tuning.hazardBase).toBeLessThanOrEqual(4);
      expect(tuning.ventDamage).toBeGreaterThanOrEqual(10);
      expect(tuning.ventDamage).toBeLessThanOrEqual(18);
      expect(tuning.coverHp).toBeGreaterThanOrEqual(18);
      expect(tuning.coverHp).toBeLessThanOrEqual(34);
      expect(tuning.canisterFuseMs).toBeGreaterThanOrEqual(300);
      expect(tuning.canisterFuseMs).toBeLessThanOrEqual(600);
    }
    expect(terrainTuning()).toEqual(terrainTuning(DEFAULT_TERRAIN_INTENSITY));
  });
});
