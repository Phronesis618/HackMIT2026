import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WorldRecipeSchema, type GenerationRequest } from '../../src/shared/contracts';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';
import { createAnthropicProvider, createOpenAIProvider } from '../../src/server/generation/provider';
import { createOperatorProvider, type OperatorRequestFile } from '../../src/server/operator/provider';

const recipe = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'))
  .find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
const request: GenerationRequest = {
  requestId: 'attunement-text', sessionId: 'operator-parity', contributions: [], plannedRoomCount: 3,
};

describe.each(['name', 'description'] as const)('attunement %s display text', (field) => {
  it.each(['Inspect https://example.com', '<b>Signal</b>', 'function(signal)'])(
    'rejects %s consistently and accepts a corrected operator reply',
    async (text) => {
      const invalid = structuredClone(recipe);
      invalid.attunements[0]![field] = text;
      WorldRecipeSchema.parse(invalid);
      const openai = createOpenAIProvider({
        apiKey: 'test-only', model: 'mock',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(invalid) }] }],
        })),
      });
      const anthropic = createAnthropicProvider({
        apiKey: 'test-only', model: 'mock',
        fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({
          type: 'message', stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'world_recipe', input: invalid }],
        })),
      });
      for (const provider of [openai, anthropic]) {
        await expect(provider.generate(request)).rejects.toMatchObject({
          message: 'Recipe text contained markup, a URL, or code.', repairable: true,
        });
      }

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-display-text-'));
      const provider = createOperatorProvider({ dir, pollMs: 20, timeoutMs: 5_000 });
      const controller = new AbortController();
      const pending = provider.generate(request, undefined, controller.signal);
      try {
        const readInbox = (attempt: number): OperatorRequestFile => JSON.parse(fs.readFileSync(
          path.join(provider.inboxDir, `${request.requestId}-${attempt}.json`), 'utf8',
        )) as OperatorRequestFile;
        const first = readInbox(1);
        fs.writeFileSync(first.reply.path, JSON.stringify(invalid));
        await vi.waitFor(() => expect(fs.existsSync(
          path.join(provider.inboxDir, `${request.requestId}-2.json`),
        )).toBe(true), { timeout: 1_000, interval: 10 });
        const repair = readInbox(2);
        expect(repair.repair).toBe('Recipe text contained markup, a URL, or code.');
        expect(repair.deadlineAt).toBe(first.deadlineAt);
        const retired = fs.readdirSync(provider.doneDir);
        expect(retired.some((file) => file.includes(`${request.requestId}-1.`) && file.includes('rejected.request'))).toBe(true);
        expect(retired.some((file) => file.includes(`${request.requestId}-1.`) && file.includes('rejected.reply'))).toBe(true);
        fs.writeFileSync(repair.reply.path, JSON.stringify(recipe));
        await expect(pending).resolves.toEqual({ recipe });
        expect(provider.pending()).toEqual([]);
        expect(fs.readdirSync(provider.doneDir).some((file) => file.includes('accepted.reply'))).toBe(true);
      } finally {
        controller.abort();
        await pending.catch(() => {});
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
