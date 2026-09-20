import {
  GenerationRequestSchema,
  PreparedWorldSchema,
  type GenerationRequest,
  type GenerationStatus,
  type PreparedWorld,
  type WorldFixture,
} from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import { compileWorldRecipe } from './compiler';
import { prepareFromFixture } from './fixtureService';
import { GenerationFailure, type RecipeProvider } from './provider';
import { DEFAULT_WORLD_BUDGET_MS, generateRecipe, type CallMetric, type GeneratedRecipe, type GenerationMetrics } from './pipeline';
import { buildReceipt } from './receipt';

export function createLiveGenerationService(options: {
  provider: RecipeProvider;
  model: string;
  fixtures: WorldFixture[];
  log: (message: string) => void;
  /** Floors default when the request does not say (mirrors RELAY_FLOORS): the model then writes the 8 biome briefs. */
  floors?: boolean;
  /** Wall-clock budget for all model calls of one world; call-2 work still running at the deadline is dropped. */
  worldBudgetMs?: number;
  /** Per-world measurements (latency per call, tokens, lint before/after). Used by scripts/eval-worldgen.ts. */
  onMetrics?: (metrics: GenerationMetrics) => void;
  /** Every model call as it finishes, including failed ones and worlds that end in a fallback. */
  onCall?: (metric: CallMetric) => void;
}) {
  async function* prepareWorldStream(
    rawRequest: GenerationRequest,
    onStatus?: (status: GenerationStatus) => void,
    signal?: AbortSignal,
  ): AsyncGenerator<PreparedWorld> {
    signal?.throwIfAborted();
    const request = GenerationRequestSchema.parse(rawRequest);
    const startedAt = Date.now();
    const seed = request.seed ?? hashString(request.requestId);
    const status = (phase: GenerationStatus['phase'], message: string): void =>
      onStatus?.({ phase, message, requestId: request.requestId, startedAt, elapsedMs: Math.max(0, Date.now() - startedAt) });
    status('queued', 'Preparing live world generation…');
    const notes: string[] = [];
    let attempts = 0;
    const worldId = `world-live-${hashString(`${request.sessionId}:${request.requestId}`).toString(36)}`;
    const fallback = (): PreparedWorld => {
      const world = prepareFromFixture({
        fixture: options.fixtures[seed % options.fixtures.length]!,
        request, source: 'live_fallback_fixture', attempts, startedAt, notes, model: options.model.slice(0, 80),
      });
      options.log(`Fallback after ${attempts} request(s): ${notes.join(' ')}`);
      status('fallback', 'Live generation failed; a labelled offline fixture is ready.');
      return world;
    };
    let generated: GeneratedRecipe | undefined;
    try {
      generated = await generateRecipe({
        provider: options.provider, request, seed, signal, notes, status,
        floors: request.floors ?? options.floors ?? false,
        budgetMs: options.worldBudgetMs ?? DEFAULT_WORLD_BUDGET_MS,
        startedAt,
        floorsSeed: request.seed === undefined ? worldId : String(request.seed),
        countCall: () => { attempts++; },
        onCall: options.onCall,
      });
    } catch (error) {
      signal?.throwIfAborted();
      notes.push((error instanceof GenerationFailure ? error : new GenerationFailure('Live generation failed.')).message);
    }
    if (generated) {
      options.onMetrics?.(generated.metrics);
      const { lint } = generated.metrics;
      options.log(`Prose lint: score ${lint.before.score} -> ${lint.after.score}, failing fields ${lint.before.failedFields} -> ${lint.after.failedFields}, ${attempts} model call(s).`);
    }
    const result = generated;
    if (!result) {
      yield fallback();
      return;
    }
    const ids = new Set(request.contributions.map((contribution) => contribution.id));
    const recipe = {
      ...result.recipe,
      contributionMappings: result.recipe.contributionMappings.filter((mapping) => ids.has(mapping.contributionId)),
    };
    if (recipe.contributionMappings.length !== result.recipe.contributionMappings.length) {
      notes.push('Removed mappings to contribution IDs absent from this request.');
    }
    const generatedAt = Date.now();
    let committedRoomCount = 1;
    try {
      for (; committedRoomCount <= request.plannedRoomCount; committedRoomCount++) {
        signal?.throwIfAborted();
        status('validating', `Compiling and validating room ${committedRoomCount}…`);
        const compiled = compileWorldRecipe(recipe, { plannedRoomCount: request.plannedRoomCount, seed, committedRoomCount });
        const mappings = compiled.rooms.flatMap((room) => room.attributions.map((attribution) => ({
          contributionId: attribution.contributionId,
          kind: attribution.kind,
          featureDescription: attribution.featureDescription,
          roomIndex: room.index,
        })));
        const world = PreparedWorldSchema.parse({
          worldId,
          createdAt: generatedAt,
          recipe: { ...recipe, contributionMappings: mappings },
          rooms: compiled.rooms,
          art: compiled.art,
          plannedRoomCount: request.plannedRoomCount,
          provenance: {
            source: 'live',
            label: `LIVE · ${options.model}`.slice(0, 80),
            model: options.model.slice(0, 80),
            generatedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
            attempts,
            notes: [...notes, ...compiled.notes].slice(0, 10),
          },
          receipt: buildReceipt({ worldTitle: recipe.title, source: 'live', contributions: request.contributions, mappings }),
        });
        status('ready', `Live world ready: ${committedRoomCount}/${request.plannedRoomCount} rooms committed.`);
        yield world;
      }
    } catch {
      signal?.throwIfAborted();
      if (committedRoomCount > 1) {
        status('failed', 'Later-room compilation failed; committed rooms are unchanged.');
        throw new GenerationFailure('Later-room compilation failed.');
      }
      notes.push('Generated world failed compiler validation.');
      yield fallback();
    }
  }

  return {
    prepareWorldStream,
    async prepareWorld(request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal): Promise<PreparedWorld> {
      let world: PreparedWorld | undefined;
      for await (const committed of prepareWorldStream(request, onStatus, signal)) world = committed;
      if (!world) throw new Error('Generation produced no world.');
      return world;
    },
  };
}
