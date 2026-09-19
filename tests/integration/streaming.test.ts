import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GenerationRequestSchema, PreparedWorldSchema, WorldFixtureSchema,
  type GameEvent, type GamePhase, type GenerationRequest, type GenerationStatus, type PreparedWorld,
} from '../../src/shared/contracts';
import { TICK_MS } from '../../src/shared/conventions';
import { sampleContributions } from '../../src/shared/samples';
import * as simulation from '../../src/sim';
import { createRelayServer, type RelayServer } from '../../src/server/app';
import { loadServerConfig } from '../../src/server/config';
import { createLiveGenerationService } from '../../src/server/generation/liveService';
import { LocalSession } from '../../src/client/transport/LocalSession';
import {
  fixtureWorldProvider, serverWorldProvider, parseWorldPrefix,
  type WorldProvider, type WorldStreamOptions,
} from '../../src/client/transport/worldProviders';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';

const request: GenerationRequest = {
  requestId: 'stream-request', sessionId: 'stream-session', contributions: [], plannedRoomCount: 3,
};
const identity = { id: 'stream-player', displayName: 'Tester', classId: 'bastion' as const };
const nativeFetch = globalThis.fetch;
const encoder = new TextEncoder();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function prefixes(input = request): Promise<PreparedWorld[]> {
  const world = await fixtureWorldProvider.prepareWorld(input);
  return [1, 2, 3].map((count) => PreparedWorldSchema.parse({ ...world, rooms: world.rooms.slice(0, count) }));
}

function session(provider: WorldProvider) {
  return new LocalSession({
    identity, worldProvider: provider,
    scheduler: { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: () => {}, now: () => 0 },
  });
}

function status(requestId: string, phase: GenerationStatus['phase'] = 'validating'): GenerationStatus {
  return { phase, message: 'Validating “écho” rooms…', requestId, startedAt: 1, elapsedMs: 2 };
}

function mockResponse(text: string, chunkSize = 97, keepOpen = false) {
  const bytes = encoder.encode(text);
  let offset = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        if (!keepOpen) controller.close();
      }
      else {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      }
    },
    cancel,
  });
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })));
  return cancel;
}

