import { describe, expect, it } from 'vitest';
import { GameEventSchema, type GameEvent } from '../../src/shared/contracts';
import { createBrowserChronicle, type BrowserIngestContext, type KeyValueStorage } from '../../src/client/chronicle';
import {
  HUB_STORAGE_KEY, createHubState, createHubStateBus, loadHubState, reduceHubState, saveHubState,
  type HubIngestContext,
} from '../../src/client/chronicle/hubState';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';

const identity = { id: 'memory-tester', displayName: 'Tester', classId: 'shade' as const };
const context: BrowserIngestContext = {
  players: [identity], localPlayerId: identity.id, classByPlayerId: { [identity.id]: identity.classId },
  world: { worldId: 'test-memory-world', title: 'Test World', provenanceSource: 'fixture', receipt: null },
};
const hubContext: HubIngestContext = {
  ...context, localPlayerId: identity.id, classByPlayerId: { [identity.id]: identity.classId }, now: 1000,
};

function storage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

function fixtureRun(outcome: 'anchored' | 'stranded' = 'anchored'): GameEvent[] {
  const worldId = context.world!.worldId;
  const playerIds = [identity.id];
  return [
    { type: 'world_prepared', worldId, worldTitle: 'Test World', source: 'fixture', playerIds },
    { type: 'biome_entered', worldId, biomeId: 'test-biome', biomeName: 'Test Biome', tier: 2, chosenByPlayerId: null, playerIds },
    { type: 'room_entered', worldId, roomIndex: 12, roomId: 'test-exit', roomName: 'Test Gate', kind: 'exit', playerIds },
    { type: 'enemy_damaged', enemyId: 'test-guardian', byPlayerId: identity.id, amount: 25, remainingHp: 0 },
    { type: 'enemy_defeated', worldId, enemyId: 'test-guardian', byPlayerId: identity.id },
    { type: 'room_cleared', worldId, roomIndex: 12, roomId: 'test-exit', reward: 3, playerIds },
    { type: 'lore_discovered', worldId, playerId: identity.id, fragmentIndex: 0, kind: 'relic',
      title: 'Test relic', source: 'Test pedestal', text: 'A scripted test keepsake.', x: 0, y: 0 },
    { type: 'anchor_planted', worldId, roomIndex: 12, playerIds },
    { type: 'run_ended', worldId, outcome, playerIds },
  ].map((event, index) => GameEventSchema.parse({ ...event, id: `test-memory:${index}`, tick: index, timeMs: index * 1000 }));
}

describe('hub progress survives an adapter reload', () => {
  it('keeps real LocalSession room entries when the authority continues without replaying the prefix', async () => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    const session = new LocalSession({ identity, worldProvider: fixtureWorldProvider });
    const emitted: GameEvent[] = [];
    session.onEvents((batch) => {
      emitted.push(...batch);
      const world = session.getWorld();
      chronicle.ingest(batch, {
        ...context,
        world: world ? {
          worldId: world.worldId, title: world.recipe.title, provenanceSource: world.provenance.source, receipt: world.receipt,
        } : null,
      });
    });
    try {
      const world = await session.requestWorld();
      session.enterPortal();
      const prefix = chronicle.getHubState().current;
      expect(prefix?.roomsEntered).toBe(1);
      chronicle = createBrowserChronicle(disk, () => 2000, createHubStateBus());
      expect(chronicle.getHubState().current).toEqual(prefix);
      session.returnToHeadquarters();
      const finished = chronicle.getHubState();
      expect(finished.lastRun).toMatchObject({ worldId: world.worldId, roomsEntered: 1, deepestRoomIndex: 0, outcome: 'aborted' });
      expect(finished.lastRun?.sourceEventIds.every((id) => emitted.some((event) => event.id === id))).toBe(true);
      expect(finished.totals.runs).toBe(1);
    } finally {
      session.dispose();
    }
  });

  it.each(['anchored', 'stranded'] as const)('retains floor progress and honest relic outcome through reload: %s', (outcome) => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    const events = fixtureRun(outcome);
    for (const event of events.slice(0, -1)) chronicle.ingest([event], context);
    const prefix = chronicle.getHubState();
    chronicle = createBrowserChronicle(disk, () => 2000, createHubStateBus());
    expect(chronicle.getHubState()).toEqual(prefix);
    chronicle.ingest(events.slice(-1), context);
    const state = chronicle.getHubState();
    expect(state.lastRun).toMatchObject({
      outcome, deepestTier: 2, biomesCleared: 1, enemiesDefeated: 1, damageDealt: 25, loreRead: 1,
    });
    expect(state.records.shade.anchors).toBe(1);
    expect(state.totals.anchors).toBe(1);
    expect(state.relics).toHaveLength(outcome === 'anchored' ? 1 : 0);
    expect(chronicle.ingest(events, context)).toEqual([]);
    expect(chronicle.getHubState()).toBe(state);
  });
});

