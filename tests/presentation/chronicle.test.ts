/**
 * Presentation tests — Agent C extends this folder. The reducer is pure, so these run in
 * Node without a DOM. Browser adapters are tested with an in-memory storage stub.
 */
import { describe, expect, it } from 'vitest';
import { MemoryRecordSchema, type GameEvent } from '../../src/shared/contracts';
import { sampleEvents, SAMPLE_WORLD_ID, SAMPLE_WORLD_TITLE, samplePlayers } from '../../src/shared/samples';
import { createChronicleState, reduceChronicle, type ChronicleContext } from '../../src/chronicle';
import { createBrowserChronicle, loadMemories, MEMORIES_STORAGE_KEY, saveMemories, type KeyValueStorage } from '../../src/client/chronicle';

const ctx: ChronicleContext = {
  now: 1_758_300_100_000,
  players: samplePlayers.map((p) => ({ id: p.id, displayName: p.displayName })),
  world: {
    worldId: SAMPLE_WORLD_ID,
    title: SAMPLE_WORLD_TITLE,
    provenanceSource: 'fixture',
    receipt: {
      worldTitle: SAMPLE_WORLD_TITLE,
      source: 'fixture',
      headline: 'test',
      lines: [
        { contributionId: 'sample-contrib-1', playerId: 'sample-player-local', playerName: 'Test Operative', text: 'x', used: false, featureDescription: null },
      ],
    },
  },
};

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('reduceChronicle', () => {
  it('creates a creation receipt and an arrival keepsake from the sample events', () => {
    const { state, created } = reduceChronicle(createChronicleState(), sampleEvents, ctx);
    const kinds = created.map((m) => m.kind);
    expect(kinds).toEqual(['creation_receipt', 'arrival_keepsake']);
    for (const m of created) expect(MemoryRecordSchema.safeParse(m).success).toBe(true);
    expect(state.memories).toHaveLength(2);

    const arrival = created[1]!;
    expect(arrival.roomIndex).toBe(0);
    expect(arrival.participants.map((p) => p.displayName)).toEqual(['Test Operative', 'Test Ally']);
    expect(arrival.summary).toMatch(/together/);
    expect(arrival.sourceEventIds).toEqual(['1:0']);
    expect(arrival.provenanceSource).toBe('fixture');
  });

  it('is honest about fixture worlds in the receipt summary', () => {
    const { created } = reduceChronicle(createChronicleState(), sampleEvents, ctx);
    expect(created[0]!.summary).toMatch(/offline fixture/);
    expect(created[0]!.summary).toMatch(/did not shape/);
  });

  it('ignores duplicate event ids (network retries / replays)', () => {
    const first = reduceChronicle(createChronicleState(), sampleEvents, ctx);
    const second = reduceChronicle(first.state, sampleEvents, ctx);
    expect(second.created).toHaveLength(0);
    expect(second.state.memories).toHaveLength(2);
  });

  it('creates at most one keepsake per world even with distinct event ids', () => {
    const first = reduceChronicle(createChronicleState(), sampleEvents, ctx);
    const again: GameEvent = { ...sampleEvents[2]!, id: '999:0', tick: 999 } as GameEvent;
    const second = reduceChronicle(first.state, [again], ctx);
    expect(second.created).toHaveLength(0);
  });

  it('does not create memories from combat events alone', () => {
    const combatOnly = sampleEvents.filter((e) => !['world_prepared', 'room_entered'].includes(e.type));
    const { created } = reduceChronicle(createChronicleState(), combatOnly, ctx);
    expect(created).toHaveLength(0);
  });

  it('never invents participants: unknown ids become "Unknown operative"', () => {
    const event: GameEvent = { ...sampleEvents[2]!, playerIds: ['ghost-player'] } as GameEvent;
    const { created } = reduceChronicle(createChronicleState(), [event], { ...ctx, players: [] });
    expect(created[0]!.participants).toEqual([{ id: 'ghost-player', displayName: 'Unknown operative' }]);
  });

  it('records anchor and run summary memories', () => {
    const events: GameEvent[] = [
      { id: '5000:0', type: 'anchor_planted', tick: 5000, timeMs: 0, worldId: SAMPLE_WORLD_ID, roomIndex: 2, playerIds: ['sample-player-local'] },
      { id: '5100:0', type: 'run_ended', tick: 5100, timeMs: 0, worldId: SAMPLE_WORLD_ID, outcome: 'anchored', playerIds: ['sample-player-local'], shardsEarned: 90, roomsCleared: 3 },
    ];
    const { created } = reduceChronicle(createChronicleState(), events, ctx);
    expect(created.map((m) => m.kind)).toEqual(['anchor', 'run_summary']);
    expect(created[1]!.summary).toMatch(/anchored/);
  });
});

describe('browser chronicle adapter', () => {
  it('persists memories to storage and reloads them', () => {
    const storage = memoryStorage();
    const chronicle = createBrowserChronicle(storage, () => ctx.now);
    const created = chronicle.ingest(sampleEvents, { players: ctx.players, world: ctx.world });
    expect(created).toHaveLength(2);
    expect(storage.data.has(MEMORIES_STORAGE_KEY)).toBe(true);

    const reloaded = createBrowserChronicle(storage, () => ctx.now);
    expect(reloaded.getMemories()).toHaveLength(2);
    // Reloading must not double-create when the same events are replayed.
    expect(reloaded.ingest(sampleEvents, { players: ctx.players, world: ctx.world })).toHaveLength(0);
  });

  it('attaches thumbnails only as data URLs', () => {
    const storage = memoryStorage();
    const chronicle = createBrowserChronicle(storage, () => ctx.now);
    const [receipt] = chronicle.ingest(sampleEvents, { players: ctx.players, world: ctx.world });
    chronicle.attachThumbnail(receipt!.id, 'https://example.com/not-allowed.png');
    expect(chronicle.getMemories()[0]!.thumbnailDataUrl).toBeUndefined();
    chronicle.attachThumbnail(receipt!.id, 'data:image/jpeg;base64,AAAA');
    expect(chronicle.getMemories()[0]!.thumbnailDataUrl).toBe('data:image/jpeg;base64,AAAA');
  });

  it('salvages valid entries when storage contains junk', () => {
    const storage = memoryStorage();
    const { state } = reduceChronicle(createChronicleState(), sampleEvents, ctx);
    saveMemories(storage, state.memories);
    const list = JSON.parse(storage.getItem(MEMORIES_STORAGE_KEY)!) as unknown[];
    list.push({ id: 'broken', kind: 'nope' });
    storage.setItem(MEMORIES_STORAGE_KEY, JSON.stringify(list));
    expect(loadMemories(storage)).toHaveLength(2);
    storage.setItem(MEMORIES_STORAGE_KEY, '{not json');
    expect(loadMemories(storage)).toEqual([]);
  });

  it('clear() empties storage and notifies subscribers', () => {
    const storage = memoryStorage();
    const chronicle = createBrowserChronicle(storage, () => ctx.now);
    chronicle.ingest(sampleEvents, { players: ctx.players, world: ctx.world });
    let seen: number | null = null;
    chronicle.subscribe((m) => (seen = m.length));
    chronicle.clear();
    expect(seen).toBe(0);
    expect(storage.data.has(MEMORIES_STORAGE_KEY)).toBe(false);
  });
});
