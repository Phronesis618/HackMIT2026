import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PreparedWorldSchema, WorldRecipeSchema, type GenerationRequest, type PreparedWorld } from '../../src/shared/contracts';
import { sampleContributions } from '../../src/shared/samples';
import { createGenerationService } from '../../src/server/generation';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const recipe = loadWorldFixtures(fixturesDir)[0]!.recipe;
const request: GenerationRequest = {
  requestId: 'claude-request', sessionId: 'claude-session', contributions: sampleContributions, plannedRoomCount: 3,
};
const tool = (input: unknown = recipe) => ({ type: 'tool_use', id: 'tool-test', name: 'world_recipe', input });
const response = (input: unknown = recipe) => Response.json({
  type: 'message', stop_reason: 'tool_use',
  content: [tool(input)], usage: { input_tokens: 420, output_tokens: 600 },
});

function service(fetchMock: typeof fetch, timeoutMs?: number, onUsage = vi.fn()) {
  return createGenerationService({
    mode: 'live', provider: 'anthropic', anthropicApiKey: 'claude-unit-test-key', anthropicModel: 'claude-test',
    openaiApiKey: 'unused-openai-key', openaiModel: 'gpt-test', fixturesDir,
    fetch: fetchMock, timeoutMs, onUsage, log: () => {},
  });
}

afterEach(() => vi.useRealTimers());

describe('Claude generation', () => {
  it('uses the Messages API and commits validated room prefixes with actual usage', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    const onUsage = vi.fn();
    const worlds: PreparedWorld[] = [];
    for await (const world of service(fetchMock, undefined, onUsage).prepareWorldStream(request)) worlds.push(world);
    const [url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.headers).toEqual({
      'x-api-key': 'claude-unit-test-key', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
    });
    expect(body).toMatchObject({
      model: 'claude-test', max_tokens: 6000,
      tools: [{ name: 'world_recipe', input_schema: z.toJSONSchema(WorldRecipeSchema, { target: 'draft-7' }) }],
      tool_choice: { type: 'tool', name: 'world_recipe', disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: JSON.stringify({
        plannedRoomCount: 3, contributions: sampleContributions.map(({ id, text }) => ({ id, text })),
      }) }],
    });
    expect(body.system).toContain('guardian');
    expect(JSON.stringify(body.messages)).not.toContain(sampleContributions[0]!.playerName);
    expect(JSON.stringify(body)).not.toContain('unused-openai-key');
    expect(worlds.map((world) => world.rooms.length)).toEqual([1, 2, 3]);
    expect(worlds[2]!.rooms.slice(0, 2)).toEqual(worlds[1]!.rooms);
    for (const world of worlds) {
      expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
      expect(world.provenance).toMatchObject({ source: 'live', model: 'claude-test', attempts: 1 });
      expect(JSON.stringify(world)).not.toContain('claude-unit-test-key');
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({ inputTokens: 420, outputTokens: 600, totalTokens: 1020 });
  });

  it('repairs invalid registry IDs once using the same Claude provider', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...recipe, motifIds: ['invented'] }))
      .mockResolvedValueOnce(response());
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'live', attempts: 2 });
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('repair');
    expect(fetchMock.mock.calls.every(([url]) => url === 'https://api.anthropic.com/v1/messages')).toBe(true);
  });

  it.each([
    { ...recipe, title: '<script>alert(1)</script>' },
    { ...recipe, rooms: [] },
    'not a recipe',
  ])('rejects unsafe or invalid tool input after one repair', async (input) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response(input));
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 2 });
    expect(world.receipt.lines.every((line) => !line.used)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { stop_reason: 'max_tokens', content: [tool()] },
    { stop_reason: 'refusal', content: [{ type: 'text', text: 'private refusal details' }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(recipe) }] },
    { stop_reason: 'tool_use', content: [{ ...tool(), name: 'unrequested_tool' }] },
    { stop_reason: 'tool_use', content: [tool(), tool()] },
    { stop_reason: 'tool_use', content: [] },
  ])('rejects incomplete, refused or unexpected responses without retry', async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ type: 'message', ...body }));
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 1 });
    expect(JSON.stringify(world)).not.toContain('private refusal details');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 429, 500])('falls back on HTTP %s without disclosing provider details', async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('private details', { status }));
    const world = await service(fetchMock).prepareWorld(request);
    expect(world.provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 1 });
    expect(world.provenance.notes.join(' ')).toContain(`HTTP ${status}`);
    expect(JSON.stringify(world)).not.toContain('private details');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('times out and aborts stalled requests', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = service(fetchMock, 100).prepareWorld(request);
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).provenance).toMatchObject({ source: 'live_fallback_fixture', attempts: 1 });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates cancellation while reading the response without fallback', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()));
    const controller = new AbortController();
    const pending = service(fetchMock).prepareWorld(request, undefined, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['fixture', 'live'] as const)('does not call either provider in %s mode with a missing Claude key', async (mode) => {
    const fetchMock = vi.fn<typeof fetch>();
    const instance = createGenerationService({
      mode, provider: 'anthropic', anthropicApiKey: ' ',
      openaiApiKey: 'unused-openai-key', openaiModel: 'gpt-test', fixturesDir, fetch: fetchMock, log: () => {},
    });
    const world = await instance.prepareWorld(request);
    expect(instance.info().liveConfigured).toBe(false);
    expect(world.provenance).toMatchObject({ source: 'fixture', attempts: 0 });
    if (mode === 'live') expect(world.provenance.notes.join(' ')).toContain('ANTHROPIC_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