describe('Chronicle floor continuity across adapter reloads', () => {
  it('retains event-derived deepest-floor details when only the ending arrives after reload', () => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    const events = fixtureRun();
    chronicle.ingest(events.slice(0, -1), context);
    chronicle = createBrowserChronicle(disk, () => 2000, createHubStateBus());
    const created = chronicle.ingest(events.slice(-1), context);
    expect(created.find((memory) => memory.kind === 'run_summary')?.summary)
      .toContain('Deepest point: Test Biome, tier 3 of 5, 1 room in.');
  });

  it('does not call a later cache the first cache after reload or count replayed rooms twice', () => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    const events = fixtureRun();
    const cache = GameEventSchema.parse({
      type: 'room_entered', id: 'test-cache:1', tick: 20, timeMs: 20000, worldId: context.world!.worldId,
      roomIndex: 13, roomId: 'test-cache', roomName: 'Test Cache', kind: 'treasure', playerIds: [identity.id],
    });
    chronicle.ingest([...events.slice(0, 3), cache], context);
    chronicle = createBrowserChronicle(disk, () => 2000, createHubStateBus());
    chronicle.ingest([events[2]!], context);
    chronicle.ingest([GameEventSchema.parse({
      ...cache, id: 'test-cache:2', tick: 21, timeMs: 21000, roomIndex: 14, roomId: 'test-cache-two', roomName: 'Second Test Cache',
    })], context);
    chronicle.ingest([{ ...events[events.length - 1]!, tick: 22, timeMs: 22000 }], context);
    const memories = chronicle.getMemories();
    expect(memories.filter((memory) => memory.title.startsWith('First cache:'))).toHaveLength(1);
    expect(memories.find((memory) => memory.kind === 'run_summary')?.summary)
      .toContain('Deepest point: Test Biome, tier 3 of 5, 3 rooms in.');
  });

  it('retains both worlds when a later fixture expedition recycles event IDs after reload', () => {
    const disk = storage();
    let chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    const events = fixtureRun();
    chronicle.ingest(events, context);
    chronicle = createBrowserChronicle(disk, () => 2000, createHubStateBus());
    const worldId = 'second-test-memory-world';
    const second = events.map((event) => 'worldId' in event ? { ...event, worldId } : event);
    const secondContext = { ...context, world: { ...context.world!, worldId } };
    chronicle.ingest(second, secondContext);
    const state = chronicle.getHubState();
    expect(state.totals).toMatchObject({ runs: 2, anchors: 2, relics: 2, worldsVisited: 2 });
    expect(state.lastRun).toMatchObject({ worldId, roomsEntered: 1, enemiesDefeated: 1 });
    const summaries = chronicle.getMemories().filter((memory) => memory.kind === 'run_summary');
    expect(summaries.map((memory) => memory.worldId)).toEqual([context.world!.worldId, worldId]);
    expect(summaries.every((memory) => memory.summary.includes('Deepest point: Test Biome'))).toBe(true);
    expect(chronicle.ingest(second, secondContext)).toEqual([]);
    expect(chronicle.getHubState()).toBe(state);
  });

  it.each([
    '{invalid json',
    JSON.stringify({ version: 1, seenEventIds: [], floors: { invalid: { biomes: null } } }),
    JSON.stringify({ version: 99, seenEventIds: [] }),
  ])('loads existing memories safely with malformed progress: %s', (corrupt) => {
    const disk = storage();
    const chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    chronicle.ingest(fixtureRun(), context);
    disk.setItem('relay.chronicle-progress.v1', corrupt);
    const reloaded = createBrowserChronicle(disk, () => 2000, createHubStateBus());
    expect(reloaded.getMemories()).toEqual(chronicle.getMemories());
    expect(reloaded.ingest(fixtureRun(), context)).toEqual([]);
  });

  it('erases saved floor progress when memories are cleared', () => {
    const disk = storage();
    const chronicle = createBrowserChronicle(disk, () => 1000, createHubStateBus());
    chronicle.ingest(fixtureRun().slice(0, -1), context);
    chronicle.clear();
    expect(disk.getItem('relay.chronicle-progress.v1')).toBeNull();
    const reloaded = createBrowserChronicle(disk, () => 2000, createHubStateBus());
    const created = reloaded.ingest(fixtureRun().slice(-1), context);
    expect(created.find((memory) => memory.kind === 'run_summary')?.summary).not.toContain('Deepest point');
    expect(reloaded.getMemories()).toHaveLength(1);
  });
});

