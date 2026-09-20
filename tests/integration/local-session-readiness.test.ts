import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider, type WorldProvider } from '../../src/client/transport/worldProviders';
import { PreparedWorldSchema, type GameEvent, type GenerationRequestInput, type PreparedWorld } from '../../src/shared/contracts';
import { PLAYER_RADIUS, TICK_MS, tileToWorld, worldToTile } from '../../src/shared/conventions';
import { upgradeToFloors } from '../../src/shared/floorgen';
import * as simulation from '../../src/sim';
import { chaseWaypoint } from '../../src/sim/combat';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  cleanups.push(release);
  return { promise, release };
}

async function session(provider: WorldProvider) {
  const local = new LocalSession({
    identity: { id: 'readiness-player', displayName: 'Tester', classId: 'bastion' },
    worldProvider: provider,
    scheduler: { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: () => {}, now: () => 0 },
  });
  cleanups.push(() => local.dispose());
  const events: GameEvent[] = [];
  local.onEvents((batch) => events.push(...batch));
  await local.start();
  return { local, events };
}

function move(local: LocalSession, moveX = 0, moveY = 0) {
  local.setIntent({ moveX, moveY, aimX: 1000, aimY: 0, attack: false, dash: false, ability: null });
}

function ticks(local: LocalSession, count: number) {
  for (let i = 0; i < count; i++) local.advance(TICK_MS);
}

function walkToExit(local: LocalSession, events: GameEvent[]) {
  const before = events.filter((event) => event.type === 'exit_reached').length;
  move(local, 0, 1);
  for (let i = 0; i < 160 && events.filter((event) => event.type === 'exit_reached').length === before; i++) {
    ticks(local, 1);
  }
  move(local);
  expect(events.filter((event) => event.type === 'exit_reached')).toHaveLength(before + 1);
}

function prefix(world: PreparedWorld, count: number) {
  return PreparedWorldSchema.parse({ ...world, rooms: world.rooms.slice(0, count) });
}

function requestWorld(local: LocalSession) {
  const pending = local.requestWorld();
  void pending.catch(() => {});
  return pending;
}

async function compactWorld(request: GenerationRequestInput): Promise<PreparedWorld> {
  const world = await fixtureWorldProvider.prepareWorld(request);
  return PreparedWorldSchema.parse({
    ...world,
    rooms: world.rooms.map((room) => ({
      ...room, width: 8, height: 6, props: [], encounters: [], attributions: [], relics: [],
      anchorRelays: room.isFinal ? [{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 4 }] : undefined,
      tiles: ['########', '#......#', '#.P....#', room.isFinal ? '#...A..#' : '#.X....#', '#......#', '########'],
      exits: room.isFinal ? [] : [{ x: 2, y: 3, toRoomIndex: room.index + 1, direction: 'south' }],
    })),
  });
}

async function waitingSession() {
  const destination = gate();
  const completion = gate();
  const finished = gate();
  const { local, events } = await session({
    kind: 'server', prepareWorld: compactWorld,
    async *prepareWorldStream(request) {
      try {
        const world = await compactWorld(request);
        yield prefix(world, 1);
        await destination.promise;
        yield prefix(world, 2);
        await completion.promise;
        yield world;
      } finally { finished.release(); }
    },
  });
  const world = await local.requestWorld();
  local.enterPortal();
  walkToExit(local, events);
  ticks(local, 1);
  const player = local.getSnapshot()!.players[0]!;
  expect(worldToTile(player.x, player.y)).toEqual({ col: 2, row: 3 });
  expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', roomIndex: 0, roomCleared: true });
  return { local, events, world, destination, completion, finished };
}

