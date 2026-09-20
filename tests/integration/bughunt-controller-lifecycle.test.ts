import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentAudio } from '../../src/client/audio';
import { createBrowserChronicle } from '../../src/client/chronicle';
import { GameController } from '../../src/client/game/GameController';
import { createUiStore } from '../../src/client/game/uiStore';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider, type WorldProvider } from '../../src/client/transport/worldProviders';
import { TICK_MS } from '../../src/shared/conventions';
import type { WorldRenderer } from '../../src/shared/render';

class Stage extends EventTarget {
  contains(target: EventTarget) { return target === this; }
  closest() { return null; }
  querySelector() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  focus() {}
}

const identity = { id: 'bughunt-input', displayName: 'Input operative', classId: 'bastion' as const };
const flags = { fixtureWorld: true, startRoom: null, autoEnter: false };
let events: EventTarget;
let frame: () => void;
let controller: GameController | undefined;

function dispatch(type: string, target: EventTarget, properties: Record<string, string | number> = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'target', { value: target });
  Object.assign(event, properties);
  events.dispatchEvent(event);
}

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function createHarness(provider: WorldProvider = fixtureWorldProvider) {
  const session = new LocalSession({ identity, worldProvider: provider });
  const renderer: WorldRenderer = {
    mount: vi.fn(async () => {}), showHeadquarters: vi.fn(), showRoom: vi.fn(),
    renderSnapshot: vi.fn(), playEvents: vi.fn(), screenToWorld: (x, y) => ({ x, y }),
    captureThumbnail: vi.fn(async () => null), destroy: vi.fn(),
  };
  const chronicle = createBrowserChronicle({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const store = createUiStore(GameController.initialModel(session, flags, chronicle, false));
  controller = new GameController({
    session, renderer, chronicle, store, flags, audio: createSilentAudio(), liveGenerationAvailable: false,
  });
  const stage = new Stage();
  return { session, store, stage, renderer, controller, actions: controller.actions };
}

async function setup(provider: WorldProvider = fixtureWorldProvider) {
  const harness = createHarness(provider);
  await harness.controller.attachStage(harness.stage as unknown as HTMLElement);
  harness.session.advance(TICK_MS);
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
  events = new EventTarget();
  frame = () => {};
  vi.stubGlobal('window', events);
  vi.stubGlobal('HTMLElement', Stage);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  controller?.dispose();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('input release while animation frames are suspended', () => {
  it.each(['blur', 'keyup', 'focusin'])('stops actual solo movement on %s without another frame', async (type) => {
    const { session, stage } = await setup();
    const initialX = session.getSnapshot()!.players[0]!.x;
    dispatch('keydown', stage, { code: 'KeyD' });
    frame();
    session.advance(TICK_MS);
    const before = session.getSnapshot()!.players[0]!;
    expect(before.x).toBeGreaterThan(initialX);

    dispatch(type, type === 'focusin' ? new Stage() : stage, { code: 'KeyD' });
    for (let tick = 0; tick < 20; tick++) session.advance(TICK_MS);
    const after = session.getSnapshot()!.players[0]!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
  });

  it('keeps another direction held when only one key is released', async () => {
    const { session, stage } = await setup();
    dispatch('keydown', stage, { code: 'KeyD' });
    dispatch('keydown', stage, { code: 'KeyW' });
    frame();
    session.advance(TICK_MS);
    const before = session.getSnapshot()!.players[0]!;
    dispatch('keyup', stage, { code: 'KeyD' });
    session.advance(TICK_MS);
    const after = session.getSnapshot()!.players[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBeLessThan(before.y);
  });
});

describe('generation action lifecycle', () => {
  it('does not let an aborted request hide the replacement generation overlay', async () => {
    const first = gate();
    const second = gate();
    let calls = 0;
    const { session, store, actions } = await setup({
      kind: 'server',
      async prepareWorld(request) {
        await (++calls === 1 ? first.promise : second.promise);
        return fixtureWorldProvider.prepareWorld(request);
      },
    });
    actions.requestWorld();
    actions.requestWorld();
    await vi.advanceTimersByTimeAsync(0);
    const waiting = { phase: store.get().phase, notice: store.get().notice };
    second.release();
    await vi.advanceTimersByTimeAsync(0);
    first.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getWorld()).not.toBeNull();
    expect(waiting).toEqual({ phase: 'preparing', notice: null });
    expect(store.get().phase).toBe('headquarters');
  });

  it.each(['training', 'expedition'] as const)('keeps the authoritative %s phase when generation is rejected', async (phase) => {
    const { session, store, actions } = await setup();
    if (phase === 'training') actions.enterTraining?.();
    else {
      await session.requestWorld();
      actions.enterPortal();
    }
    expect(store.get().phase).toBe(phase);
    actions.requestWorld();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getPhase()).toBe(phase);
    expect(store.get().phase).toBe(phase);
  });

  it('does not publish a cancellation error after the controller is disposed', async () => {
    const pending = gate();
    const { store, actions } = await setup({
      kind: 'server',
      async prepareWorld(request) {
        await pending.promise;
        return fixtureWorldProvider.prepareWorld(request);
      },
    });
    actions.requestWorld();
    controller!.dispose();
    const before = store.get();
    pending.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get()).toEqual(before);
  });
});

describe('controller disposal during attachment', () => {
  it('does not restart the session or draw after its pending renderer mount completes', async () => {
    const pending = gate();
    const { controller, session, stage, renderer } = createHarness();
    vi.mocked(renderer.mount).mockImplementation(() => pending.promise);
    const start = vi.spyOn(session, 'start');
    const attachment = controller.attachStage(stage as unknown as HTMLElement);
    controller.dispose();
    pending.release();
    await attachment;
    expect(start).not.toHaveBeenCalled();
    expect(renderer.showHeadquarters).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not register a connection timer after its pending session start completes', async () => {
    const pending = gate();
    const { controller, session, stage } = createHarness();
    vi.spyOn(session, 'start').mockImplementation(() => pending.promise);
    const attachment = controller.attachStage(stage as unknown as HTMLElement);
    await Promise.resolve();
    controller.dispose();
    pending.release();
    await attachment;
    expect(vi.getTimerCount()).toBe(0);
  });
});
