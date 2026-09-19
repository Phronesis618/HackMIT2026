import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  GenerationStatusSchema, PreparedWorldSchema, WorldRecipeSchema,
  type GenerationRequest, type GenerationStatus, type PreparedWorld, type WorldRecipe,
} from '../../src/shared/contracts';
import { MOTIF_IDS, PROP_IDS, ENEMY_IDS } from '../../src/shared/registry';
import { sampleContributions } from '../../src/shared/samples';
import { createGenerationService } from '../../src/server/generation';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const request: GenerationRequest = {
  requestId: 'live-req', sessionId: 'session-test', contributions: sampleContributions, plannedRoomCount: 3,
};
const fixture = loadWorldFixtures(fixturesDir).find((world) => world.fixtureId === 'vantage-spire')!;
const recipe: WorldRecipe = {
  ...fixture.recipe,
  title: 'Generated Observatory',
  contributionMappings: [
    { contributionId: sampleContributions[0]!.id, kind: 'prop', featureDescription: 'Lanterns', roomIndex: 0 },
  ],
};
const response = (value: unknown = recipe) => Response.json({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 420, output_tokens: 600, total_tokens: 1020 },
});

function service(fetchMock: typeof fetch, timeoutMs?: number) {
  return createGenerationService({
    mode: 'live', openaiApiKey: 'unit-test-only-key', openaiModel: 'gpt-test', fixturesDir,
    fetch: fetchMock, timeoutMs, log: () => {},
  });
}

afterEach(() => vi.useRealTimers());

