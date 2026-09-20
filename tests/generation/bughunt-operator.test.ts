import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GenerationRequestSchema } from '../../src/shared/contracts';
import { loadWorldFixtures } from '../../src/server/generation';
import { createOperatorProvider, type OperatorRequestFile } from '../../src/server/operator/provider';

const recipe = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'))[0]!.recipe;

describe('operator request file isolation', () => {
  it('keeps concurrent request IDs with the same sanitized filename separate', async () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), 'relay-bughunt-operator-'));
    const provider = createOperatorProvider({ dir, pollMs: 20, timeoutMs: 2_000 });
    const controller = new AbortController();
    const requests = ['crew:one', 'crew_one'].map((requestId) => GenerationRequestSchema.parse({
      requestId, sessionId: requestId, contributions: [], plannedRoomCount: 3,
    }));
    const pending = requests.map((request) => provider.generate(request, undefined, controller.signal));
    const settled = Promise.allSettled(pending);
    try {
      expect(provider.pending()).toHaveLength(2);
      const files = fs.readdirSync(provider.inboxDir);
      expect(files).toHaveLength(2);
      for (const file of files) {
        const inbox = JSON.parse(fs.readFileSync(path.join(provider.inboxDir, file), 'utf8')) as OperatorRequestFile;
        const title = inbox.requestId === requests[0]!.requestId ? 'First crew world' : 'Second crew world';
        fs.writeFileSync(inbox.reply.path, JSON.stringify({ ...recipe, title }));
      }
      const worlds = await Promise.all(pending);
      expect(worlds.map((world) => world.recipe.title)).toEqual(['First crew world', 'Second crew world']);
      expect(provider.pending()).toEqual([]);
      expect(fs.readdirSync(provider.doneDir)).toHaveLength(4);
    } finally {
      controller.abort();
      await settled;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
