import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type GenerationRequest, PreparedWorldSchema } from '../../src/shared/contracts';
import { createGenerationService, loadWorldFixtures } from '../../src/server/generation';
import { GenerationFailure, type RecipeProvider } from '../../src/server/generation/provider';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const recipe = loadWorldFixtures(fixturesDir)[0]!.recipe;
const request: GenerationRequest = {
  requestId: 'bughunt-floors', sessionId: 'bughunt-session', contributions: [], plannedRoomCount: 3, seed: 0,
};

describe('effective floors mode at provider boundaries', () => {
  it.each([undefined, false, true])('passes the server default with request override %s to a single-call provider', async (floors) => {
    const generate = vi.fn<RecipeProvider['generate']>().mockResolvedValue({ recipe });
    const service = createGenerationService({
      mode: 'live', floors: true, openaiApiKey: null, openaiModel: 'unused', fixturesDir, log: () => {},
      recipeProvider: { provider: { generate }, model: 'mock-operator' },
    });
    const world = await service.prepareWorld({ ...request, ...(floors === undefined ? {} : { floors }) });
    expect(generate.mock.calls[0]?.[0].floors).toBe(floors ?? true);
    expect(Boolean(PreparedWorldSchema.parse(world).floors)).toBe(floors ?? true);
    expect(world.provenance.source).toBe('live');
  });

  it('passes the effective floors mode to the fallback provider too', async () => {
    const generate = vi.fn<RecipeProvider['generate']>().mockResolvedValue({ recipe });
    const service = createGenerationService({
      mode: 'live', floors: true, openaiApiKey: null, openaiModel: 'unused', fixturesDir, log: () => {},
      recipeProvider: { provider: { generate: async () => { throw new GenerationFailure('Mock outage.'); } }, model: 'mock' },
      fallbackProvider: { source: 'procedural', badge: 'COMPOSED', generate },
    });
    const world = await service.prepareWorld(request);
    expect(generate.mock.calls[0]?.[0].floors).toBe(true);
    expect(PreparedWorldSchema.parse(world).floors).toBeDefined();
    expect(world.provenance.source).toBe('procedural');
  });
});
