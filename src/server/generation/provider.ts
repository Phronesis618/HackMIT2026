import fs from 'node:fs';
import { z } from 'zod';
import { WorldRecipeSchema, type GenerationRequest, type WorldRecipe } from '../../shared/contracts';
import { ENEMY_IDS, MOTIF_IDS, PROP_IDS } from '../../shared/registry';

const responseSchema = z.object({
  status: z.literal('completed'),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('output_text'), text: z.string().max(80_000) }),
      z.object({ type: z.literal('refusal'), refusal: z.string() }),
    ])).optional(),
  })),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).optional(),
});

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export class GenerationFailure extends Error {
  constructor(message: string, readonly repairable = false) {
    super(message);
  }
}

export interface RecipeProvider {
  generate(request: GenerationRequest, repair?: string): Promise<{ recipe: WorldRecipe; usage?: ProviderUsage }>;
}

export function createOpenAIProvider(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onUsage?: (usage: ProviderUsage) => void;
}): RecipeProvider {
  const instructions = fs.readFileSync(new URL('../../../prompts/runtime/world-recipe.md', import.meta.url), 'utf8')
    .replace('{{registry}}', JSON.stringify({ motifIds: MOTIF_IDS, propIds: PROP_IDS, enemyIds: ENEMY_IDS }));
  const schema = z.toJSONSchema(WorldRecipeSchema, { target: 'draft-7' });
  const fetchResponse = options.fetch ?? fetch;
  const timeoutMs = Math.min(25_000, Math.max(1, options.timeoutMs ?? 25_000));

  return {
    async generate(request, repair) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GenerationFailure(`Provider timeout after ${timeoutMs}ms.`));
          controller.abort();
        }, timeoutMs);
      });
      try {
        return await Promise.race([timeout, (async () => {
          const response = await fetchResponse('https://api.openai.com/v1/responses', {
            method: 'POST',
            signal: controller.signal,
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: options.model,
              store: false,
              max_output_tokens: 6_000,
              instructions,
              input: JSON.stringify({
                plannedRoomCount: request.plannedRoomCount,
                contributions: request.contributions.map(({ id, text }) => ({ id, text })),
                ...(repair ? { repair } : {}),
              }),
              text: { format: { type: 'json_schema', name: 'world_recipe', strict: true, schema } },
            }),
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new GenerationFailure(`Provider HTTP ${response.status}.`);
          }
          const envelope = responseSchema.safeParse(await response.json());
          if (!envelope.success) throw new GenerationFailure('Provider response was incomplete or invalid.');
          const usage = envelope.data.usage;
          const measured = usage ? {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.total_tokens,
          } : undefined;
          if (measured) options.onUsage?.(measured);
          const content = envelope.data.output.flatMap((item) => item.type === 'message' ? item.content ?? [] : []);
          if (content.some((item) => item.type === 'refusal')) throw new GenerationFailure('Provider refused the generation request.');
          const text = content.filter((item) => item.type === 'output_text').map((item) => item.text).join('');
          let raw: unknown;
          try {
            raw = JSON.parse(text) as unknown;
          } catch {
            throw new GenerationFailure('Recipe was not valid JSON.', true);
          }
          const parsed = WorldRecipeSchema.safeParse(raw);
          if (!parsed.success) {
            const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 4).join(', ');
            throw new GenerationFailure(`Recipe failed schema validation at ${paths}.`.slice(0, 200), true);
          }
          assertDisplayText(parsed.data);
          return { recipe: parsed.data, ...(measured ? { usage: measured } : {}) };
        })()]);
      } catch (error) {
        if (error instanceof GenerationFailure) throw error;
        throw new GenerationFailure('Provider request or response could not be read.');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function assertDisplayText(recipe: WorldRecipe): void {
  const text = [
    recipe.title, recipe.tagline, recipe.themeSummary,
    ...recipe.rooms.flatMap((room) => [room.name, room.description]),
    ...recipe.contributionMappings.map((mapping) => mapping.featureDescription),
  ];
  if (text.some((value) => /[<>]|```|(?:https?:\/\/|www\.|data:|javascript:)|\b(?:eval|function)\s*\(/i.test(value))) {
    throw new GenerationFailure('Recipe text contained markup, a URL, or code.', true);
  }
}
