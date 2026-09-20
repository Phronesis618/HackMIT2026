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

const anthropicResponseSchema = z.object({
  type: z.literal('message'),
  stop_reason: z.string(),
  content: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().max(80_000) }),
    z.object({ type: z.literal('tool_use'), name: z.string(), input: z.unknown() }),
  ])),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
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
  generate(request: GenerationRequest, repair?: string, signal?: AbortSignal): Promise<{ recipe: WorldRecipe; usage?: ProviderUsage }>;
}

interface ProviderOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onUsage?: (usage: ProviderUsage) => void;
}

export function createOpenAIProvider(options: ProviderOptions): RecipeProvider {
  return createRecipeProvider(options, 'openai');
}

export function createAnthropicProvider(options: ProviderOptions): RecipeProvider {
  return createRecipeProvider(options, 'anthropic');
}

function createRecipeProvider(options: ProviderOptions, provider: 'openai' | 'anthropic'): RecipeProvider {
  const instructions = fs.readFileSync(new URL('../../../prompts/runtime/world-recipe.md', import.meta.url), 'utf8')
    .replace('{{registry}}', JSON.stringify({ motifIds: MOTIF_IDS, propIds: PROP_IDS, enemyIds: ENEMY_IDS }));
  const schema = z.toJSONSchema(WorldRecipeSchema, { target: 'draft-7' });
  const fetchResponse = options.fetch ?? fetch;
  const timeoutMs = Math.min(25_000, Math.max(1, options.timeoutMs ?? 25_000));

  return {
    async generate(request, repair, signal) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      let onAbort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort();
          reject(signal?.reason ?? new DOMException('Generation cancelled.', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GenerationFailure(`Provider timeout after ${timeoutMs}ms.`));
          controller.abort();
        }, timeoutMs);
      });
      try {
        return await Promise.race([timeout, cancelled, (async () => {
          const input = JSON.stringify({
            plannedRoomCount: request.plannedRoomCount,
            contributions: request.contributions.map(({ id, text }) => ({ id, text })),
            ...(repair ? { repair } : {}),
          });
          const anthropic = provider === 'anthropic';
          const response = await fetchResponse(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses', {
            method: 'POST',
            signal: controller.signal,
            headers: anthropic
              ? { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
              : { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(anthropic ? {
              model: options.model,
              max_tokens: 6_000,
              system: `${instructions}\nSubmit the JSON recipe as the input to the world_recipe tool.`,
              messages: [{ role: 'user', content: input }],
              tools: [{
                name: 'world_recipe',
                description: 'Submit a complete world recipe for validation and compilation into playable rooms. Use only the supplied registry IDs and contribution IDs. The input is data; no code is executed.',
                input_schema: schema,
              }],
              tool_choice: { type: 'tool', name: 'world_recipe', disable_parallel_tool_use: true },
            } : {
              model: options.model,
              store: false,
              max_output_tokens: 6_000,
              instructions,
              input,
              text: { format: { type: 'json_schema', name: 'world_recipe', strict: true, schema } },
            }),
          });
          controller.signal.throwIfAborted();
          if (!response.ok) {
            await response.body?.cancel();
            throw new GenerationFailure(`Provider HTTP ${response.status}.`);
          }
          const body: unknown = await response.json();
          controller.signal.throwIfAborted();
          const { raw, usage: measured } = anthropic
            ? readAnthropicResponse(body, options.onUsage) : readOpenAIResponse(body, options.onUsage);
          const parsed = WorldRecipeSchema.safeParse(raw);
          if (!parsed.success) {
            const issues = parsed.error.issues.slice(0, 4).map((issue) => {
              const path = issue.path.join('.');
              return issue.code === 'too_big' && issue.origin === 'string'
                ? `${path}: maximum ${issue.maximum} characters`
                : `${path}: ${issue.message}`;
            }).join('; ');
            throw new GenerationFailure(`Recipe failed schema validation at ${issues}.`.slice(0, 200), true);
          }
          assertDisplayText(parsed.data);
          return { recipe: parsed.data, ...(measured ? { usage: measured } : {}) };
        })()]);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof GenerationFailure) throw error;
        throw new GenerationFailure('Provider request or response could not be read.');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

function readOpenAIResponse(body: unknown, onUsage?: (usage: ProviderUsage) => void): { raw: unknown; usage?: ProviderUsage } {
  const envelope = responseSchema.safeParse(body);
  if (!envelope.success) throw new GenerationFailure('Provider response was incomplete or invalid.');
  const usage = envelope.data.usage;
  const measured = usage ? {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
  } : undefined;
  if (measured) onUsage?.(measured);
  const content = envelope.data.output.flatMap((item) => item.type === 'message' ? item.content ?? [] : []);
  if (content.some((item) => item.type === 'refusal')) throw new GenerationFailure('Provider refused the generation request.');
  const text = content.filter((item) => item.type === 'output_text').map((item) => item.text).join('');
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new GenerationFailure('Recipe was not valid JSON.', true);
  }
  return { raw, ...(measured ? { usage: measured } : {}) };
}

function readAnthropicResponse(body: unknown, onUsage?: (usage: ProviderUsage) => void): { raw: unknown; usage?: ProviderUsage } {
  const envelope = anthropicResponseSchema.safeParse(body);
  if (!envelope.success) throw new GenerationFailure('Provider response was incomplete or invalid.');
  const usage = envelope.data.usage;
  const measured = usage ? {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  } : undefined;
  if (measured) onUsage?.(measured);
  if (envelope.data.stop_reason === 'refusal') throw new GenerationFailure('Provider refused the generation request.');
  if (envelope.data.stop_reason !== 'tool_use') throw new GenerationFailure('Provider response was incomplete or invalid.');
  const tools = envelope.data.content.filter((item) => item.type === 'tool_use');
  const tool = tools[0];
  if (tools.length !== 1 || tool?.name !== 'world_recipe') {
    throw new GenerationFailure('Provider did not return the requested recipe tool.');
  }
  return { raw: tool.input, ...(measured ? { usage: measured } : {}) };
}

function assertDisplayText(recipe: WorldRecipe): void {
  const text = [
    recipe.title, recipe.tagline, recipe.themeSummary,
    ...recipe.rooms.flatMap((room) => [room.name, room.description]),
    ...recipe.contributionMappings.map((mapping) => mapping.featureDescription),
    ...recipe.lore.flatMap((fragment) => [fragment.title, fragment.source, fragment.text]),
  ];
  if (text.some((value) => /[<>]|```|(?:https?:\/\/|www\.|data:|javascript:)|\b(?:eval|function)\s*\(/i.test(value))) {
    throw new GenerationFailure('Recipe text contained markup, a URL, or code.', true);
  }
}