describe('live generation', () => {
  it('sends a strict derived schema, runtime registries, bounded tokens and private request data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    const statuses: GenerationStatus[] = [];
    const world = await service(fetchMock).prepareWorld(request, (status) => statuses.push(status));
    const [url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body).toMatchObject({
      store: false, max_output_tokens: 6000,
      text: { format: { strict: true, type: 'json_schema', schema: z.toJSONSchema(WorldRecipeSchema, { target: 'draft-7' }) } },
    });
    for (const id of [...MOTIF_IDS, ...PROP_IDS, ...ENEMY_IDS]) expect(body.instructions).toContain(id);
    expect(String(body.input)).not.toContain(sampleContributions[0]!.playerName);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
    expect(world.provenance).toMatchObject({ source: 'live', model: 'gpt-test', attempts: 1 });
    expect(world.recipe.title).toBe('Generated Observatory');
    expect(world.rooms).not.toEqual(fixture.rooms);
    expect(world.receipt.lines[0]).toMatchObject({ used: true, featureDescription: 'lantern in “Threshold Concourse”.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses[0]?.phase).toBe('queued');
    expect(statuses.some((status) => status.phase === 'generating')).toBe(true);
    expect(statuses.at(-1)?.phase).toBe('ready');
    for (const status of statuses) expect(GenerationStatusSchema.safeParse(status).success).toBe(true);
    expect(JSON.stringify(world)).not.toContain('unit-test-only-key');
  });

  it('repairs an unknown registry ID once and records both attempts', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...recipe, motifIds: ['invented-motif'] }))
      .mockResolvedValueOnce(response());
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'live', attempts: 2 });
    expect(world.provenance.notes.join(' ')).toContain('schema validation');
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('repair');
  });

  it('falls back after one failed repair without attributing fixture features', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response({ ...recipe, motifIds: ['bad'] }));
    const statuses: GenerationStatus[] = [];
    const world = await service(fetchMock).prepareWorld(request, (status) => statuses.push(status));
    expect(world.provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 2 });
    expect(world.receipt.lines.every((line) => !line.used)).toBe(true);
    expect(statuses.at(-1)?.phase).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 429, 500])('falls back on HTTP %s without copying response bodies or retrying', async (httpStatus) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider details', { status: httpStatus }));
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 1 });
    expect(world.provenance.notes.join(' ')).toContain(`HTTP ${httpStatus}`);
    expect(JSON.stringify(world)).not.toContain('private provider details');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled provider and aborts the request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = service(fetchMock, 25_000).prepareWorld(request);
    await vi.advanceTimersByTimeAsync(25_000);
    const world = await pending;
    expect(world.provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 1, durationMs: 25_000 });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds reading a stalled response body', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()));
    const pending = service(fetchMock, 100).prepareWorld(request);
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).provenance.source).toBe('live_fallback_fixture');
  });

  it.each(['request', 'body'] as const)('cancels a stalled provider %s without fallback or retry', async (stage) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>();
    if (stage === 'request') fetchMock.mockImplementation(() => new Promise(() => {}));
    else fetchMock.mockResolvedValue(new Response(new ReadableStream()));
    const controller = new AbortController();
    const statuses: GenerationStatus[] = [];
    const pending = service(fetchMock).prepareWorld(request, (status) => statuses.push(status), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(statuses.some((status) => status.phase === 'fallback' || status.phase === 'ready')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops compilation between committed rooms after cancellation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    const controller = new AbortController();
    const stream = service(fetchMock).prepareWorldStream(request, undefined, controller.signal);
    expect((await stream.next()).value?.rooms).toHaveLength(1);
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{bad' }] }] },
  ])('handles incomplete, refused, or malformed output', async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body));
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance.source).toBe('live_fallback_fixture');
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('rejects markup, code and URLs even in schema-valid text', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response({ ...recipe, title: '<script>alert(1)</script>' }));
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance.source).toBe('live_fallback_fixture');
    expect(world.provenance.notes.join(' ')).toContain('markup');
  });

  it('drops invented contribution IDs and mappings without actual features', async () => {
    const noHazards: WorldRecipe = {
      ...recipe,
      rooms: recipe.rooms.map((room) => ({ ...room, hazards: false, propIds: [] })),
      contributionMappings: [
        { contributionId: 'fictional-player', kind: 'name', roomIndex: 0, featureDescription: 'Fiction' },
        { contributionId: sampleContributions[0]!.id, kind: 'prop', roomIndex: 0, featureDescription: 'Absent' },
        { contributionId: sampleContributions[1]!.id, kind: 'hazard', roomIndex: 0, featureDescription: 'Absent' },
      ],
    };
    const world = await service(async () => response(noHazards)).prepareWorld(request);
    expect(world.recipe.contributionMappings).toEqual([]);
    expect(world.rooms.flatMap((room) => room.attributions)).toEqual([]);
    expect(world.receipt.lines.every((line) => !line.used)).toBe(true);
  });

  it('commits room zero first and appends immutable rooms with one model call', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    const stream = service(fetchMock).prepareWorldStream(request);
    const first = (await stream.next()).value as PreparedWorld;
    const saved = structuredClone(first);
    expect(first.rooms).toHaveLength(1);
    expect(first.rooms[0]!.isFinal).toBe(false);
    const second = (await stream.next()).value as PreparedWorld;
    const third = (await stream.next()).value as PreparedWorld;
    expect(first).toEqual(saved);
    expect(second.rooms[0]).toEqual(first.rooms[0]);
    expect(third.rooms.slice(0, 2)).toEqual(second.rooms);
    expect(third.worldId).toBe(first.worldId);
    expect(third.rooms[2]!.isFinal).toBe(true);
    expect((await stream.next()).done).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const world of [first, second, third]) expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
  });

  it('never calls the provider without a key, including a blank key', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const instance = createGenerationService({
      mode: 'live', openaiApiKey: ' ', openaiModel: 'gpt-test', fixturesDir, fetch: fetchMock, log: () => {},
    });
    const world = await instance.prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'fixture', attempts: 0 });
    expect(world.provenance.notes.join(' ')).toContain('OPENAI_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])('honors a %s-room request in live and fallback modes', async (plannedRoomCount) => {
    for (const fetchMock of [async () => response(), async () => new Response(null, { status: 500 })]) {
      const world = await service(fetchMock).prepareWorld({ ...request, plannedRoomCount });
      expect(world.rooms).toHaveLength(plannedRoomCount);
      expect(world.rooms.at(-1)?.isFinal).toBe(true);
      expect(world.plannedRoomCount).toBe(plannedRoomCount);
      expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
    }
  });

  it('reports actual provider usage without mixing in fixture metrics', async () => {
    const onUsage = vi.fn();
    const instance = createGenerationService({
      mode: 'live', openaiApiKey: 'unit-test-only-key', openaiModel: 'gpt-test', fixturesDir,
      fetch: async () => response(), log: () => {}, onUsage,
    });
    await instance.prepareWorld(request);
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({ inputTokens: 420, outputTokens: 600, totalTokens: 1020 });
  });

  it('validates requests before calling the provider and isolates concurrent worlds', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const instance = service(fetchMock);
    await expect(instance.prepareWorld({ ...request, requestId: 'bad id' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    const [one, two] = await Promise.all([
      instance.prepareWorld(request),
      instance.prepareWorld({ ...request, requestId: 'second-request', contributions: [] }),
    ]);
    expect(one.worldId).not.toBe(two.worldId);
    expect(two.recipe.contributionMappings).toEqual([]);
    expect(two.receipt.lines).toEqual([]);
  });
});
