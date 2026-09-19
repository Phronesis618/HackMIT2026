import { describe, expect, it } from 'vitest';
import { createBrowserChronicle, type KeyValueStorage } from '../../src/client/chronicle';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';

const identity = { id: 'offline-player', displayName: 'Explorer', classId: 'bastion' as const };

describe('offline expedition memories', () => {
  it.each([false, true])('keeps each prepared expedition after a storage reload: %s', async (reload) => {
    const data = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value); },
      removeItem: (key) => { data.delete(key); },
    };
    const chronicle = createBrowserChronicle(storage);
    const makeSession = (memories: typeof chronicle) => {
      const session = new LocalSession({ identity, worldProvider: fixtureWorldProvider });
      session.onEvents((events) => {
        const world = session.getWorld();
        memories.ingest(events, {
          players: [identity],
          world: world ? {
            worldId: world.worldId,
            title: world.recipe.title,
            provenanceSource: world.provenance.source,
            receipt: world.receipt,
          } : null,
        });
      });
      return session;
    };
    const first = makeSession(chronicle);
    let second = first;
    try {
      first.submitContribution('A sanctuary above the clouds');
      await first.requestWorld();
      first.enterPortal();
      first.returnToHeadquarters();
      expect(chronicle.getMemories().map((memory) => memory.kind)).toEqual([
        'creation_receipt', 'arrival_keepsake', 'run_summary',
      ]);

      const currentChronicle = reload ? createBrowserChronicle(storage) : chronicle;
      if (reload) {
        first.dispose();
        second = makeSession(currentChronicle);
      }
      second.submitContribution('A second journey through the sanctuary');
      await second.requestWorld();
      second.enterPortal();
      second.returnToHeadquarters();

      const persisted = createBrowserChronicle(storage).getMemories();
      expect(persisted.map((memory) => memory.kind)).toEqual([
        'creation_receipt', 'arrival_keepsake', 'run_summary',
        'creation_receipt', 'arrival_keepsake', 'run_summary',
      ]);
      expect(new Set(persisted.map((memory) => memory.worldId)).size).toBe(2);
      expect(new Set(persisted.map((memory) => memory.id)).size).toBe(6);
      expect(persisted.every((memory) => memory.provenanceSource === 'fixture')).toBe(true);
      expect(persisted.filter((memory) => memory.kind === 'creation_receipt')
        .every((memory) => memory.summary.includes('did not shape'))).toBe(true);
    } finally {
      first.dispose();
      if (second !== first) second.dispose();
    }
  });
});
