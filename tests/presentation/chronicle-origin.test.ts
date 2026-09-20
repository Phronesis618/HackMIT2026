import { describe, expect, it } from 'vitest';
import { GameEventSchema, type GameEvent } from '../../src/shared/contracts';
import { createBrowserChronicle, type KeyValueStorage } from '../../src/client/chronicle';
import { createChronicleState, reduceChronicle, type ChronicleContext } from '../../src/chronicle';

const players = [{ id: 'reviewer', displayName: 'Reviewer' }];
const ctx: ChronicleContext = {
  now: 1234,
  players,
  world: { worldId: 'world-b', title: 'World B', provenanceSource: 'live', receipt: null },
};

function events(raw: unknown[]): GameEvent[] {
  return raw.map((event) => GameEventSchema.parse(event));
}

const preparation = (worldId: string, worldTitle: string, source: 'fixture' | 'live') => events([
  { id: 'meta:1', type: 'world_prepared', tick: 0, timeMs: 0, worldId, worldTitle, source, playerIds: ['reviewer'] },
  { id: '1:0', type: 'room_entered', tick: 1, timeMs: 1, worldId, roomIndex: 0, roomId: 'entrance', roomName: 'Entrance', playerIds: ['reviewer'] },
]);
const worldA = preparation('world-a', 'World A', 'fixture');
const worldB = preparation('world-b', 'World B', 'live');
const combatAndLore = events([
  { id: '2:0', type: 'enemy_defeated', tick: 2, timeMs: 2, enemyId: 'husk', byPlayerId: 'reviewer', worldId: 'world-a' },
  { id: '2:1', type: 'lore_discovered', tick: 2, timeMs: 2, playerId: 'reviewer', worldId: 'world-a',
    fragmentIndex: 0, kind: 'remains', title: 'Recovered shard', source: 'A broken husk', text: 'Its orders remain.', x: 0, y: 0 },
]);

function storage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('Chronicle origin worlds', () => {
  it.each([false, true])('attributes missed A combat and lore with current world B, metadata reload: %s', (reload) => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => ctx.now);
    if (reload) {
      chronicle.ingest([...worldA, ...worldB], ctx);
      chronicle = createBrowserChronicle(disk, () => ctx.now);
      chronicle.ingest(combatAndLore, ctx);
    } else {
      chronicle.ingest([...worldA, ...worldB, ...combatAndLore], ctx);
    }
    const recorded = chronicle.getMemories();
    const missed = recorded.filter((m) => m.kind === 'milestone' || m.kind === 'lore');
    expect(missed).toHaveLength(2);
    expect(missed.every((m) => m.worldId === 'world-a' && m.worldTitle === 'World A' && m.provenanceSource === 'fixture')).toBe(true);
    expect(missed[0]!.title).toBe('First victory — World A');
    expect(missed[0]!.summary).toBe('Reviewer defeated the first hostile recorded in World A.');
    expect(missed[1]!.title).toBe('Recovered shard');
    expect(recorded.some((m) => m.worldId === 'world-b' && m.kind === 'milestone')).toBe(false);
    const reloaded = createBrowserChronicle(disk);
    expect(reloaded.ingest([...worldA, ...worldB, ...combatAndLore], ctx)).toEqual([]);
    expect(reloaded.getMemories()).toEqual(recorded);
    const otherLore = combatAndLore.filter((e) => e.type === 'lore_discovered').map((e) => ({ ...e, worldId: 'world-b' }));
    const [inB] = reloaded.ingest(otherLore, ctx);
    expect(inB).toMatchObject({ worldId: 'world-b', worldTitle: 'World B', provenanceSource: 'live', sourceEventIds: ['2:1'] });
    expect(new Set(reloaded.getMemories().map((m) => m.id)).size).toBe(reloaded.getMemories().length);
  });

  it('never creates expedition records for explicit null or unknown origins', () => {
    const state = reduceChronicle(createChronicleState(), [...worldA, ...worldB], ctx).state;
    for (const worldId of [null, 'missing-world']) {
      expect(reduceChronicle(state, events(combatAndLore.map((e) => ({ ...e, worldId }))), ctx).created).toEqual([]);
    }
  });

  it.each(['omitted', 'undefined'])('resolves legacy %s origins from an unambiguous batch instead of a different current world', (mode) => {
    const legacy = combatAndLore.map((event) => {
      if (!('worldId' in event)) throw new Error('Expected an origin-bearing event');
      const { worldId: _worldId, ...rest } = event;
      return GameEventSchema.parse(mode === 'omitted' ? rest : { ...rest, worldId: undefined });
    });
    const { created } = reduceChronicle(createChronicleState(), [...worldA, ...legacy], ctx);
    expect(created.map((m) => m.kind)).toEqual(['creation_receipt', 'arrival_keepsake', 'milestone', 'lore']);
    expect(created.every((m) => m.worldId === 'world-a' && m.provenanceSource === 'fixture')).toBe(true);
  });

  it('does not guess origins for legacy events in mixed-world replay or ambiguous stored history', () => {
    const legacy = combatAndLore.map((event) => {
      if (!('worldId' in event)) throw new Error('Expected an origin-bearing event');
      const { worldId: _worldId, ...rest } = event;
      return GameEventSchema.parse(rest);
    });
    const first = reduceChronicle(createChronicleState(), [...worldA, ...worldB, ...legacy], ctx);
    expect(first.created.map((m) => m.kind)).toEqual(['creation_receipt', 'arrival_keepsake', 'creation_receipt', 'arrival_keepsake']);
    expect(reduceChronicle(createChronicleState(first.state.memories), legacy, ctx).created).toEqual([]);
  });
});
