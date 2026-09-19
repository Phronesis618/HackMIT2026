/**
 * Generation service boundary — OWNED BY AGENT B (feat/generation) from here on.
 *
 * Agent A's server (src/server/app.ts) calls `createGenerationService(...)` once and
 * then `prepareWorld(request, onStatus)` per request. B replaces the internals (live
 * OpenAI call -> WorldRecipe -> compiler -> RoomSpec/ArtRecipe) without touching the
 * server assembly. B must NOT start a second HTTP server.
 *
 * Foundation behaviour: always the validated offline fixture, labelled as such.
 * If live mode is requested, the service still returns a fixture and says why in
 * provenance.notes — it never pretends a model call happened.
 */
import type { GenerationRequest, GenerationStatus, PreparedWorld } from '../../shared/contracts';
import type { GenerationMode } from '../config';
import { createFixtureGenerationService, loadWorldFixtures } from './fixtureService';

export interface GenerationServiceInfo {
  /** Mode requested by configuration. */
  requestedMode: GenerationMode;
  /** Mode that will actually be used for the next request. */
  effectiveMode: GenerationMode;
  liveConfigured: boolean;
  /** false until Agent B lands the live provider. */
  liveImplemented: boolean;
  fixtureIds: string[];
}

export interface GenerationService {
  prepareWorld(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void): Promise<PreparedWorld>;
  info(): GenerationServiceInfo;
}

export interface GenerationServiceOptions {
  mode: GenerationMode;
  openaiApiKey: string | null;
  openaiModel: string;
  fixturesDir: string;
  log?: (message: string) => void;
}

export function createGenerationService(options: GenerationServiceOptions): GenerationService {
  const log = options.log ?? ((m: string) => console.log(`[generation] ${m}`));
  const fixtures = loadWorldFixtures(options.fixturesDir);
  if (fixtures.length === 0) {
    throw new Error(`No valid world fixtures found in ${options.fixturesDir}`);
  }

  const liveConfigured = options.mode === 'live' && options.openaiApiKey !== null;
  const notes: string[] = [];
  if (options.mode === 'live' && !options.openaiApiKey) {
    notes.push('Live generation requested but OPENAI_API_KEY is not set; serving offline fixture.');
  } else if (options.mode === 'live') {
    notes.push('Live provider not implemented yet (Agent B, feat/generation); serving offline fixture.');
  }
  for (const n of notes) log(n);
  log(`fixture mode; ${fixtures.length} fixture(s): ${fixtures.map((f) => f.fixtureId).join(', ')}`);

  const fixtureService = createFixtureGenerationService({ fixtures, extraNotes: notes });

  return {
    prepareWorld: fixtureService.prepareWorld,
    info: () => ({
      requestedMode: options.mode,
      effectiveMode: 'fixture',
      liveConfigured,
      liveImplemented: false,
      fixtureIds: fixtures.map((f) => f.fixtureId),
    }),
  };
}

export { createFixtureGenerationService, loadWorldFixtures } from './fixtureService';
export { buildReceipt } from './receipt';
export { compileWorldRecipe, type CompiledWorldRecipe, type CompileWorldRecipeOptions } from './compiler';