describe('LocalSession generation entry readiness', () => {
  it('keeps ideas immutable until the generation stream finishes', async () => {
    const first = gate();
    const rest = gate();
    const { local } = await session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(request) {
        const world = await fixtureWorldProvider.prepareWorld(request);
        await first.promise;
        yield prefix(world, 1);
        await rest.promise;
        yield world;
      },
    });
    const idea = local.submitContribution('A lighthouse')!;
    const preparing = requestWorld(local);
    expect(local.removeContribution(idea.id)).toBe(false);
    first.release();
    await preparing;
    expect(local.removeContribution(idea.id)).toBe(false);
    rest.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(3));
    expect(local.removeContribution(idea.id)).toBe(true);
    expect(local.getContributions()).toEqual([]);
    expect(local.getWorld()?.receipt.lines[0]?.contributionId).toBe(idea.id);
  });

  it.each(['walk', 'portal', 'preview'] as const)('blocks %s entry into a previous world until the replacement first prefix', async (entry) => {
    const first = gate();
    const rest = gate();
    let calls = 0;
    const { local, events } = await session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(request) {
        const world = await fixtureWorldProvider.prepareWorld(request);
        if (++calls === 1) yield world;
        else {
          await first.promise;
          yield prefix(world, 1);
          await rest.promise;
          yield world;
        }
      },
    });
    const previous = await local.requestWorld();
    local.enterPortal();
    local.returnToHeadquarters();
    const arrivals = events.filter((event) => event.type === 'room_entered').length;
    const preparing = requestWorld(local);
    if (entry === 'walk') walkToExit(local, events);
    else if (entry === 'portal') local.enterPortal();
    else local.enterRoomIndex(0);
    expect(local.getPhase()).toBe('headquarters');
    expect(local.getWorld()?.worldId).toBe(previous.worldId);
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(arrivals);

    first.release();
    const next = await preparing;
    expect(next.worldId).not.toBe(previous.worldId);
    expect(next.rooms).toHaveLength(1);
    if (entry === 'walk') {
      move(local, 0, -1);
      ticks(local, 16);
      walkToExit(local, events);
    } else if (entry === 'portal') local.enterPortal();
    else local.enterRoomIndex(0);
    expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', worldId: next.worldId });
    expect(local.getWorld()?.worldId).toBe(local.getSnapshot()?.worldId);
    rest.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(3));
    expect(local.getWorld()?.worldId).toBe(local.getSnapshot()?.worldId);
  });

  it('blocks training before the first prefix and accepts later prefixes while training', async () => {
    const first = gate();
    const rest = gate();
    const { local } = await session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(request) {
        const world = await fixtureWorldProvider.prepareWorld(request);
        await first.promise;
        yield prefix(world, 1);
        await rest.promise;
        yield world;
      },
    });
    const preparing = requestWorld(local);
    expect(local.enterTraining()).toBe(false);
    expect(local.getPhase()).toBe('headquarters');
    first.release();
    const world = await preparing;
    expect(local.enterTraining()).toBe(true);
    const training = structuredClone(local.getSnapshot());
    rest.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(3));
    expect(local.getSnapshot()).toEqual(training);
    local.returnToHeadquarters();
    local.enterPortal();
    expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', worldId: world.worldId });
  });

  it.each(['expedition', 'training'] as const)('rejects generation from %s without cancelling the existing stream', async (phase) => {
    const rest = gate();
    let signal: AbortSignal | undefined;
    const provider: WorldProvider = {
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      prepareWorldStream: vi.fn(async function* (request, options) {
        signal = options?.signal;
        const world = await fixtureWorldProvider.prepareWorld(request);
        yield prefix(world, 1);
        await rest.promise;
        yield world;
      }),
    };
    const { local } = await session(provider);
    const world = await local.requestWorld();
    if (phase === 'expedition') local.enterPortal();
    else expect(local.enterTraining()).toBe(true);
    const progress = local.getGenerationStatus();
    await expect(local.requestWorld()).rejects.toThrow(/headquarters/i);
    expect(provider.prepareWorldStream).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    expect(local.getGenerationStatus()).toEqual(progress);
    rest.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(3));
    expect(local.getSnapshot()).toMatchObject({ phase, worldId: world.worldId });
  });

  it('retains the old world after failure and locks it again during retry', async () => {
    const failure = gate();
    const retry = gate();
    let calls = 0;
    const { local } = await session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(request) {
        const call = ++calls;
        if (call === 2) {
          await failure.promise;
          throw new Error('Generation unavailable');
        }
        if (call === 3) await retry.promise;
        yield await fixtureWorldProvider.prepareWorld(request);
      },
    });
    const previous = await local.requestWorld();
    const failed = local.requestWorld().catch((error: unknown) => error);
    local.enterPortal();
    expect(local.getPhase()).toBe('headquarters');
    failure.release();
    expect(await failed).toMatchObject({ message: 'Generation unavailable' });
    expect(local.getGenerationStatus().phase).toBe('failed');
    local.enterPortal();
    expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', worldId: previous.worldId });
    local.returnToHeadquarters();
    const retried = requestWorld(local);
    local.enterPortal();
    expect(local.getPhase()).toBe('headquarters');
    retry.release();
    const next = await retried;
    local.enterPortal();
    expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', worldId: next.worldId });
  });

  it('ignores a cancelled first prefix without unlocking the replacement request', async () => {
    const cancelled = gate();
    const replacement = gate();
    const finished = gate();
    let calls = 0;
    const { local } = await session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(request) {
        const call = ++calls;
        const world = await fixtureWorldProvider.prepareWorld(request);
        if (call === 2) {
          try {
            await cancelled.promise;
            yield world;
          } finally { finished.release(); }
        } else {
          if (call === 3) await replacement.promise;
          yield world;
        }
      },
    });
    const previous = await local.requestWorld();
    const aborted = expect(local.requestWorld()).rejects.toMatchObject({ name: 'AbortError' });
    const preparing = requestWorld(local);
    await aborted;
    cancelled.release();
    await finished.promise;
    local.enterPortal();
    expect(local.getPhase()).toBe('headquarters');
    expect(local.getWorld()?.worldId).toBe(previous.worldId);
    replacement.release();
    const next = await preparing;
    local.enterPortal();
    expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', worldId: next.worldId });
  });

  it('keeps a rejected simulation world out of transport state and notifications', async () => {
    const sim = simulation.createSimulation();
    vi.spyOn(simulation, 'createSimulation').mockReturnValue(sim);
    const { local, events } = await session(fixtureWorldProvider);
    const previous = await local.requestWorld();
    const onWorld = vi.fn();
    local.onWorld(onWorld);
    vi.spyOn(sim, 'setWorld').mockImplementationOnce(() => {});
    await expect(local.requestWorld()).rejects.toThrow('Simulation rejected');
    expect(onWorld).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'world_prepared')).toHaveLength(1);
    expect(local.getWorld()).toEqual(previous);
    local.enterPortal();
    expect(local.getSnapshot()?.worldId).toBe(previous.worldId);
  });
});

