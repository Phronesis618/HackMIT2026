import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserChronicle, type ChronicleWorldContext, type KeyValueStorage,
} from '../../src/client/chronicle';
import { GameEventSchema } from '../../src/shared/contracts';

const players = [{ id: 'reviewer', displayName: 'Reviewer' }];
const world: ChronicleWorldContext = {
  worldId: 'streamed-world', title: 'Streamed World', provenanceSource: 'live',
  receipt: {
    worldTitle: 'Streamed World', source: 'live', headline: 'One recorded idea',
    lines: [{
      contributionId: 'idea-1', playerId: 'reviewer', playerName: 'Reviewer',
      text: 'A last-room sanctuary', used: false, featureDescription: null,
    }],
  },
};
const prepared = GameEventSchema.parse({
  id: 'prepared:1', type: 'world_prepared', tick: 0, timeMs: 0,
  worldId: world.worldId, worldTitle: world.title, source: 'live', playerIds: ['reviewer'],
});

function finalWorld(): ChronicleWorldContext {
  const final = structuredClone(world);
  final.receipt!.lines[0]!.used = true;
  final.receipt!.lines[0]!.featureDescription = 'A sanctuary in the final room';
  return final;
}

function setup() {
  const data = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: vi.fn((key, value) => { data.set(key, value); }),
    removeItem: (key) => { data.delete(key); },
  };
  const chronicle = createBrowserChronicle(storage, () => 1234);
  const notify = vi.fn();
  chronicle.subscribe(notify);
  return { chronicle, storage, notify };
}

describe('Chronicle receipt refresh', () => {
  it('updates used counts without changing event lineage or provenance, persists and deduplicates after reload', () => {
    const { chronicle, storage, notify } = setup();
    chronicle.ingest([prepared], { players, world });
    const original = structuredClone(chronicle.getMemories()[0]!);
    expect(original.summary).toContain('1 idea; 0 shaped');
    const final = finalWorld();
    chronicle.refreshReceipt(final);
    const updated = chronicle.getMemories();
    expect(updated).toEqual([{ ...original, summary: 'Reviewer contributed 1 idea; 1 shaped observable features of this world.' }]);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);

    chronicle.refreshReceipt(final);
    chronicle.refreshReceipt(structuredClone(final));
    expect(chronicle.getMemories()).toBe(updated);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
    const reloaded = createBrowserChronicle(storage);
    expect(reloaded.getMemories()).toEqual(updated);
    expect(reloaded.ingest([prepared], { players: [{ ...players[0]!, displayName: 'Renamed' }], world: final })).toEqual([]);
    expect(reloaded.getMemories()).toEqual(updated);
  });

  it('requires an existing creation event and never resurrects a cleared memory', () => {
    const { chronicle, storage, notify } = setup();
    chronicle.refreshReceipt(finalWorld());
    expect(chronicle.getMemories()).toEqual([]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    chronicle.ingest([prepared], { players, world });
    chronicle.clear();
    chronicle.refreshReceipt(finalWorld());
    expect(chronicle.getMemories()).toEqual([]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(2);
    const reloaded = createBrowserChronicle(storage);
    reloaded.refreshReceipt(finalWorld());
    expect(reloaded.getMemories()).toEqual([]);
  });

  it.each([
    ['world id', (next: ChronicleWorldContext) => { next.worldId = 'different-world'; }],
    ['origin source', (next: ChronicleWorldContext) => { next.provenanceSource = 'fixture'; }],
    ['receipt source', (next: ChronicleWorldContext) => { next.receipt!.source = 'fixture'; }],
    ['world title', (next: ChronicleWorldContext) => { next.title = 'Different World'; }],
    ['receipt title', (next: ChronicleWorldContext) => { next.receipt!.worldTitle = 'Different World'; }],
    ['invalid receipt', (next: ChronicleWorldContext) => { next.receipt!.lines[0]!.playerName = 'x'.repeat(25); }],
    ['missing receipt', (next: ChronicleWorldContext) => { next.receipt = null; }],
  ])('ignores a mismatched or invalid %s without writes or notification', (_name, mutate) => {
    const { chronicle, storage, notify } = setup();
    chronicle.ingest([prepared], { players, world });
    const original = chronicle.getMemories();
    const next = finalWorld();
    mutate(next);
    chronicle.refreshReceipt(next);
    expect(chronicle.getMemories()).toBe(original);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  });

  it.each(['fixture', 'live_fallback_fixture'] as const)('retains honest %s attribution on refresh', (source) => {
    const { chronicle } = setup();
    const next = { ...world, provenanceSource: source, receipt: { ...world.receipt!, source, lines: [] } };
    chronicle.ingest([GameEventSchema.parse({ ...prepared, source })], { players, world: next });
    const original = structuredClone(chronicle.getMemories()[0]!);
    const final = { ...next, receipt: { ...world.receipt!, source } };
    chronicle.refreshReceipt(final);
    const memory = chronicle.getMemories()[0]!;
    expect(memory).toEqual({ ...original, summary: expect.stringContaining('contributed 1 idea') });
    expect(memory.summary).toContain(source === 'fixture' ? 'did not shape it' : 'labelled fallback fixture');
    expect(memory.summary).not.toContain('shaped observable features');
  });
});
