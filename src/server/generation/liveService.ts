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
import { buildReceipt } from './receipt';

export function createLiveGenerationService(options: {
  provider: RecipeProvider;
  model: string;
  fixtures: WorldFixture[];
  log: (message: string) => void;
  /**
   * Optional instant provider (the offline composer) used instead of a static fixture when
   * the primary provider fails, so players still get a world shaped by their ideas. Its
   * output is labelled with the fallback provider's own source (`procedural`), never `live`.
   */
  fallbackProvider?: RecipeProvider;
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
    const primarySource = options.provider.source ?? 'live';
    const primaryBadge = options.provider.badge ?? 'LIVE';
    status('queued', primarySource === 'procedural' ? 'Composing a world from your ideas…' : 'Preparing live world generation…');
    const notes: string[] = [];
    let attempts = 0;
    let source = primarySource;
    let badge = primaryBadge;
    let model = options.model;
    const fallback = (): PreparedWorld => {
      const world = prepareFromFixture({
        fixture: options.fixtures[seed % options.fixtures.length]!,
        request, source: 'live_fallback_fixture', attempts, startedAt, notes, model: options.model.slice(0, 80),
      });
      options.log(`Fallback after ${attempts} request(s): ${notes.join(' ')}`);
      status('fallback', 'Live generation failed; a labelled offline fixture is ready.');
      return world;
    };
    let repair: string | undefined;
    let result: Awaited<ReturnType<RecipeProvider['generate']>> | undefined;
    while (attempts < 2) {
      attempts++;
      status('generating', repair ? 'Repairing the generated recipe…' : primarySource === 'procedural' ? 'Composing a world from your ideas…' : 'Generating a world from your ideas…');
      try {
        result = await options.provider.generate(request, repair, signal);
        signal?.throwIfAborted();
        break;
      } catch (error) {
        signal?.throwIfAborted();
        const failure = error instanceof GenerationFailure ? error : new GenerationFailure('Live generation failed.');
        notes.push(failure.message);
        if (!failure.repairable || attempts === 2) break;
        repair = failure.message;
        status('validating', 'Recipe rejected; requesting one bounded repair…');
      }
    }
    if (!result && options.fallbackProvider && options.fallbackProvider !== options.provider) {
      try {
        status('generating', 'Live generation failed; composing a world from your ideas instead…');
        result = await options.fallbackProvider.generate(request, undefined, signal);
        signal?.throwIfAborted();
        source = options.fallbackProvider.source ?? 'procedural';
        badge = options.fallbackProvider.badge ?? 'COMPOSED';
        model = 'relay-composer';
        notes.push('Live generation failed; the offline composer built this world from the same ideas (no model call).');
        options.log(`Composer fallback after ${attempts} live request(s): ${notes.join(' ')}`);
      } catch (error) {
        signal?.throwIfAborted();
        notes.push(error instanceof GenerationFailure ? error.message : 'Composer fallback failed.');
        result = undefined;
      }
    }
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
    let worlds: PreparedWorld[];
    try {
      signal?.throwIfAborted();
      status('validating', `Compiling and validating all ${request.plannedRoomCount} planned rooms…`);
      const compiled = compileWorldRecipe(recipe, { plannedRoomCount: request.plannedRoomCount, seed });
      worlds = compiled.rooms.map((_, index) => {
        const rooms = compiled.rooms.slice(0, index + 1);
        const mappings = rooms.flatMap((room) => room.attributions.map((attribution) => ({
          contributionId: attribution.contributionId,
          kind: attribution.kind,
          featureDescription: attribution.featureDescription,
          roomIndex: room.index,
        })));
        return PreparedWorldSchema.parse({
          worldId: `world-${source === 'live' ? 'live' : 'composed'}-${hashString(`${request.sessionId}:${request.requestId}`).toString(36)}`,
          createdAt: generatedAt,
          recipe: { ...recipe, contributionMappings: mappings },
          rooms,
          art: compiled.art,
          plannedRoomCount: request.plannedRoomCount,
          provenance: {
            source,
            label: `${badge} · ${model}`.slice(0, 80),
            model: model.slice(0, 80),
            generatedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
            attempts,
            notes: [...notes, ...compiled.notes].slice(0, 10),
          },
          receipt: buildReceipt({ worldTitle: recipe.title, source, contributions: request.contributions, mappings }),
        });
      });
    } catch {
      signal?.throwIfAborted();
      notes.push('Generated world failed compiler validation.');
      yield fallback();
      return;
    }
    for (const world of worlds) {
      signal?.throwIfAborted();
      status('ready', `${source === 'live' ? 'Live' : 'Composed'} world ready: ${world.rooms.length}/${request.plannedRoomCount} rooms committed.`);
      yield world;
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
