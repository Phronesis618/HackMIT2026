/** Floors rooms reach the renderer the way legacy rooms do: GameController.showRoom, built from the ref. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentAudio } from '../../src/client/audio';
import { createBrowserChronicle } from '../../src/client/chronicle';
import { GameController } from '../../src/client/game/GameController';
import { createUiStore } from '../../src/client/game/uiStore';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import type { RoomSpec } from '../../src/shared/contracts';
import { TICK_MS, tileToWorld } from '../../src/shared/conventions';
import type { WorldRenderer } from '../../src/shared/render';
import { createRoomProvider } from '../../src/sim';
import { steerIntent } from '../sim/floorsBot';

const input = vi.hoisted(() => ({
  moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false,
}));
vi.mock('../../src/client/game/input', () => ({
  createKeyboardMouseInput: () => ({ sample: () => ({ ...input }), getPointer: () => null, dispose: vi.fn() }),
}));

let frame = () => {};
let controller: GameController | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(input, { moveX: 0, moveY: 0, interact: false });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  controller?.dispose();
  controller = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GameController in floors mode', () => {
  it('shows each floors room once, compiled locally from the snapshot ref', async () => {
    const data = new Map<string, string>();
    const chronicle = createBrowserChronicle({
      getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); },
    });
    const session = new LocalSession({
      identity: { id: 'solo', displayName: 'Solo', classId: 'bastion' },
      worldProvider: {
        ...fixtureWorldProvider, prepareWorldStream: undefined,
        prepareWorld: (request, options) => fixtureWorldProvider.prepareWorld({ ...request, floors: true }, options),
      },
    });
    const shown: RoomSpec[] = [];
    const renderer: WorldRenderer = {
      mount: vi.fn(async () => {}), showHeadquarters: vi.fn(), showRoom: vi.fn((room: RoomSpec) => { shown.push(room); }),
      renderSnapshot: vi.fn(), playEvents: vi.fn(), screenToWorld: (x, y) => ({ x, y }),
      captureThumbnail: vi.fn(async () => null), destroy: vi.fn(),
    };
    const flags = { fixtureWorld: true, startRoom: null, autoEnter: false };
    const store = createUiStore(GameController.initialModel(session, flags, chronicle, false));
    controller = new GameController({ session, renderer, store, chronicle, flags, audio: createSilentAudio(), liveGenerationAvailable: false });
    await controller.attachStage({} as HTMLElement);
    const world = await session.requestWorld();
    const provider = createRoomProvider(world)!;
    session.enterPortal();
    session.advance(TICK_MS);
    const entrance = provider.getRoom(provider.entranceRef());
    expect(shown).toEqual([entrance]);
    expect(store.get().room?.name).toBe(entrance.name);

    const door = entrance.exits[0]!;
    for (let i = 0; i < 1500 && session.getSnapshot()!.floor!.roomId === 'r00'; i++) {
      const snapshot = session.getSnapshot()!;
      Object.assign(input, steerIntent(entrance, snapshot, snapshot.players[0]!, tileToWorld(door.x, door.y), false));
      frame();
      session.advance(TICK_MS);
    }
    Object.assign(input, { moveX: 0, moveY: 0 });
    for (let i = 0; i < 5; i++) session.advance(TICK_MS);
    const next = provider.getRoom({ biomeId: entrance.biomeId!, roomId: door.toRoomId! });
    expect(shown).toEqual([entrance, next]);
    expect(store.get().room).toMatchObject({ name: next.name, isFinal: false });
  });
});
