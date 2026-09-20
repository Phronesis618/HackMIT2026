import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentAudio } from '../../src/client/audio';
import { createBrowserChronicle } from '../../src/client/chronicle';
import { GameController } from '../../src/client/game/GameController';
import { createUiStore } from '../../src/client/game/uiStore';
import { RemoteSession } from '../../src/client/transport/RemoteSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import { IDLE_GENERATION_STATUS, type GameSnapshot, type PlayerIdentity, type PreparedWorld } from '../../src/shared/contracts';
import { upgradeToFloors } from '../../src/shared/floorgen';
import { PROTOCOL_VERSION, ServerMessageSchema, type ServerMessage } from '../../src/shared/protocol';
import type { WorldRenderer } from '../../src/shared/render';
import { createRoomProvider, createSimulation } from '../../src/sim';

vi.mock('../../src/client/game/input', () => ({
  createKeyboardMouseInput: () => ({
    sample: () => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null }),
    getPointer: () => null, dispose: vi.fn(),
  }),
}));

const identity: PlayerIdentity = { id: 'readiness-operative', displayName: 'Guest', classId: 'bastion' };
const flags = { fixtureWorld: false, startRoom: null, autoEnter: false };
let frame = () => {};
let controller: GameController | null = null;

class Socket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(ServerMessageSchema.parse(message)) });
  }
}

function snapshot(world: PreparedWorld | null): GameSnapshot {
  const sim = createSimulation();
  sim.addPlayer(identity);
  if (world) {
    sim.setWorld(world);
    sim.enterRoom(0);
  }
  return sim.getSnapshot();
}

function welcome(socket: Socket, world: PreparedWorld | null, state = snapshot(world)) {
  socket.receive({
    type: 'welcome', protocolVersion: PROTOCOL_VERSION, playerId: identity.id,
    serverTimeMs: 0, isHost: true, resumeToken: 'readiness-resume-token',
    lobby: { sessionId: 'readiness-session', hostPlayerId: identity.id, players: [{ identity, connected: true }] },
    snapshot: state, world, contributions: [], generation: IDLE_GENERATION_STATUS,
    eventSequence: 0, events: [], historyTruncated: false,
  });
}

async function world(requestId: string) {
  return fixtureWorldProvider.prepareWorld({ requestId, sessionId: 'readiness-session', contributions: [] });
}

