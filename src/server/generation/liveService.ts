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
      status('generating', repair ? 'Repairing the generated recipe…' : 'Generating a world from your ideas…');
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
          worldId: `world-live-${hashString(`${request.sessionId}:${request.requestId}`).toString(36)}`,
          createdAt: generatedAt,
          recipe: { ...recipe, contributionMappings: mappings },
          rooms,
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
      });
    } catch {
      signal?.throwIfAborted();
      notes.push('Generated world failed compiler validation.');
      yield fallback();
      return;
    }
    for (const world of worlds) {
      signal?.throwIfAborted();
      status('ready', `Live world ready: ${world.rooms.length}/${request.plannedRoomCount} rooms committed.`);
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
