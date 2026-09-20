import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentAudio } from '../../src/client/audio';
import { createBrowserChronicle, type KeyValueStorage } from '../../src/client/chronicle';
import { GameController } from '../../src/client/game/GameController';
import { createUiStore } from '../../src/client/game/uiStore';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import { TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { headquartersRecords } from '../../src/shared/headquarters';
import type { WorldRenderer } from '../../src/shared/render';
import type { LocalIntent } from '../../src/shared/session';

const input = vi.hoisted(() => ({
  moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false,
}));
vi.mock('../../src/client/game/input', () => ({
  createKeyboardMouseInput: () => ({ sample: () => ({ ...input }), getPointer: () => null, dispose: vi.fn() }),
}));

const identity = { id: 'test-hq-operative', displayName: 'Test operative', classId: 'bastion' as const };
const flags = { fixtureWorld: true, startRoom: null, autoEnter: false };
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

async function setup() {
  const data = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
  const chronicle = createBrowserChronicle(storage);
  const session = new LocalSession({ identity, worldProvider: fixtureWorldProvider });
  const renderer: WorldRenderer = {
    mount: vi.fn(async () => {}), showHeadquarters: vi.fn(), showRoom: vi.fn(),
    renderSnapshot: vi.fn(), playEvents: vi.fn(), screenToWorld: (x, y) => ({ x, y }),
    captureThumbnail: vi.fn(async () => null), destroy: vi.fn(),
  };
  const store = createUiStore(GameController.initialModel(session, flags, chronicle, false));
  controller = new GameController({ session, renderer, store, chronicle, flags, audio: createSilentAudio(), liveGenerationAvailable: false });
  await controller.attachStage({} as HTMLElement);
  session.advance(TICK_MS);
  const tick = (intent: Partial<LocalIntent> = {}) => {
    Object.assign(input, intent);
    frame();
    session.advance(TICK_MS);
  };
  const walk = (col: number, row: number) => {
    const goal = tileToWorld(col, row);
    for (let n = 0; n < 250; n++) {
      const player = session.getSnapshot()!.players[0]!;
      const dx = goal.x - player.x;
      const dy = goal.y - player.y;
      if (Math.hypot(dx, dy) < 2) break;
      tick({ moveX: Math.max(-1, Math.min(1, dx / 3)), moveY: Math.max(-1, Math.min(1, dy / 3)) });
    }
    tick({ moveX: 0, moveY: 0 });
    const player = session.getSnapshot()!.players[0]!;
    expect(Math.hypot(player.x - goal.x, player.y - goal.y)).toBeLessThan(3);
  };
  return { session, chronicle, store, tick, walk, actions: controller.actions };
}

describe('snapshot-driven headquarters controller', () => {
  it('removes one idea at capacity, updates the UI and preserves the existing world receipt', async () => {
    const { session, store, actions } = await setup();
    for (let i = 0; i < 24; i++) actions.submitContribution(`Idea ${i}`);
    const original = [...session.getContributions()];
    const world = await session.requestWorld();
    await Promise.resolve();
    const receipt = structuredClone(world.receipt);
    const removed = original[5]!;
    actions.removeContribution?.(removed.id);
    expect(store.get().contributions).toEqual(original.filter((c) => c.id !== removed.id));
    expect(session.getWorld()?.receipt).toEqual(receipt);
    expect(session.removeContribution(removed.id)).toBe(false);
    expect(session.removeContribution('missing')).toBe(false);
    actions.submitContribution('Replacement');
    expect(store.get().contributions).toHaveLength(24);
    const next = await session.requestWorld();
    expect(next.receipt.lines.map((line) => line.text)).toEqual([
      ...original.filter((c) => c.id !== removed.id).map((c) => c.text), 'Replacement',
    ]);
  });

  it('allows removing the last idea but blocks removal outside headquarters', async () => {
    const { session, store, actions } = await setup();
    actions.submitContribution('Dragons');
    const id = session.getContributions()[0]!.id;
    actions.enterTraining?.();
    actions.removeContribution?.(id);
    expect(session.removeContribution(id)).toBe(false);
    expect(store.get().contributions).toHaveLength(1);
    actions.returnToHeadquarters();
    actions.removeContribution?.(id);
    expect(store.get().contributions).toEqual([]);
    expect((await session.requestWorld()).receipt.lines).toEqual([]);
  });

  it('attunes once on an F edge at a physical shrine; moving away closes the station', async () => {
    const { session, store, tick, walk } = await setup();
    const select = vi.spyOn(session, 'setClass');
    tick({ interact: true });
    expect(select).not.toHaveBeenCalled();
    tick({ interact: false });
    walk(8, 10);
    walk(8, 8);
    expect(store.get().headquarters?.nearbyStationId).toBe('weaver');
    expect(session.getLocalPlayer().classId).toBe('bastion');
    tick({ interact: true });
    expect(select).toHaveBeenCalledExactlyOnceWith('weaver');
    expect(session.getSnapshot()!.players[0]!.classId).toBe('weaver');
    expect(store.get().headquarters?.activeStationId).toBe('weaver');
    for (let i = 0; i < 20; i++) tick();
    expect(select).toHaveBeenCalledTimes(1);
    walk(4, 8);
    expect(store.get().headquarters).toEqual({ nearbyStationId: 'beacon', activeStationId: null });
    expect(select).toHaveBeenCalledTimes(1);
    tick({ interact: false });
    tick({ interact: true });
    expect(select).toHaveBeenLastCalledWith('beacon');
    expect(session.getSnapshot()!.players[0]!.classId).toBe('beacon');
  });

  it('rechecks snapshot proximity for the clickable action and guards class changes outside headquarters', async () => {
    const { session, store, actions, walk } = await setup();
    store.set({ headquarters: { nearbyStationId: 'shade', activeStationId: null } });
    actions.activateHeadquartersStation?.();
    expect(session.getLocalPlayer().classId).toBe('bastion');
    walk(8, 10);
    walk(8, 8);
    store.set({ phase: 'preparing' });
    actions.activateHeadquartersStation?.();
    actions.selectClass('shade');
    expect(session.getLocalPlayer().classId).toBe('bastion');
    store.set({ phase: 'headquarters' });
    actions.activateHeadquartersStation?.();
    expect(session.getLocalPlayer().classId).toBe('weaver');
    actions.closeHeadquartersStation?.();
    expect(store.get().headquarters?.activeStationId).toBeNull();
    actions.enterTraining?.();
    expect(session.getPhase()).toBe('training');
    actions.selectClass('shade');
    actions.activateHeadquartersStation?.();
    expect(session.getLocalPlayer().classId).toBe('weaver');
    expect(store.get().headquarters?.activeStationId).toBeNull();
  });

  it('keeps preparation, portal entry, return and device-local records on the existing session', async () => {
    const { session, store, chronicle, actions } = await setup();
    expect(headquartersRecords(store.get().memories).memories).toBe(0);
    actions.submitContribution('A quiet stellar monastery');
    await session.requestWorld();
    expect(store.get().world?.provenance.source).toBe('fixture');
    expect(headquartersRecords(store.get().memories)).toMatchObject({ receipts: 1, worldsVisited: 0, expeditionsEnded: 0 });
    actions.enterPortal();
    expect(session.getPhase()).toBe('expedition');
    expect(headquartersRecords(store.get().memories).worldsVisited).toBe(1);
    actions.returnToHeadquarters();
    expect(session.getPhase()).toBe('headquarters');
    expect(headquartersRecords(store.get().memories)).toMatchObject({ memories: 3, worldsVisited: 1, expeditionsEnded: 1, receipts: 1, anchors: 0, lore: 0 });
    const recorded = chronicle.getMemories();
    expect(headquartersRecords([...recorded, ...recorded]).memories).toBe(3);
    expect(recorded.every((memory) => memory.sourceEventIds.length > 0)).toBe(true);
    actions.clearMemories();
    expect(headquartersRecords(store.get().memories)).toEqual({ memories: 0, worldsVisited: 0, expeditionsEnded: 0, receipts: 0, anchors: 0, lore: 0 });
  });
});