async function setup(initialWorld: PreparedWorld | null) {
  const sockets: Socket[] = [];
  const session = new RemoteSession({
    identity, url: 'ws://readiness.invalid', reconnect: false,
    createSocket: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  let renderedRoomId: string | null = null;
  const accepted: GameSnapshot[] = [];
  const renderer: WorldRenderer = {
    mount: vi.fn(async () => {}),
    showHeadquarters: vi.fn((room) => { renderedRoomId = room.id; }),
    showRoom: vi.fn((room) => { renderedRoomId = room.id; }),
    renderSnapshot: vi.fn((state) => { if (state.roomId === renderedRoomId) accepted.push(state); }),
    playEvents: vi.fn(), screenToWorld: (x, y) => ({ x, y }),
    captureThumbnail: vi.fn(async () => null), destroy: vi.fn(),
  };
  const chronicle = createBrowserChronicle({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const store = createUiStore(GameController.initialModel(session, flags, chronicle, false));
  const persistIdentity = vi.fn();
  controller = new GameController({ session, renderer, store, chronicle, flags, audio: createSilentAudio(), liveGenerationAvailable: false, persistIdentity });
  const ready = controller.attachStage({} as HTMLElement);
  await Promise.resolve();
  welcome(sockets[0]!, initialWorld);
  await ready;
  frame();
  const reconnect = async (nextWorld: PreparedWorld, state = snapshot(nextWorld)) => {
    sockets.at(-1)!.onclose?.();
    frame();
    const connected = session.start();
    welcome(sockets.at(-1)!, nextWorld, state);
    await connected;
    frame();
  };
  return { session, store, renderer, accepted, reconnect, socket: sockets[0]!, persistIdentity, actions: controller.actions };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

describe('confirmed remote identity persistence', () => {
  it('saves acknowledged name and class changes, never the identity before acknowledgement', async () => {
    const { actions, persistIdentity, socket, store } = await setup(null);
    actions.setDisplayName('Confirmed Guest');
    expect(persistIdentity).not.toHaveBeenCalled();
    frame();
    expect(persistIdentity).not.toHaveBeenCalled();
    expect(store.get().localPlayer.displayName).toBe('Guest');
    const renamed = { ...identity, displayName: 'Confirmed Guest' };
    socket.receive({
      type: 'lobby',
      lobby: { sessionId: 'readiness-session', hostPlayerId: identity.id, players: [{ identity: renamed, connected: true }] },
    });
    frame();
    expect(persistIdentity).toHaveBeenCalledExactlyOnceWith(renamed);
    expect(store.get().localPlayer.displayName).toBe('Confirmed Guest');
    actions.selectClass('weaver');
    frame();
    expect(persistIdentity).toHaveBeenCalledTimes(1);
    const attuned = { ...renamed, classId: 'weaver' as const };
    socket.receive({
      type: 'lobby',
      lobby: { sessionId: 'readiness-session', hostPlayerId: identity.id, players: [{ identity: attuned, connected: true }] },
    });
    frame();
    expect(persistIdentity).toHaveBeenCalledTimes(2);
    expect(persistIdentity).toHaveBeenLastCalledWith(attuned);
    expect(store.get().localPlayer.classId).toBe('weaver');
    frame();
    expect(persistIdentity).toHaveBeenCalledTimes(2);
  });

  it('does not save rejected identity requests', async () => {
    const { actions, persistIdentity, socket, store } = await setup(null);
    actions.setDisplayName('Rejected Guest');
    socket.receive({ type: 'error', action: 'identity', message: 'Identity cannot change during a run.' });
    frame();
    expect(persistIdentity).not.toHaveBeenCalled();
    expect(store.get().localPlayer.displayName).toBe(identity.displayName);
  });
});
afterEach(() => {
  controller?.dispose();
  controller = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('controller room identity on remote welcome', () => {
  it('rebuilds another world at the same room index with no intervening HQ snapshot', async () => {
    const first = await world('readiness-first');
    const second = await world('readiness-second');
    second.rooms[0] = { ...second.rooms[0]!, id: 'replacement-room-zero', name: 'Replacement chamber' };
    const { renderer, store, reconnect, accepted } = await setup(first);
    expect(renderer.showRoom).toHaveBeenCalledTimes(1);
    await reconnect(second);
    expect(renderer.showRoom).toHaveBeenCalledTimes(2);
    expect(store.get().room?.name).toBe('Replacement chamber');
    expect(store.get().world?.worldId).toBe(second.worldId);
    expect(accepted.at(-1)).toMatchObject({ worldId: second.worldId, roomId: second.rooms[0]!.id });
  });

  it('rebuilds worlds that reuse room IDs but does not rebuild the same world and room', async () => {
    const first = await world('readiness-first');
    const second = await world('readiness-second');
    expect(first.rooms[0]!.id).toBe(second.rooms[0]!.id);
    const { renderer, reconnect } = await setup(first);
    await reconnect(first);
    expect(renderer.showRoom).toHaveBeenCalledTimes(1);
    await reconnect(second);
    expect(renderer.showRoom).toHaveBeenCalledTimes(2);
  });

  it('preserves committed-room streaming and synchronizes phase without rebuilding', async () => {
    const complete = await world('readiness-stream');
    const prefix = { ...complete, rooms: complete.rooms.slice(0, 1) };
    const { renderer, socket, store, reconnect } = await setup(prefix);
    socket.receive({ type: 'world', world: complete, requestId: 'readiness-stream' });
    socket.receive({ type: 'snapshot', snapshot: snapshot(complete) });
    expect(renderer.showRoom).toHaveBeenCalledTimes(1);
    expect(store.get().world?.committedRoomCount).toBe(3);
    store.set({ phase: 'debrief' });
    await reconnect(complete);
    expect(store.get().phase).toBe('expedition');
    expect(renderer.showRoom).toHaveBeenCalledTimes(1);
  });

  it('resolves floor room addresses and rebuilds a new world with reused floor room IDs', async () => {
    const first = upgradeToFloors(await world('readiness-floors'), 'readiness-floor-seed');
    const provider = createRoomProvider(first)!;
    const entrance = provider.getRoom(provider.entranceRef());
    const exit = entrance.exits.find((door) => door.toRoomId)!;
    const room = provider.getRoom({ biomeId: entrance.biomeId!, roomId: exit.toRoomId! });
    const { renderer, socket, store, reconnect } = await setup(first);
    const state = snapshot(first);
    const next = { ...state, roomId: room.id, roomIndex: room.index, floor: { ...state.floor!, roomId: room.roomId! } };
    socket.receive({ type: 'snapshot', snapshot: next });
    expect(renderer.showRoom).toHaveBeenCalledTimes(2);
    expect(store.get().room?.name).toBe(room.name);
    socket.receive({ type: 'snapshot', snapshot: next });
    expect(renderer.showRoom).toHaveBeenCalledTimes(2);
    const second = { ...first, worldId: 'readiness-new-floors-world' };
    await reconnect(second, { ...next, worldId: second.worldId });
    expect(renderer.showRoom).toHaveBeenCalledTimes(3);
  });
});
