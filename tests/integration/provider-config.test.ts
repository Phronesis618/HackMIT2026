import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreparedWorldSchema } from '../../src/shared/contracts';
import { createRelayServer } from '../../src/server/app';
import { describeForClient, loadServerConfig } from '../../src/server/config';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const nativeFetch = globalThis.fetch;
const env = {
  NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', RELAY_GENERATION_MODE: 'live',
  ANTHROPIC_API_KEY: ' claude-test-key ', OPENAI_API_KEY: ' openai-test-key ',
};

afterEach(() => vi.unstubAllGlobals());

describe('AI provider configuration', () => {
  it('selects Claude when its key is supplied and retains OpenAI-only configurations', () => {
    const claude = loadServerConfig({ env, argv: [] });
    expect(claude.generation).toMatchObject({
      provider: 'anthropic', anthropicApiKey: 'claude-test-key', anthropicModel: 'claude-sonnet-4-6',
    });
    const openai = loadServerConfig({ env: { ...env, ANTHROPIC_API_KEY: ' ' }, argv: [] });
    expect(openai.generation).toMatchObject({
      provider: 'openai', openaiApiKey: 'openai-test-key', openaiModel: 'gpt-5-mini',
    });
    expect(describeForClient(claude)).toEqual({ generationMode: 'live', liveGenerationAvailable: true });
    expect(describeForClient(openai)).toEqual({ generationMode: 'live', liveGenerationAvailable: true });
  });

  it('uses model overrides and keeps fixture mode opt-in to live calls', () => {
    const config = loadServerConfig({
      env: { ...env, RELAY_GENERATION_MODE: '', ANTHROPIC_MODEL: ' claude-custom ', OPENAI_MODEL: ' gpt-custom ' },
      argv: [],
    });
    expect(config.generation).toMatchObject({ anthropicModel: 'claude-custom', openaiModel: 'gpt-custom' });
    expect(describeForClient(config)).toEqual({ generationMode: 'fixture', liveGenerationAvailable: false });
  });

  it.each(['anthropic', 'openai'])('never borrows the other key when the selected %s key is missing; the offline composer covers live mode', (provider) => {
    const config = loadServerConfig({
      env: { ...env, RELAY_AI_PROVIDER: provider, [provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY']: '' },
      argv: [],
    });
    // The selected provider's own key is empty, so no paid API can be called...
    expect(provider === 'anthropic' ? config.generation.anthropicApiKey : config.generation.openaiApiKey).toBeNull();
    // ...yet live mode still produces a world from the crew's ideas: app.ts substitutes the
    // composer (labelled COMPOSED, never live). The client flag reflects that.
    expect(describeForClient(config)).toEqual({ generationMode: 'live', liveGenerationAvailable: true });
  });

  it('rejects a misspelled provider instead of silently using a different paid service', () => {
    expect(() => loadServerConfig({ env: { ...env, RELAY_AI_PROVIDER: 'antrhopic' }, argv: [] }))
      .toThrow('RELAY_AI_PROVIDER must be anthropic, openai, composer or operator.');
  });

  it.each(['anthropic', 'openai'])('routes HTTP generation to %s with both keys configured', async (provider) => {
    const config = loadServerConfig({ env: { ...env, RELAY_AI_PROVIDER: provider }, argv: [] });
    const { bible: _bible, ...recipe } = loadWorldFixtures(config.fixturesDir)[0]!.recipe; // legacy single-call shape: no bible
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(provider === 'anthropic' ? {
      type: 'message', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'world_recipe', input: recipe }],
    } : {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(recipe) }] }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const server = createRelayServer(config, { log: () => {} });
    try {
      const { port } = await server.listen();
      const base = `http://127.0.0.1:${port}`;
      const clientConfig = await (await nativeFetch(`${base}/api/config`)).json();
      expect(clientConfig).toEqual({ generationMode: 'live', liveGenerationAvailable: true });
      const health = await (await nativeFetch(`${base}/api/health`)).text();
      expect(health).not.toMatch(/claude-test-key|openai-test-key/);
      const response = await nativeFetch(`${base}/api/world`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'provider-http', sessionId: 'provider-session', contributions: [], plannedRoomCount: 3 }),
      });
      expect(response.status).toBe(200);
      const world = PreparedWorldSchema.parse(await response.json());
      expect(world.provenance).toMatchObject({
        source: 'live', model: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5-mini',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(provider === 'anthropic'
        ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses');
      expect(JSON.stringify(world)).not.toMatch(/claude-test-key|openai-test-key/);
    } finally {
      await server.close();
    }
  });
});
