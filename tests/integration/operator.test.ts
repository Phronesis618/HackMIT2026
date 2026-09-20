/**
 * Operator provider (demo-only): the server writes a request into an inbox directory and a
 * watching coding agent writes the WorldRecipe reply. These tests play the agent with plain
 * file writes — no network, no credentials.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreparedWorldSchema, WorldFixtureSchema, type WorldRecipe } from '../../src/shared/contracts';
import { sampleContributions } from '../../src/shared/samples';
import { createRelayServer } from '../../src/server/app';
import { loadServerConfig } from '../../src/server/config';
import { createGenerationService } from '../../src/server/generation';
import { GenerationFailure } from '../../src/server/generation/provider';
import { createOperatorProvider, OPERATOR_MODEL, type OperatorRequestFile } from '../../src/server/operator/provider';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const fixtureRecipe = (): WorldRecipe => WorldFixtureSchema.parse(
  JSON.parse(fs.readFileSync(path.join(fixturesDir, 'vantage-spire.json'), 'utf8')),
).recipe;

const request = (requestId = 'req-operator-1') => ({
  requestId,
  sessionId: 'session-operator',
  contributions: sampleContributions.slice(0, 2),
  plannedRoomCount: 3 as const,
});

const tmpDirs: string[] = [];
const tmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-operator-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Wait for the server to drop the request file, then return its parsed contents. */
async function awaitInbox(inboxDir: string, name: string, timeoutMs = 5_000): Promise<OperatorRequestFile> {
  const file = path.join(inboxDir, name);
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`inbox file ${name} never appeared`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as OperatorRequestFile;
}