async function readWorlds(options?: WorldStreamOptions) {
  const worlds: PreparedWorld[] = [];
  for await (const world of serverWorldProvider.prepareWorldStream!(request, options)) worlds.push(world);
  return worlds;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bounded world stream consumer', () => {
  it('parses split UTF-8, split records, multiple records, and an unterminated final line', async () => {
    const worlds = await prefixes();
    const progress = status(request.requestId);
    const records = [{ type: 'status', status: progress }, ...worlds.map((world) => ({ type: 'world', world }))];
    mockResponse(records.map((record) => JSON.stringify(record)).join('\r\n'), 7);
    const onStatus = vi.fn();
    expect(await readWorlds({ onStatus })).toEqual(worlds);
    expect(onStatus).toHaveBeenCalledExactlyOnceWith(progress);
    expect(fetch).toHaveBeenCalledWith('/api/world', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/x-ndjson' }),
    }));
  });

  it('supports a JSON response from a compatible older server', async () => {
    const world = await fixtureWorldProvider.prepareWorld(request);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json(world)));
    expect(await readWorlds()).toEqual([world]);
  });

  it.each([
    ['malformed JSON', '{broken}\n'],
    ['malformed world', '{"type":"world","world":{}}\n'],
    ['malformed status', '{"type":"status","status":{}}\n'],
    ['wrong request status', JSON.stringify({ type: 'status', status: status('different-request') })],
    ['unknown record', '{"type":"done"}\n'],
    ['empty stream', ''],
  ])('rejects %s', async (_name, text) => {
    mockResponse(text);
    await expect(readWorlds()).rejects.toThrow();
  });

  it.each([
    ['record size', 'x'.repeat(1024 * 1024 + 1)],
    ['blank record size', `${' '.repeat(1024 * 1024 + 1)}\n`],
    ['total bytes', '\n'.repeat(4 * 1024 * 1024 + 1)],
    ['record count', `${JSON.stringify({ type: 'status', status: status(request.requestId) })}\n`.repeat(65)],
  ])('bounds %s and cancels the reader', async (_name, text) => {
    const cancel = mockResponse(text, text.length, true);
    await expect(readWorlds()).rejects.toThrow(/limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a truncated stream after yielding its intact first prefix', async () => {
    const [world] = await prefixes();
    mockResponse(`${JSON.stringify({ type: 'world', world })}\n`);
    const iterator = serverWorldProvider.prepareWorldStream!(request)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual(world);
    await expect(iterator.next()).rejects.toThrow(/before all rooms/);
  });

  it('cancels a pending body read immediately', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })));
    const controller = new AbortController();
    const result = readWorlds({ signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('committed prefix integrity', () => {
  it.each([
    ['world id', (world: PreparedWorld) => { world.worldId = 'other-world'; }],
    ['creation time', (world: PreparedWorld) => { world.createdAt++; }],
    ['recipe', (world: PreparedWorld) => { world.recipe.title = 'Changed title'; world.receipt.worldTitle = 'Changed title'; }],
    ['art', (world: PreparedWorld) => { world.art.glowIntensity = world.art.glowIntensity === 0 ? 1 : 0; }],
    ['room', (world: PreparedWorld) => { world.rooms[0]!.name = 'Changed room'; }],
    ['provenance', (world: PreparedWorld) => { world.provenance.label = 'Changed label'; }],
  ])('rejects mutated %s while retaining the committed world', async (_name, mutate) => {
    const [first, second] = await prefixes();
    mutate(second!);
    const gate = deferred<void>();
    const failed = deferred<GenerationStatus>();
    const local = session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream() { yield first!; await gate.promise; yield second!; },
    });
    local.onGenerationStatus((value) => { if (value.phase === 'failed') failed.resolve(value); });
    await local.requestWorld();
    const committed = structuredClone(local.getWorld());
    gate.resolve();
    expect((await failed.promise).message).toContain('Committed rooms remain playable');
    expect(local.getWorld()).toEqual(committed);
    local.dispose();
  });

  it('allows growing observable attribution and preserves live provenance', async () => {
    const fixture = WorldFixtureSchema.parse(fixtureJson);
    const input = { ...request, contributions: sampleContributions };
    const live = createLiveGenerationService({
      model: 'mock-model', fixtures: [fixture], log: () => {},
      provider: { async generate() { return { recipe: {
        ...fixture.recipe,
        contributionMappings: [{ contributionId: sampleContributions[0]!.id, kind: 'name', featureDescription: 'Name', roomIndex: 1 }],
      } }; } },
    });
    let previous: PreparedWorld | undefined;
    const receipts: boolean[] = [];
    for await (const raw of live.prepareWorldStream(input)) {
      previous = parseWorldPrefix(raw, input, previous);
      receipts.push(previous.receipt.lines[0]!.used);
      expect(previous.provenance.source).toBe('live');
    }
    expect(receipts).toEqual([false, true, true]);
    const forged = structuredClone(previous!);
    forged.receipt.lines[0]!.playerName = 'Invented player';
    expect(() => parseWorldPrefix(forged, input)).toThrow(/receipt/);
    forged.receipt.lines = previous!.receipt.lines;
    forged.recipe.contributionMappings[0]!.featureDescription = 'Invented feature';
    expect(() => parseWorldPrefix(forged, input)).toThrow(/attribution/);
  });
});

