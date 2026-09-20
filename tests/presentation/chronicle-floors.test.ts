import { describe, expect, it } from 'vitest';
import { lintProse } from '../../src/shared/prose';
import { MemoryRecordSchema, type GameEvent } from '../../src/shared/contracts';
import { createChronicleState, reduceChronicle, type ChronicleContext } from '../../src/chronicle';

const LOCAL = 'local';
const ALLY = 'ally';
const WORLD = 'floors-world';

const context: ChronicleContext = {
  now: 1_758_300_100_000,
  players: [{ id: LOCAL, displayName: 'Jon' }, { id: ALLY, displayName: 'Priya' }],
  world: {
    worldId: WORLD,
    title: 'Vantage Spire',
    provenanceSource: 'fixture',
    receipt: null,
    biomes: [
      { id: 'b1', name: 'Glass Warren' },
      { id: 'b2', name: 'Copper Wall' },
      { id: 'b3', name: 'Ash Crossing' },
      { id: 'b4', name: 'Quiet Vault' },
    ],
  },
};

let nextId = 0;
function event<T extends GameEvent['type']>(
  type: T,
  fields: Omit<Extract<GameEvent, { type: T }>, 'id' | 'tick' | 'timeMs' | 'type'>,
): GameEvent {
  nextId += 1;
  return { id: `floor-${nextId}`, tick: nextId, timeMs: nextId * 100, type, ...fields } as unknown as GameEvent;
}

function floorsRun(): GameEvent[] {
  return [
    event('world_prepared', { worldId: WORLD, worldTitle: 'Vantage Spire', source: 'fixture', playerIds: [LOCAL, ALLY] }),
    event('biome_entered', { worldId: WORLD, biomeId: 'b1', biomeName: 'Glass Warren', tier: 0, chosenByPlayerId: null, playerIds: [LOCAL, ALLY] }),
    event('room_entered', { worldId: WORLD, roomIndex: 0, roomId: 'b1:r00', roomName: 'Threshold', playerIds: [LOCAL, ALLY], biomeId: 'b1', floorRoomId: 'r00', kind: 'entrance' }),
    event('room_entered', { worldId: WORLD, roomIndex: 1, roomId: 'b1:r01', roomName: 'Sump Fight', playerIds: [LOCAL, ALLY], biomeId: 'b1', floorRoomId: 'r01', kind: 'combat' }),
    event('room_cleared', { worldId: WORLD, roomIndex: 1, roomId: 'b1:r01', playerIds: [LOCAL, ALLY], reward: 1 }),
    event('room_entered', { worldId: WORLD, roomIndex: 2, roomId: 'b1:r02', roomName: 'Lantern Nook', playerIds: [LOCAL, ALLY], biomeId: 'b1', floorRoomId: 'r02', kind: 'rest' }),
    event('room_entered', { worldId: WORLD, roomIndex: 3, roomId: 'b1:r03', roomName: 'Crown Ring', playerIds: [LOCAL, ALLY], biomeId: 'b1', floorRoomId: 'r03', kind: 'elite' }),
    event('room_cleared', { worldId: WORLD, roomIndex: 3, roomId: 'b1:r03', playerIds: [LOCAL, ALLY], reward: 2 }),
    event('room_entered', { worldId: WORLD, roomIndex: 4, roomId: 'b1:r04', roomName: 'Copper Cache', playerIds: [LOCAL, ALLY], biomeId: 'b1', floorRoomId: 'r04', kind: 'treasure' }),
    event('room_cleared', { worldId: WORLD, roomIndex: 4, roomId: 'b1:r04', playerIds: [LOCAL, ALLY], reward: 4 }),
    event('room_entered', { worldId: WORLD, roomIndex: 5, roomId: 'b1:r05', roomName: 'Gatehouse', playerIds: [LOCAL, ALLY], biomeId: 'b1', floorRoomId: 'r05', kind: 'exit' }),
    event('room_cleared', { worldId: WORLD, roomIndex: 5, roomId: 'b1:r05', playerIds: [LOCAL, ALLY], reward: 3 }),
    event('biome_choice_offered', { worldId: WORLD, fromBiomeId: 'b1', options: ['b2', 'b3'] }),
    event('biome_entered', { worldId: WORLD, biomeId: 'b2', biomeName: 'Copper Wall', tier: 1, chosenByPlayerId: LOCAL, playerIds: [LOCAL, ALLY] }),
    event('room_entered', { worldId: WORLD, roomIndex: 6, roomId: 'b2:r00', roomName: 'Second Threshold', playerIds: [LOCAL, ALLY], biomeId: 'b2', floorRoomId: 'r00', kind: 'entrance' }),
    event('room_entered', { worldId: WORLD, roomIndex: 7, roomId: 'b2:r01', roomName: 'Second Cache', playerIds: [LOCAL, ALLY], biomeId: 'b2', floorRoomId: 'r01', kind: 'treasure' }),
    event('room_entered', { worldId: WORLD, roomIndex: 8, roomId: 'b2:r02', roomName: 'Second Cache Again', playerIds: [LOCAL, ALLY], biomeId: 'b2', floorRoomId: 'r02', kind: 'treasure' }),
    event('biome_choice_offered', { worldId: WORLD, fromBiomeId: 'b2', options: ['b3', 'b4'] }),
    event('biome_entered', { worldId: WORLD, biomeId: 'b3', biomeName: 'Ash Crossing', tier: 2, chosenByPlayerId: null, playerIds: [LOCAL, ALLY] }),
    event('biome_choice_offered', { worldId: WORLD, fromBiomeId: 'b3', options: ['b4'] }),
    event('biome_entered', { worldId: WORLD, biomeId: 'b4', biomeName: 'Quiet Vault', tier: 3, chosenByPlayerId: null, playerIds: [LOCAL, ALLY] }),
    event('run_ended', { worldId: WORLD, outcome: 'collapsed', playerIds: [LOCAL, ALLY] }),
  ];
}

