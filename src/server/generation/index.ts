/**
 * Generation service boundary — OWNED BY AGENT B (feat/generation) from here on.
 *
 * Agent A's server (src/server/app.ts) calls `createGenerationService(...)` once and
 * then `prepareWorld(request, onStatus)` per request. B replaces the internals (live
 * model call -> WorldRecipe -> compiler -> RoomSpec/ArtRecipe) without touching the
 * server assembly. B must NOT start a second HTTP server.
 *
 */
import type { GenerationRequest, GenerationStatus, PreparedWorld } from '../../shared/contracts';
import { DEFAULT_ANTHROPIC_MODEL, type AIProvider, type GenerationMode } from '../config';
import { createFixtureGenerationService, loadWorldFixtures } from './fixtureService';
import { createLiveGenerationService } from './liveService';
import { createAnthropicProvider, createOpenAIProvider, type ProviderUsage, type RecipeProvider } from './provider';

export interface GenerationServiceInfo {
  /** Mode requested by configuration. */
  requestedMode: GenerationMode;
  /** Mode that will actually be used for the next request. */
  effectiveMode: GenerationMode;
  liveConfigured: boolean;
  liveImplemented: boolean;
  fixtureIds: string[];
  /** Which provider serves live requests: anthropic | openai | operator (demo inbox). */
  provider: string;
}

export interface GenerationService {
  prepareWorld(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal): Promise<PreparedWorld>;
  prepareWorldStream(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal): AsyncGenerator<PreparedWorld>;
  info(): GenerationServiceInfo;
}

export interface GenerationServiceOptions {
  mode: GenerationMode;
  provider?: AIProvider;
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  openaiApiKey: string | null;
  openaiModel: string;
  fixturesDir: string;
  log?: (message: string) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onUsage?: (usage: ProviderUsage) => void;
  /**
   * A pre-built provider that replaces the API providers when mode is `live` (no key needed).
   * Used by Agent A's demo-only operator inbox (src/server/operator). `model` is the label
   * that ends up in provenance ("LIVE · <model>").
   */
  recipeProvider?: { provider: RecipeProvider; model: string };
  /** Instant provider used instead of a static fixture when the primary provider fails. */
  fallbackProvider?: RecipeProvider;
}

export function createGenerationService(options: GenerationServiceOptions): GenerationService {
  const log = options.log ?? ((m: string) => console.log(`[generation] ${m}`));
  const fixtures = loadWorldFixtures(options.fixturesDir);
  if (fixtures.length === 0) {
    throw new Error(`No valid world fixtures found in ${options.fixturesDir}`);
  }

  const custom = options.recipeProvider;
  const provider = custom ? options.provider ?? 'custom' : options.provider ?? (options.anthropicApiKey?.trim() ? 'anthropic' : 'openai');
  const apiKey = custom ? undefined : (provider === 'anthropic' ? options.anthropicApiKey : options.openaiApiKey)?.trim();
  const model = custom ? custom.model : provider === 'anthropic' ? options.anthropicModel?.trim() || DEFAULT_ANTHROPIC_MODEL : options.openaiModel;
  const liveConfigured = options.mode === 'live' && (Boolean(custom) || Boolean(apiKey));
  const notes: string[] = [];
  if (options.mode === 'live' && !custom && !apiKey) {
    const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    notes.push(`Live generation requested but ${keyName} is not set; serving offline fixture.`);
  }
  for (const n of notes) log(n);
  log(`${liveConfigured ? 'live' : 'fixture'} mode; provider=${provider}; ${fixtures.length} fallback fixture(s) available.`);

  const fixtureService = createFixtureGenerationService({ fixtures, extraNotes: notes });
  const service = liveConfigured && (custom || apiKey)
    ? createLiveGenerationService({
      provider: custom ? custom.provider : (provider === 'anthropic' ? createAnthropicProvider : createOpenAIProvider)({
        apiKey: apiKey!, model, fetch: options.fetch, timeoutMs: options.timeoutMs,
        onUsage: options.onUsage ?? ((usage) => log(`Provider tokens: input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens}`)),
      }),
      model, fixtures, log,
      ...(options.fallbackProvider ? { fallbackProvider: options.fallbackProvider } : {}),
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
      provider,
    }),
  };
}

export { createFixtureGenerationService, loadWorldFixtures } from './fixtureService';
export { buildReceipt } from './receipt';
export { compileWorldRecipe, type CompiledWorldRecipe, type CompileWorldRecipeOptions } from './compiler';
