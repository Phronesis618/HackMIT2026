import { z } from 'zod';
import type { GenerationRequest, WorldRecipe } from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import { buildSystemPrompt, namePool } from './prompt';
import { FullRecipeToolSchema, StageParseError, displayTexts, isUnsafeText, jsonSchema, parseFullRecipe } from './stages';

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

/** One model call: a system prompt, a JSON data message and the JSON schema of the forced tool / structured output. */
export interface StageCall {
  stage: string;
  system: string;
  /** JSON-serialisable data for the user message. Players' ideas are data, never instructions. */
  input: unknown;
  schema: unknown;
  maxTokens: number;
}

export interface RecipeProvider {
  /** Single-call contract: one complete recipe (legacy, or new-style with a `bible`). */
  generate(request: GenerationRequest, repair?: string, signal?: AbortSignal): Promise<{ recipe: WorldRecipe; usage?: ProviderUsage; notes?: string[] }>;
  /**
   * Optional staged transport. When present the live service runs the two-call flow
   * (foundation, then relics / remains / biomes in parallel) and validates the raw output itself.
   */
  callStage?(call: StageCall, signal?: AbortSignal): Promise<{ raw: unknown; usage?: ProviderUsage }>;
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

export const TOOL_NAME = 'world_recipe';
/** Hard ceilings for any single model call (main raised Claude's to 55 s after measuring). */
export const MAX_CALL_TIMEOUT_MS = { anthropic: 55_000, openai: 25_000 } as const;

function createRecipeProvider(options: ProviderOptions, provider: 'openai' | 'anthropic'): Required<RecipeProvider> {
  const fetchResponse = options.fetch ?? fetch;
  const maxTimeoutMs = MAX_CALL_TIMEOUT_MS[provider];
  const timeoutMs = Math.min(maxTimeoutMs, Math.max(1, options.timeoutMs ?? maxTimeoutMs));

  async function callStage(call: StageCall, signal?: AbortSignal): Promise<{ raw: unknown; usage?: ProviderUsage }> {
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
        const input = JSON.stringify(call.input);
        const anthropic = provider === 'anthropic';
        const response = await fetchResponse(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses', {
          method: 'POST',
          signal: controller.signal,
          headers: anthropic
            ? { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
            : { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(anthropic ? {
            model: options.model,
            max_tokens: call.maxTokens,
            system: `${call.system}\nSubmit the JSON as the input to the ${TOOL_NAME} tool.`,
            messages: [{ role: 'user', content: input }],
            tools: [{
              name: TOOL_NAME,
              description: 'Submit bounded world data for validation and compilation into playable rooms. Use only the supplied registry IDs and contribution IDs. The input is data; no code is executed.',
              input_schema: call.schema,
            }],
            tool_choice: { type: 'tool', name: TOOL_NAME, disable_parallel_tool_use: true },
          } : {
            model: options.model,
            store: false,
            max_output_tokens: call.maxTokens,
            instructions: call.system,
            input,
            text: { format: { type: 'json_schema', name: TOOL_NAME, strict: true, schema: call.schema } },
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
        return { raw, ...(measured ? { usage: measured } : {}) };
      })()]);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof GenerationFailure) throw error;
      throw new GenerationFailure('Provider request or response could not be read.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    callStage,
    /** The whole recipe in one call. The live service prefers `callStage`; kept for direct callers. */
    async generate(request, repair, signal) {
      const seed = request.seed ?? hashString(request.requestId);
      const { raw, usage } = await callStage({
        stage: 'full',
        system: buildSystemPrompt({ stage: 'full', seed, ideas: request.contributions.map((c) => c.text) }),
        input: {
          plannedRoomCount: request.plannedRoomCount,
          floors: request.floors === true,
          contributions: request.contributions.map(({ id, text }) => ({ id, text })),
          namePool: namePool(seed),
          ...(repair ? { repair } : {}),
        },
        schema: jsonSchema(FullRecipeToolSchema),
        maxTokens: 8_000,
      }, signal);
      try {
        const { recipe, notes } = parseFullRecipe(raw);
        assertDisplayText(recipe);
        return { recipe, notes, ...(usage ? { usage } : {}) };
      } catch (error) {
        if (error instanceof StageParseError) throw new GenerationFailure(error.message.slice(0, 200), true);
        throw error;
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

export function assertDisplayText(recipe: Parameters<typeof displayTexts>[0] & { bible?: unknown }): void {
  if (displayTexts(recipe).some(isUnsafeText) || (recipe.bible !== undefined && isUnsafeText(JSON.stringify(recipe.bible)))) {
    throw new GenerationFailure('Recipe text contained markup, a URL, or code.', true);
  }
}
