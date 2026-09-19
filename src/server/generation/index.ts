/**
 * Generation service boundary — OWNED BY AGENT B (feat/generation) from here on.
 *
 * Agent A's server (src/server/app.ts) calls `createGenerationService(...)` once and
 * then `prepareWorld(request, onStatus)` per request. B replaces the internals (live
 * OpenAI call -> WorldRecipe -> compiler -> RoomSpec/ArtRecipe) without touching the
 * server assembly. B must NOT start a second HTTP server.
 *
 */
import type { GenerationRequest, GenerationStatus, PreparedWorld } from '../../shared/contracts';
import type { GenerationMode } from '../config';
import { createFixtureGenerationService, loadWorldFixtures } from './fixtureService';
import { createLiveGenerationService } from './liveService';
import { createOpenAIProvider, type ProviderUsage } from './provider';

export interface GenerationServiceInfo {
  /** Mode requested by configuration. */
  requestedMode: GenerationMode;
  /** Mode that will actually be used for the next request. */
  effectiveMode: GenerationMode;
  liveConfigured: boolean;
  liveImplemented: boolean;
  fixtureIds: string[];
}

export interface GenerationService {
  prepareWorld(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal): Promise<PreparedWorld>;
  prepareWorldStream(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal): AsyncGenerator<PreparedWorld>;
  info(): GenerationServiceInfo;
}

export interface GenerationServiceOptions {
  mode: GenerationMode;
  openaiApiKey: string | null;
  openaiModel: string;
  fixturesDir: string;
  log?: (message: string) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onUsage?: (usage: ProviderUsage) => void;
}

export function createGenerationService(options: GenerationServiceOptions): GenerationService {
  const log = options.log ?? ((m: string) => console.log(`[generation] ${m}`));
  const fixtures = loadWorldFixtures(options.fixturesDir);
  if (fixtures.length === 0) {
    throw new Error(`No valid world fixtures found in ${options.fixturesDir}`);
  }

  const apiKey = options.openaiApiKey?.trim();
  const liveConfigured = options.mode === 'live' && Boolean(apiKey);
  const notes: string[] = [];
  if (options.mode === 'live' && !apiKey) {
    notes.push('Live generation requested but OPENAI_API_KEY is not set; serving offline fixture.');
  }
  for (const n of notes) log(n);
  log(`${liveConfigured ? 'live' : 'fixture'} mode; ${fixtures.length} fallback fixture(s) available.`);

  const fixtureService = createFixtureGenerationService({ fixtures, extraNotes: notes });
  const service = liveConfigured && apiKey
    ? createLiveGenerationService({
      provider: createOpenAIProvider({
        apiKey, model: options.openaiModel, fetch: options.fetch, timeoutMs: options.timeoutMs,
        onUsage: options.onUsage ?? ((usage) => log(`Provider tokens: input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens}`)),
      }),
      model: options.openaiModel, fixtures, log,
    })
    : {
      ...fixtureService,
      async *prepareWorldStream(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal) {
        const world = await fixtureService.prepareWorld(request, onStatus, signal);
        signal?.throwIfAborted();
        yield world;
      },
    };

  return {
    ...service,
    info: () => ({
      requestedMode: options.mode,
      effectiveMode: liveConfigured ? 'live' : 'fixture',
      liveConfigured,
      liveImplemented: true,
      fixtureIds: fixtures.map((f) => f.fixtureId),
    }),
  };
}

export { createFixtureGenerationService, loadWorldFixtures } from './fixtureService';
export { buildReceipt } from './receipt';
export { compileWorldRecipe, type CompiledWorldRecipe, type CompileWorldRecipeOptions } from './compiler';
