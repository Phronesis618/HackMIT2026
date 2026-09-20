/**
 * Floors contracts (F1b): legacy 3-room validation is exactly as strict as before, a floors
 * world validates, and malformed floors worlds are rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  GameSnapshotSchema, GenerationRequestSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  FloorsWorldRecipeSchema, WorldRecipeSchema, type PreparedWorld,
} from '../../src/shared/contracts';
import { WorldFloorsSchema, floorRoomId, floorRoomIndex } from '../../src/shared/floors';
import { createWorldFloorRuntime, deriveBiomeBriefs, upgradeToFloors } from '../../src/shared/floorgen';
import { decodeClientMessage } from '../../src/shared/protocol';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';

const fixture = WorldFixtureSchema.parse(fixtureJson);
const legacy: PreparedWorld = PreparedWorldSchema.parse({
  worldId: 'world-contracts', createdAt: 1, recipe: fixture.recipe, art: fixture.art, rooms: fixture.rooms, plannedRoomCount: 3,
  provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 1, durationMs: 0, attempts: 0, notes: [] },
  receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'test', lines: [] },
});
const floorsWorld = upgradeToFloors(legacy, '42');
const clone = <T>(value: T): T => structuredClone(value);
const rejects = (world: unknown) => expect(PreparedWorldSchema.safeParse(world).success).toBe(false);

describe('legacy rooms stay as strict as before floors', () => {
  const room = fixture.rooms[0]!;
  it('rejects index and toRoomIndex above 2 on a room without a floors address', () => {
    expect(RoomSpecSchema.safeParse(room).success).toBe(true);
    expect(RoomSpecSchema.safeParse({ ...room, index: 3 }).success).toBe(false);
    expect(RoomSpecSchema.safeParse({ ...room, exits: room.exits.map((exit) => ({ ...exit, toRoomIndex: 3 })) }).success).toBe(false);
  });
  it('rejects floors-only fields on a legacy room', () => {
    expect(RoomSpecSchema.safeParse({ ...room, kind: 'combat' }).success).toBe(false);
    expect(RoomSpecSchema.safeParse({ ...room, roomId: 'r00' }).success).toBe(false);
    expect(RoomSpecSchema.safeParse({ ...room, exits: room.exits.map((exit) => ({ ...exit, toRoomId: 'r01' })) }).success).toBe(false);
  });
  it('rejects a floors room inside a world that has no floors', () => {
    rejects({ ...legacy, rooms: floorsWorld.rooms, plannedRoomCount: 1 });
  });
  it('keeps the model-facing recipe schema free of biomes', () => {
    expect(Object.keys(WorldRecipeSchema.shape)).not.toContain('biomes');
    expect(Object.keys(FloorsWorldRecipeSchema.shape)).toContain('biomes');
    expect(GenerationRequestSchema.parse({ requestId: 'r', sessionId: 's', contributions: [] }).floors).toBeUndefined();
  });
});

describe('floors world', () => {
  it('validates, carries exactly the entrance room and survives a JSON round trip', () => {
    const parsed = PreparedWorldSchema.parse(JSON.parse(JSON.stringify(floorsWorld)));
    expect(parsed).toEqual(floorsWorld);
    expect(parsed.plannedRoomCount).toBe(1);
    expect(parsed.rooms).toHaveLength(1);
    expect(parsed.rooms[0]).toMatchObject({ roomId: 'r00', kind: 'entrance', index: 0, isFinal: false, biomeId: parsed.floors!.route.tiers[0]![0] });
    expect(parsed.floors!.briefs).toHaveLength(8);
    expect(parsed.rooms[0]).toEqual(createWorldFloorRuntime(parsed).getRoom({ biomeId: parsed.rooms[0]!.biomeId!, roomId: 'r00' }));
  });

  it('accepts model-written biomes on the stored recipe, exactly 8 with distinct ids', () => {
    const biomes = deriveBiomeBriefs(fixture.recipe, 'x');
    expect(FloorsWorldRecipeSchema.safeParse({ ...fixture.recipe, biomes }).success).toBe(true);
    expect(FloorsWorldRecipeSchema.safeParse({ ...fixture.recipe, biomes: biomes.slice(0, 7) }).success).toBe(false);
    expect(FloorsWorldRecipeSchema.safeParse({ ...fixture.recipe, biomes: biomes.map((brief) => ({ ...brief, id: 'same' })) }).success).toBe(false);
  });

  it('rejects a wrong brief count, a broken route and a seed mismatch', () => {
    const floors = floorsWorld.floors!;
    expect(WorldFloorsSchema.safeParse(floors).success).toBe(true);
    rejects({ ...floorsWorld, floors: { ...floors, briefs: floors.briefs.slice(0, 7) } });
    rejects({ ...floorsWorld, floors: { ...floors, seed: 'other' } });
    rejects({ ...floorsWorld, floors: { ...floors, route: { ...floors.route, tiers: floors.route.tiers.slice(0, 4) } } });
    rejects({ ...floorsWorld, floors: { ...floors, route: { ...floors.route, graph: { ...floors.route.graph, edges: floors.route.graph.edges.slice(1) } } } });
    const renamed = clone(floors);
    renamed.briefs[3]!.id = 'not-routed';
    rejects({ ...floorsWorld, floors: renamed });
  });

  it('rejects a dangling or mismatched toRoomId', () => {
    const dangling = clone(floorsWorld);
    Object.assign(dangling.rooms[0]!.exits[0]!, { toRoomId: floorRoomId(40), toRoomIndex: 40 });
    rejects(dangling); // opening biome has 10 rooms
    const mismatched = clone(floorsWorld);
    mismatched.rooms[0]!.exits[0]!.toRoomIndex = 9;
    rejects(mismatched);
    const selfLoop = clone(floorsWorld);
    Object.assign(selfLoop.rooms[0]!.exits[0]!, { toRoomId: 'r00', toRoomIndex: 0 });
    rejects(selfLoop);
    const noEntry = clone(floorsWorld);
    delete noEntry.rooms[0]!.exits[0]!.entry;
    rejects(noEntry);
  });

  it('rejects an entrance that is not r00 of the opening biome, extra rooms and a legacy planned count', () => {
    const runtime = createWorldFloorRuntime(floorsWorld);
    const other = runtime.getRoom(runtime.neighbours(runtime.entranceRef())[0]!.ref);
    rejects({ ...floorsWorld, rooms: [other] });
    rejects({ ...floorsWorld, rooms: [floorsWorld.rooms[0], other] });
    rejects({ ...floorsWorld, plannedRoomCount: 3 });
    const secondBiome = floorsWorld.floors!.route.tiers[1]![0]!;
    rejects({ ...floorsWorld, rooms: [runtime.getRoom({ biomeId: secondBiome, roomId: 'r00' })] });
    rejects({ ...floorsWorld, rooms: fixture.rooms.slice(0, 1) });
  });

  it('maps room ids to plan indices', () => {
    expect(floorRoomIndex('r07')).toBe(7);
    expect(floorRoomId(29)).toBe('r29');
    expect(floorRoomIndex('r7')).toBeUndefined();
    expect(floorRoomIndex('r64')).toBeUndefined();
  });
});

describe('floors run state types for F2/F3', () => {
  const base = { tick: 0, timeMs: 0, phase: 'expedition', worldId: 'w', roomIndex: 0, roomId: 'b:r00', players: [], enemies: [], anchor: null };
  it('snapshot.floor is optional and validated', () => {
    expect(GameSnapshotSchema.safeParse(base).success).toBe(true);
    const runtime = createWorldFloorRuntime(floorsWorld);
    const biomeId = runtime.entranceRef().biomeId;
    const floor = {
      biomeId, roomId: 'r00', tier: 0, path: [biomeId], map: runtime.mapRooms(biomeId, ['r00'], ['r00']), doorsLocked: false,
      biomeChoice: { fromBiomeId: biomeId, options: runtime.nextBiomeChoices(biomeId), votes: { p1: runtime.nextBiomeChoices(biomeId)[0]! }, hostPlayerId: 'p1', chosenBiomeId: null },
    };
    expect(GameSnapshotSchema.safeParse({ ...base, floor }).success).toBe(true);
    expect(GameSnapshotSchema.safeParse({ ...base, floor: { ...floor, tier: 5 } }).success).toBe(false);
  });
  it('protocol accepts choose_biome', () => {
    expect(decodeClientMessage(JSON.stringify({ type: 'choose_biome', biomeId: 'biome-2' }))).toEqual({ type: 'choose_biome', biomeId: 'biome-2' });
    expect(decodeClientMessage(JSON.stringify({ type: 'choose_biome' }))).toBeNull();
  });
});
