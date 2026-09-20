/**
 * Composer provider — the offline composer behind the shared `RecipeProvider` interface,
 * so the generation service can use it as the primary provider (`RELAY_AI_PROVIDER=composer`)
 * or as the fallback for a failed live attempt. Output is labelled `procedural`, never `live`.
 */
import type { GenerationRequest } from '../../shared/contracts';
import { GenerationFailure, type RecipeProvider } from '../generation/provider';
import { composeWorld } from './compose';

export const COMPOSER_MODEL = 'relay-composer';

export interface ComposerProvider extends RecipeProvider {
  readonly source: 'procedural';
  readonly badge: 'COMPOSED';
}

export function createComposerProvider(options: { log?: (message: string) => void } = {}): ComposerProvider {
  return {
    source: 'procedural',
    badge: 'COMPOSED',
    async generate(request: GenerationRequest, _repair?: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      try {
        const { recipe, themes } = composeWorld(request);
        options.log?.(`composer: "${recipe.title}" (${themes.primary}${themes.secondary ? ` + ${themes.secondary}` : ''}) from ${request.contributions.length} idea(s)`);
        return { recipe };
      } catch (error) {
        throw new GenerationFailure(`Composer could not build a valid recipe: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
      }
    },
  };
}