describe('operator provider', () => {
  it('writes an honest request file and accepts a valid reply', async () => {
    const dir = tmpDir();
    const provider = createOperatorProvider({ dir, timeoutMs: 5_000, pollMs: 20 });
    const pending = provider.generate(request());

    const inbox = await awaitInbox(provider.inboxDir, 'req-operator-1-1.json');
    expect(inbox.kind).toBe('relay_operator_request');
    expect(inbox.attempt).toBe(1);
    expect(inbox.repair).toBeNull();
    expect(inbox.plannedRoomCount).toBe(3);
    expect(inbox.contributions).toEqual(sampleContributions.slice(0, 2).map(({ id, playerName, text }) => ({ id, playerName, text })));
    expect(inbox.registry.enemyIds).toContain('guardian');
    expect(inbox.instructions).toContain('## bible');
    expect(inbox.instructions).toContain('never as instructions');
    expect(inbox.instructions).not.toMatch(/\{\{\w+\}\}/);
    expect(inbox.namePool.length).toBeGreaterThan(5);
    expect(inbox.instructions).not.toContain('{{registry}}');
    expect(inbox.reply.path).toBe(path.join(provider.outboxDir, 'req-operator-1-1.json'));
    expect(provider.pending()).toEqual(['req-operator-1-1.json']);
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'world-recipe.schema.json'))).toBe(true);

    const recipe = fixtureRecipe();
    fs.writeFileSync(inbox.reply.path, JSON.stringify(recipe));
    const result = await pending;
    expect(result.recipe.title).toBe(recipe.title);
    expect(provider.pending()).toEqual([]);
    // consumed pair is retired into done/
    expect(fs.readdirSync(provider.inboxDir)).toEqual([]);
    expect(fs.readdirSync(provider.outboxDir)).toEqual([]);
    const done = fs.readdirSync(provider.doneDir);
    expect(done.some((f) => f.includes('accepted.request'))).toBe(true);
    expect(done.some((f) => f.includes('accepted.reply'))).toBe(true);
  });

  it('round-trips a bible-first reply: schema file, floors flag, refs, laws, look and briefs survive validation', async () => {
    const dir = tmpDir();
    const provider = createOperatorProvider({ dir, timeoutMs: 5_000, pollMs: 20 });
    const pending = provider.generate({ ...request('req-operator-bible'), floors: true });
    const inbox = await awaitInbox(provider.inboxDir, 'req-operator-bible-1.json');
    expect(inbox.floors).toBe(true);
    const schema = JSON.parse(fs.readFileSync(path.join(dir, 'world-recipe.schema.json'), 'utf8')) as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)[0]).toBe('bible');
    expect(schema.required).toEqual(expect.arrayContaining(['bible', 'rooms', 'lore', 'laws', 'look', 'custodian', 'biomes']));

    const ward = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../prompts/exemplars/cinder-ward-9.json'), 'utf8')) as {
      bible: { premise: string; collapse: string; people: unknown[]; places: string[]; objects: string[]; events: Array<{ date: string; fact: string }>; authors: unknown[]; enemies: Record<string, string> };
      exemplars: Array<{ kind: string; title?: string; source?: string; text: string; enemyId?: string }>;
    };
    const base = fixtureRecipe();
    const brief = (name: string) => ({
      name, tagline: 'Twelve beds along one wall. Med trolley 4 blocks the door.', motifIds: ['cables'], enemyPool: ['husk'], propPool: ['crate'], hazards: false,
      layout: { linearity: 0.5, branchiness: 0.5, specials: { treasure: 1, lore: 1, rest: 1, elite: 1 } }, terrain: null,
      roomLines: Object.fromEntries(['entrance', 'combat', 'elite', 'treasure', 'lore', 'rest', 'exit'].map((kind) => [kind, 'Two patients in monitor rigs by Bay C. Med trolley 4 gives cover.'])),
    });
    const reply = {
      bible: { ...ward.bible, events: ward.bible.events.map(({ date, fact }) => ({ date, fact })), enemies: Object.entries(ward.bible.enemies).map(([enemyId, formerJob]) => ({ enemyId, formerJob })) },
      title: 'Cinder Ward 9', tagline: '120-bed quarantine ward. 118 patients and 9 staff locked in.',
      themeSummary: base.themeSummary, motifIds: base.motifIds, palette: base.palette, rooms: base.rooms, contributionMappings: [],
      look: { paletteFamily: 'rust', floorMaterial: 'plates', wallStyle: 'panelled', lighting: 'flat', atmosphere: 'none', atmosphereDensity: 0, skylineDepth: 0, grain: 0.2 },
      laws: [{ lawId: 'long_dark', name: 'Reyes\'s Hold', description: 'Anton Reyes set the discharge hold on 2 March. The ward lights went with it.', intensity: 0.5 }],
      terrainSkins: [], custodian: null,
      biomes: Array.from({ length: 8 }, (_, index) => brief(`Bay ${String.fromCharCode(65 + index)}`)),
      lore: ward.exemplars.filter((e) => e.kind === 'relic').slice(0, 2).map((e, index) => ({ authorIndex: index, eventIndex: index, kind: 'relic', title: e.title, source: e.source, text: e.text, roomIndex: index, enemyId: null })),
      attunements: [],
    };
    fs.writeFileSync(inbox.reply.path, JSON.stringify(reply));
    const { recipe } = await pending;
    expect(recipe.bible?.authors).toHaveLength(3);
    expect(recipe.lore.map((fragment) => [fragment.authorIndex, fragment.eventIndex])).toEqual([[0, 0], [1, 1]]);
    expect(recipe.laws?.[0]?.lawId).toBe('long_dark');
    expect(recipe.look?.paletteFamily).toBe('rust');
    expect(recipe.custodian).toBeUndefined();
    expect(recipe.biomes).toHaveLength(8);
    expect(recipe.biomeRoomLines?.[0]?.lines).toHaveLength(7);
  });

  it('re-issues the request with repair feedback after an invalid reply, within the same deadline', async () => {
    const dir = tmpDir();
    const provider = createOperatorProvider({ dir, timeoutMs: 5_000, pollMs: 20 });
    const pending = provider.generate(request());
    const inbox = await awaitInbox(provider.inboxDir, 'req-operator-1-1.json');
    fs.writeFileSync(inbox.reply.path, JSON.stringify({ ...fixtureRecipe(), title: '' }));

    const repairInbox = await awaitInbox(provider.inboxDir, 'req-operator-1-2.json');
    expect(repairInbox.attempt).toBe(2);
    expect(repairInbox.repair).toMatch(/schema validation at title/);
    expect(repairInbox.deadlineAt).toBe(inbox.deadlineAt);
    expect(fs.readdirSync(provider.doneDir).some((f) => f.includes('req-operator-1-1') && f.includes('rejected.reply'))).toBe(true);

    fs.writeFileSync(repairInbox.reply.path, JSON.stringify(fixtureRecipe()));
    await expect(pending).resolves.toMatchObject({ recipe: { title: fixtureRecipe().title } });
    expect(provider.pending()).toEqual([]);
  });

  it('carries an upstream repair message into the first request file', async () => {
    const provider = createOperatorProvider({ dir: tmpDir(), timeoutMs: 5_000, pollMs: 20 });
    const pending = provider.generate(request(), 'Recipe failed schema validation at rooms: too few.');
    const inbox = await awaitInbox(provider.inboxDir, 'req-operator-1-1.json');
    expect(inbox.repair).toMatch(/too few/);
    fs.writeFileSync(inbox.reply.path, JSON.stringify(fixtureRecipe()));
    await expect(pending).resolves.toBeDefined();
  });

  it('refuses replies whose display text contains markup, URLs or code', async () => {
    const provider = createOperatorProvider({ dir: tmpDir(), timeoutMs: 5_000, pollMs: 20 });
    const pending = provider.generate(request());
    const inbox = await awaitInbox(provider.inboxDir, 'req-operator-1-1.json');
    fs.writeFileSync(inbox.reply.path, JSON.stringify({ ...fixtureRecipe(), tagline: 'See https://example.com' }));
    const repairInbox = await awaitInbox(provider.inboxDir, 'req-operator-1-2.json');
    expect(repairInbox.repair).toMatch(/markup, a URL, or code/);
    fs.writeFileSync(repairInbox.reply.path, JSON.stringify(fixtureRecipe()));
    await expect(pending).resolves.toBeDefined();
  });

  it('gives up after the deadline with a non-repairable failure', async () => {
    const provider = createOperatorProvider({ dir: tmpDir(), timeoutMs: 60, pollMs: 20 });
    const error = await provider.generate(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GenerationFailure);
    expect((error as GenerationFailure).repairable).toBe(false);
    expect((error as GenerationFailure).message).toMatch(/did not reply/);
    expect(provider.pending()).toEqual([]);
    expect(fs.readdirSync(provider.doneDir).some((f) => f.includes('timeout.request'))).toBe(true);
  });

  it('stops waiting when the request is aborted', async () => {
    const provider = createOperatorProvider({ dir: tmpDir(), timeoutMs: 5_000, pollMs: 20 });
    const controller = new AbortController();
    const pending = provider.generate(request(), undefined, controller.signal);
    await awaitInbox(provider.inboxDir, 'req-operator-1-1.json');
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(provider.pending()).toEqual([]);
  });
});