describe('floors Chronicle memories', () => {
  it('records real biome and first-room milestones, gatekeepers, and enriched depth', () => {
    nextId = 0;
    const events = floorsRun();
    const result = reduceChronicle(createChronicleState(), events, context);
    const floors = result.created.filter((memory) => memory.kind === 'milestone' && memory.sourceEventIds[0]?.startsWith('floor-'));

    expect(floors.filter((memory) => memory.title.startsWith('Entered '))).toHaveLength(4);
    expect(floors.find((memory) => memory.title === 'Entered Copper Wall')?.summary).toContain('Jon chose it over Ash Crossing.');
    expect(floors.find((memory) => memory.title === 'Entered Ash Crossing')?.summary).toContain('The crew took it over Quiet Vault.');
    expect(floors.find((memory) => memory.title === 'Entered Quiet Vault')?.summary).toContain('It was the only route on.');
    expect(floors.filter((memory) => memory.title.startsWith('First elite room'))).toHaveLength(1);
    expect(floors.filter((memory) => memory.title.startsWith('First cache'))).toHaveLength(1);
    expect(floors.filter((memory) => memory.title.startsWith('First rest site'))).toHaveLength(1);
    expect(floors.filter((memory) => memory.title.startsWith('Gatekeeper down'))).toHaveLength(1);
    expect(floors.some((memory) => memory.summary.includes('combat'))).toBe(false);
    expect(result.created.find((memory) => memory.kind === 'run_summary')?.summary).toContain('Deepest point: Quiet Vault, tier 4 of 5');
    for (const memory of result.created) expect(MemoryRecordSchema.safeParse(memory).success).toBe(true);
    for (const memory of floors) {
      const title = lintProse(memory.title, { kind: 'generic' });
      const summary = lintProse(memory.summary, { kind: 'debriefLine' });
      expect(!title.hardFail && title.score < 30, `${memory.title}: ${title.score}`).toBe(true);
      expect(!summary.hardFail && summary.score < 30, `${memory.summary}: ${summary.score}`).toBe(true);
    }
  });

  it('does not create memories when the event list is replayed', () => {
    nextId = 0;
    const events = floorsRun();
    const first = reduceChronicle(createChronicleState(), events, context);
    expect(reduceChronicle(first.state, events, context).created).toEqual([]);
  });

  it('stops floors memories at fourteen extras while still tracking the run', () => {
    nextId = 0;
    const events = [
      event('biome_entered', { worldId: WORLD, biomeId: 'b1', biomeName: 'Glass Warren', tier: 0, chosenByPlayerId: null, playerIds: [LOCAL] }),
      ...Array.from({ length: 20 }, (_, index) => [
        event('room_entered', { worldId: WORLD, roomIndex: index, roomId: `b1:r${index}`, roomName: `Gate ${index}`, playerIds: [LOCAL], biomeId: 'b1', floorRoomId: `r${index}`, kind: 'exit' }),
        event('room_cleared', { worldId: WORLD, roomIndex: index, roomId: `b1:r${index}`, playerIds: [LOCAL], reward: 1 }),
      ]).flat(),
      event('run_ended', { worldId: WORLD, outcome: 'collapsed', playerIds: [LOCAL] }),
    ];
    const result = reduceChronicle(createChronicleState(), events, context);
    expect(result.created.filter((memory) => memory.kind === 'milestone')).toHaveLength(14);
    expect(result.created.find((memory) => memory.kind === 'run_summary')?.summary).toContain('Deepest point: Glass Warren');
  });
});