describe('LocalSession pending streamed exits', () => {
  it('moves once when the destination commits without requiring another exit step', async () => {
    const { local, events, destination, completion } = await waitingSession();
    const onSnapshot = vi.fn();
    local.onSnapshot(onSnapshot);
    destination.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(2));
    expect(local.getSnapshot()).toMatchObject({ phase: 'expedition', roomIndex: 1 });
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ roomIndex: 1 }));
    expect(events.filter((event) => event.type === 'exit_reached')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'room_entered' && event.roomIndex === 1)).toHaveLength(1);
    completion.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(3));
    ticks(local, 120);
    expect(local.getSnapshot()?.roomIndex).toBe(1);
    expect(local.getWorld()?.worldId).toBe(local.getSnapshot()?.worldId);
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(2);
  });

  it.each(['headquarters', 'same-world', 'replacement-world'] as const)('discards a waiting exit after returning to HQ: %s', async (action) => {
    const { local, events, destination, completion } = await waitingSession();
    local.returnToHeadquarters();
    if (action === 'replacement-world') await local.requestWorld();
    if (action !== 'headquarters') local.enterPortal();
    const arrivals = events.filter((event) => event.type === 'room_entered').length;
    destination.release();
    completion.release();
    await vi.waitFor(() => expect(local.getWorld()?.rooms).toHaveLength(3));
    ticks(local, 120);
    expect(local.getSnapshot()).toMatchObject(action === 'headquarters'
      ? { phase: 'headquarters', roomId: simulation.headquartersRoom.id }
      : { phase: 'expedition', roomIndex: 0 });
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(arrivals);
  });

  it('ignores a late destination after disposal', async () => {
    const { local, events, world, destination, completion, finished } = await waitingSession();
    const onWorld = vi.fn();
    const onSnapshot = vi.fn();
    local.onWorld(onWorld);
    local.onSnapshot(onSnapshot);
    const before = [...events];
    local.dispose();
    destination.release();
    completion.release();
    await finished.promise;
    ticks(local, 120);
    expect(local.getWorld()).toEqual(world);
    expect(local.getSnapshot()?.roomIndex).toBe(0);
    expect(events).toEqual(before);
    expect(onWorld).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
  });
});

describe('LocalSession existing traversal modes', () => {
  it('walks out of training to HQ without entering a prepared world', async () => {
    const { local, events } = await session(fixtureWorldProvider);
    const world = await local.requestWorld();
    expect(local.enterTraining()).toBe(true);
    const exit = simulation.trainingRoom.exits[0]!;
    move(local, -1);
    for (let i = 0; i < 50 && worldToTile(local.getSnapshot()!.players[0]!.x, 0).col !== exit.x; i++) {
      ticks(local, 1);
    }
    walkToExit(local, events);
    expect(local.getSnapshot()).toMatchObject({ phase: 'headquarters', roomId: simulation.headquartersRoom.id });
    expect(local.getWorld()?.worldId).toBe(world.worldId);
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'run_ended')).toHaveLength(0);
  });

  it('leaves floors door transitions to the simulation', async () => {
    const { local, events } = await session({
      kind: 'client-fixture',
      async prepareWorld(request) {
        return upgradeToFloors(await fixtureWorldProvider.prepareWorld(request), 'delta');
      },
    });
    const world = await local.requestWorld();
    local.enterPortal();
    const room = world.rooms[0]!;
    const exit = room.exits[0]!;
    expect(exit.toRoomId).toBeDefined();
    const grid = simulation.buildSolidGrid(room);
    const target = tileToWorld(exit.x, exit.y);
    for (let i = 0; i < 1200 && local.getSnapshot()?.roomId === room.id; i++) {
      const player = local.getSnapshot()!.players[0]!;
      const point = chaseWaypoint(grid, player, target, PLAYER_RADIUS);
      const distance = Math.hypot(point.x - player.x, point.y - player.y);
      move(local, distance > 0 ? (point.x - player.x) / distance : 0, distance > 0 ? (point.y - player.y) / distance : 0);
      ticks(local, 1);
    }
    move(local);
    expect(local.getSnapshot()?.floor?.roomId).toBe(exit.toRoomId);
    expect(local.getSnapshot()?.worldId).toBe(world.worldId);
    expect(events.filter((event) => event.type === 'exit_reached')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(2);
    expect(local.getGenerationStatus().message).not.toContain('not committed');
  });
});