describe('LocalSession streaming lifecycle', () => {
  it('rejects invalid initial worlds and retains a previously playable world', async () => {
    let calls = 0;
    const local = session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(input) {
        const world = await fixtureWorldProvider.prepareWorld(input);
        yield ++calls === 1 ? world : { ...world, rooms: [] };
      },
    });
    const playable = await local.requestWorld();
    await expect(local.requestWorld()).rejects.toThrow();
    expect(local.getGenerationStatus().phase).toBe('failed');
    expect(local.getWorld()).toEqual(playable);
    local.enterPortal();
    expect(local.getPhase()).toBe('expedition');
    local.dispose();
  });

  it('resolves early, appends without resetting gameplay, forwards status and reuses the world', async () => {
    const gate = deferred<void>();
    const appended = deferred<void>();
    const progress: GenerationStatus[] = [];
    const events: GameEvent[] = [];
    const local = session({
      kind: 'server', prepareWorld: vi.fn(),
      async *prepareWorldStream(raw, options) {
        const input = GenerationRequestSchema.parse(raw);
        const worlds = await prefixes(input);
        options?.onStatus?.(status(input.requestId, 'generating'));
        yield worlds[0]!;
        await gate.promise;
        options?.onStatus?.(status(input.requestId));
        yield worlds[1]!;
        yield worlds[2]!;
      },
    });
    local.onGenerationStatus((value) => progress.push(value));
    local.onEvents((batch) => events.push(...batch));
    local.onWorld((world) => { if (world.rooms.length === 3) appended.resolve(); });
    await local.start();
    expect((await local.requestWorld()).rooms).toHaveLength(1);
    local.enterPortal();
    local.setIntent({ moveX: 1, moveY: 0, aimX: 1000, aimY: 0, attack: false, dash: false, ability: null });
    local.advance(TICK_MS * 3);
    const snapshot = structuredClone(local.getSnapshot());
    gate.resolve();
    await appended.promise;
    expect(local.getWorld()!.rooms).toHaveLength(3);
    expect(local.getSnapshot()).toEqual(snapshot);
    expect(events.filter((event) => event.type === 'world_prepared')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'room_entered')).toHaveLength(1);
    expect(progress.map((value) => value.phase)).toEqual(expect.arrayContaining(['generating', 'validating', 'fallback']));
    local.enterRoomIndex(2);
    expect(local.getSnapshot()?.roomIndex).toBe(2);
    const committed = local.getWorld();
    local.returnToHeadquarters();
    local.enterPortal();
    expect(local.getWorld()).toBe(committed);
    expect(local.getSnapshot()?.roomIndex).toBe(0);
    local.dispose();
  });

  it.each(['dispose', 'supersede'] as const)('ignores late legacy responses after %s', async (action) => {
    const late = deferred<PreparedWorld>();
    const world = await fixtureWorldProvider.prepareWorld(request);
    const prepareWorld = vi.fn<WorldProvider['prepareWorld']>().mockReturnValueOnce(late.promise).mockResolvedValue(world);
    const local = session({ kind: 'server', prepareWorld });
    const onWorld = vi.fn();
    const onStatus = vi.fn();
    local.onWorld(onWorld);
    local.onGenerationStatus(onStatus);
    const first = local.requestWorld();
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    if (action === 'dispose') local.dispose();
    else await local.requestWorld();
    await rejection;
    const before = onStatus.mock.calls.length;
    late.resolve({ ...world, worldId: 'stale-world' });
    await late.promise;
    await Promise.resolve();
    expect(local.getWorld()?.worldId).toBe(action === 'dispose' ? undefined : world.worldId);
    expect(onWorld).toHaveBeenCalledTimes(action === 'dispose' ? 0 : 1);
    expect(onStatus).toHaveBeenCalledTimes(before);
    expect(prepareWorld.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    local.dispose();
  });

  it('cancels superseded streams and ignores late statuses and prefixes', async () => {
    const gate = deferred<void>();
    const finished = deferred<void>();
    let firstSignal: AbortSignal | undefined;
    let calls = 0;
    const local = session({
      kind: 'server', prepareWorld: fixtureWorldProvider.prepareWorld,
      async *prepareWorldStream(raw, options) {
        const input = GenerationRequestSchema.parse(raw);
        const worlds = await prefixes(input);
        if (++calls === 1) {
          firstSignal = options?.signal;
          try {
            yield worlds[0]!;
            await gate.promise;
            options?.onStatus?.(status(input.requestId, 'failed'));
            yield { ...worlds[1]!, worldId: 'stale-world' };
          } finally { finished.resolve(); }
        } else yield { ...worlds[2]!, worldId: 'current-world' };
      },
    });
    await local.requestWorld();
    await local.requestWorld();
    expect(firstSignal?.aborted).toBe(true);
    const progress = local.getGenerationStatus();
    gate.resolve();
    await finished.promise;
    expect(local.getWorld()?.worldId).toBe('current-world');
    expect(local.getGenerationStatus()).toEqual(progress);
    local.dispose();
  });

  it('forwards a simulation debrief transition once after ticks', async () => {
    const sim = simulation.createSimulation();
    vi.spyOn(simulation, 'createSimulation').mockReturnValue(sim);
    const local = session(fixtureWorldProvider);
    const phases: GamePhase[] = [];
    local.onPhase((phase) => phases.push(phase));
    await local.start();
    await local.requestWorld();
    local.enterPortal();
    vi.spyOn(sim, 'getPhase').mockReturnValue('debrief');
    local.advance(TICK_MS * 2);
    expect(phases).toEqual(['expedition', 'debrief']);
    local.dispose();
  });
});

