import { describe, expect, it } from 'vitest';
import { createSilentAudio } from '../../src/client/audio';
import { createBrowserChronicle } from '../../src/client/chronicle';
import { GameController } from '../../src/client/game/GameController';
import { createIdentityPersistence, IDENTITY_STORAGE_KEY } from '../../src/client/game/identity';
import { createUiStore } from '../../src/client/game/uiStore';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import type { WorldRenderer } from '../../src/shared/render';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('boot-selected identity storage', () => {
  it('persists local controller edits to two named tabs without replacing the ordinary identity', async () => {
    const stores = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
    const ordinary = createIdentityPersistence(null, stores).load();
    const guest = createIdentityPersistence('Guest', stores);
    const other = createIdentityPersistence('Other', stores);
    const guestIdentity = guest.load();
    const otherIdentity = other.load();
    const renderer: WorldRenderer = {
      mount: async () => {}, showHeadquarters: () => {}, showRoom: () => {}, renderSnapshot: () => {},
      playEvents: () => {}, screenToWorld: (x, y) => ({ x, y }), captureThumbnail: async () => null, destroy: () => {},
    };
    const flags = { fixtureWorld: true, startRoom: null, autoEnter: false };
    const chronicle = createBrowserChronicle(memoryStorage());
    for (const [adapter, identity, displayName, classId] of [
      [guest, guestIdentity, 'Guest Renamed', 'weaver'],
      [other, otherIdentity, 'Other Renamed', 'shade'],
    ] as const) {
      const session = new LocalSession({ identity, worldProvider: fixtureWorldProvider });
      await session.start();
      const store = createUiStore(GameController.initialModel(session, flags, chronicle, false));
      const controller = new GameController({
        session, store, renderer, chronicle, flags, liveGenerationAvailable: false, audio: createSilentAudio(),
        persistIdentity: adapter.save,
      });
      controller.actions.setDisplayName(displayName);
      controller.actions.selectClass(classId);
      expect(adapter.load()).toEqual({ ...identity, displayName, classId });
      session.dispose();
    }
    expect(createIdentityPersistence('Guest', stores).load()).toEqual({ ...guestIdentity, displayName: 'Guest Renamed', classId: 'weaver' });
    expect(createIdentityPersistence('Other', stores).load()).toEqual({ ...otherIdentity, displayName: 'Other Renamed', classId: 'shade' });
    expect(createIdentityPersistence(null, stores).load()).toEqual(ordinary);
    expect(new Set([ordinary.id, guestIdentity.id, otherIdentity.id]).size).toBe(3);
  });

  it('uses the same validated, trimmed scope for loading and saving', () => {
    const stores = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
    const ordinary = createIdentityPersistence(null, stores).load();
    for (const invalid of ['', '   ', 'not/a/tab', 'x'.repeat(25)]) {
      expect(createIdentityPersistence(invalid, stores).load()).toEqual(ordinary);
    }
    const tab = createIdentityPersistence('  Guest  ', stores);
    const identity = tab.load();
    tab.save({ ...identity, classId: 'beacon' });
    expect(createIdentityPersistence('Guest', stores).load()).toEqual({ ...identity, classId: 'beacon' });
    expect(stores.sessionStorage.getItem(`${IDENTITY_STORAGE_KEY}.tab.Guest`)).not.toBeNull();
    expect(createIdentityPersistence(null, stores).load()).toEqual(ordinary);
  });

  it('validates stored identities and tolerates blocked storage access', () => {
    const stores = { localStorage: memoryStorage(), sessionStorage: memoryStorage() };
    stores.sessionStorage.setItem(`${IDENTITY_STORAGE_KEY}.tab.Guest`, '{"id":"invalid","classId":"not-a-class"}');
    const adapter = createIdentityPersistence('Guest', stores);
    const fresh = adapter.load();
    expect(fresh).toMatchObject({ displayName: 'Guest', classId: 'bastion' });
    expect(adapter.load()).toEqual(fresh);
    adapter.save({ ...fresh, displayName: ' ' });
    expect(adapter.load()).toEqual(fresh);
    const blocked = createIdentityPersistence('Guest', {
      get localStorage(): Storage { throw new Error('blocked'); },
      get sessionStorage(): Storage { throw new Error('blocked'); },
    });
    expect(blocked.load()).toMatchObject({ displayName: 'Guest', classId: 'bastion' });
    expect(() => blocked.save(fresh)).not.toThrow();
  });
});