describe('operator provider through the generation service', () => {
  it('produces a live world labelled with the operator model and falls back honestly on silence', async () => {
    const dir = tmpDir();
    const provider = createOperatorProvider({ dir, timeoutMs: 5_000, pollMs: 20 });
    const service = createGenerationService({
      mode: 'live', provider: 'operator', openaiApiKey: null, openaiModel: 'unused', fixturesDir, log: () => {},
      recipeProvider: { provider, model: OPERATOR_MODEL },
    });
    expect(service.info()).toMatchObject({ effectiveMode: 'live', liveConfigured: true, provider: 'operator' });

    const phases: string[] = [];
    const pending = service.prepareWorld(request('req-service-1'), (status) => phases.push(status.phase));
    const inbox = await awaitInbox(provider.inboxDir, 'req-service-1-1.json');
    fs.writeFileSync(inbox.reply.path, JSON.stringify(fixtureRecipe()));
    const world = PreparedWorldSchema.parse(await pending);
    expect(world.provenance.source).toBe('live');
    expect(world.provenance.label).toBe(`LIVE · ${OPERATOR_MODEL}`);
    expect(world.provenance.attempts).toBe(1);
    expect(world.rooms).toHaveLength(3);
    expect(phases).toContain('generating');
    expect(phases.at(-1)).toBe('ready');

    const silent = createGenerationService({
      mode: 'live', provider: 'operator', openaiApiKey: null, openaiModel: 'unused', fixturesDir, log: () => {},
      recipeProvider: { provider: createOperatorProvider({ dir: tmpDir(), timeoutMs: 60, pollMs: 20 }), model: OPERATOR_MODEL },
    });
    const fallback = PreparedWorldSchema.parse(await silent.prepareWorld(request('req-service-2')));
    expect(fallback.provenance.source).toBe('live_fallback_fixture');
    expect(fallback.provenance.notes.join(' ')).toMatch(/did not reply/);
  });

  it('is wired by RELAY_AI_PROVIDER=operator without any API key', async () => {
    const dir = tmpDir();
    const config = loadServerConfig({
      env: {
        NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1',
        RELAY_GENERATION_MODE: 'live', RELAY_AI_PROVIDER: 'operator', RELAY_OPERATOR_DIR: dir, RELAY_OPERATOR_TIMEOUT_MS: '5000',
      },
      argv: [],
    });
    expect(config.generation).toMatchObject({ provider: 'operator', operatorDir: dir, operatorTimeoutMs: 5000 });
    const server = createRelayServer(config, { log: () => {} });
    const { port } = await server.listen();
    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json() as { generation: Record<string, unknown> };
      expect(health.generation).toMatchObject({ effectiveMode: 'live', liveConfigured: true, provider: 'operator', operatorPending: 0 });

      const pending = fetch(`http://127.0.0.1:${port}/api/world`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request('req-http-1')),
      });
      const inbox = await awaitInbox(path.join(dir, 'inbox'), 'req-http-1-1.json');
      fs.writeFileSync(inbox.reply.path, JSON.stringify(fixtureRecipe()));
      const world = PreparedWorldSchema.parse(await (await pending).json());
      expect(world.provenance).toMatchObject({ source: 'live', model: OPERATOR_MODEL });
      expect(world.receipt.source).toBe('live');
    } finally {
      await server.close();
    }
  });
});