describe('generation HTTP streaming', () => {
  let server: RelayServer;
  let base: string;
  beforeAll(async () => {
    server = createRelayServer(loadServerConfig({
      env: { NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1' }, argv: [],
    }), { log: () => {} });
    base = `http://127.0.0.1:${(await server.listen()).port}`;
  });
  afterAll(async () => { await server.close(); });

  it('keeps JSON compatibility and streams honest fixture status/world records on opt-in', async () => {
    for (const accept of ['application/json', 'application/x-ndjson;q=0', 'application/x-ndjson']) {
      const response = await nativeFetch(`${base}/api/world`, {
        method: 'POST', headers: { Accept: accept }, body: JSON.stringify(request),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      if (accept === 'application/x-ndjson') {
        expect(response.headers.get('content-type')).toContain('application/x-ndjson');
        const records = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as { type: string; world?: unknown });
        expect(records.map((record) => record.type)).toEqual(['status', 'status', 'status', 'world']);
        expect(PreparedWorldSchema.parse(records.at(-1)!.world).provenance.source).toBe('fixture');
      } else {
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(PreparedWorldSchema.parse(await response.json()).rooms).toHaveLength(3);
      }
    }
  });

  it('delivers a first prefix before completion and aborts generation when the client disposes', async () => {
    const stopped = deferred<void>();
    let generationSignal: AbortSignal | undefined;
    vi.spyOn(server.generation, 'prepareWorldStream').mockImplementation(async function* (input, onStatus, signal) {
      generationSignal = signal;
      try {
        onStatus?.(status(input.requestId, 'generating'));
        yield (await prefixes(input))[0]!;
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally { stopped.resolve(); }
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, init) => nativeFetch(`${base}/api/world`, init)));
    const local = session(serverWorldProvider);
    expect((await local.requestWorld()).rooms).toHaveLength(1);
    local.enterPortal();
    expect(local.getPhase()).toBe('expedition');
    local.dispose();
    await stopped.promise;
    expect(generationSignal?.aborted).toBe(true);
    expect(local.getWorld()?.rooms).toHaveLength(1);
  });

  it('surfaces later generation failure without exposing internal errors or losing committed rooms', async () => {
    vi.spyOn(server.generation, 'prepareWorldStream').mockImplementation(async function* (input) {
      yield (await prefixes(input))[0]!;
      throw new Error('private provider diagnostics');
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, init) => nativeFetch(`${base}/api/world`, init)));
    const failed = deferred<GenerationStatus>();
    const local = session(serverWorldProvider);
    local.onGenerationStatus((value) => { if (value.phase === 'failed') failed.resolve(value); });
    const first = await local.requestWorld();
    const failure = await failed.promise;
    expect(failure.message).toContain('committed rooms remain playable');
    expect(failure.message).not.toContain('private provider diagnostics');
    expect(local.getWorld()).toEqual(first);
    local.enterPortal();
    expect(local.getPhase()).toBe('expedition');
    local.dispose();
  });
});