describe('partial hub storage recovery', () => {
  it('retains replay protection for genuine completed runs when an unrelated class record is corrupt', () => {
    const disk = storage();
    const events = fixtureRun();
    const state = reduceHubState(createHubState(), events, hubContext);
    disk.setItem(HUB_STORAGE_KEY, JSON.stringify({
      ...state, records: { ...state.records, bastion: { runs: -1 } },
    }));
    const recovered = loadHubState(disk);
    expect(recovered.records.shade).toEqual(state.records.shade);
    expect(recovered.lastRun).toEqual(state.lastRun);
    expect(recovered.seenEventIds).toEqual(state.seenEventIds);
    expect(reduceHubState(recovered, events, hubContext)).toBe(recovered);
    expect(recovered.totals.runs).toBe(1);
  });

  it('retains a valid active run and its event IDs when an unrelated relic is corrupt', () => {
    const disk = storage();
    const events = fixtureRun();
    const state = reduceHubState(createHubState(), events.slice(0, -1), hubContext);
    disk.setItem(HUB_STORAGE_KEY, JSON.stringify({ ...state, relics: [{ id: 'invalid-relic' }] }));
    const recovered = loadHubState(disk);
    expect(recovered.current).toEqual(state.current);
    expect(recovered.seenEventIds).toEqual(state.seenEventIds);
    const finished = reduceHubState(recovered, events, hubContext);
    expect(finished.lastRun).toMatchObject({ roomsEntered: 1, damageDealt: 25, enemiesDefeated: 1 });
    expect(finished.totals.runs).toBe(1);
  });

  it('drops only relic text on quota retry and retains counts and replay evidence', () => {
    const disk = storage();
    const limited: KeyValueStorage = {
      ...disk,
      setItem(key, value) {
        if (value.includes('A scripted test keepsake.')) throw new Error('Quota exceeded');
        disk.setItem(key, value);
      },
    };
    const events = fixtureRun();
    const state = reduceHubState(createHubState(), events, hubContext);
    saveHubState(limited, state);
    const recovered = loadHubState(limited);
    expect(recovered.relics[0]?.text).toBe('');
    expect(recovered.totals).toEqual(state.totals);
    expect(recovered.seenEventIds).toEqual(state.seenEventIds);
    expect(reduceHubState(recovered, events, hubContext)).toBe(recovered);
  });

  it('keeps real progress in memory when storage is completely unavailable', () => {
    const blocked: KeyValueStorage = {
      getItem() { throw new Error('Storage disabled'); },
      setItem() { throw new Error('Storage disabled'); },
      removeItem() { throw new Error('Storage disabled'); },
    };
    const chronicle = createBrowserChronicle(blocked, () => 1000, createHubStateBus());
    for (const event of fixtureRun()) chronicle.ingest([event], context);
    expect(chronicle.getHubState().totals).toMatchObject({ runs: 1, anchors: 1, relics: 1 });
    expect(chronicle.getMemories().some((memory) => memory.kind === 'run_summary')).toBe(true);
    chronicle.clear();
    expect(chronicle.getHubState()).toEqual(createHubState());
    expect(chronicle.getMemories()).toEqual([]);
  });
});
