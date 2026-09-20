/**
 * Writing pipeline (agent W2): bible first, staged calls, linter in the repair loop.
 * Every provider here is a mock; no test makes a network call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FloorsWorldRecipeSchema, PreparedWorldSchema, type GenerationRequest, type WorldRecipe } from '../../src/shared/contracts';
import { WorldBibleSchema } from '../../src/shared/bible';
import {
  CustodianSchema, WORLD_LAW_IDS, WorldLawSchema, WorldLookSchema, custodianMovesValid, sanitizeCustodian, sanitizeLaws, type WorldLaw,
} from '../../src/shared/laws';
import { sampleContributions } from '../../src/shared/samples';
import { exemplarSection, loadExemplarBank, selectExemplars } from '../../src/server/generation/exemplars';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';
import { createLiveGenerationService } from '../../src/server/generation/liveService';
import type { GenerationMetrics } from '../../src/server/generation/pipeline';
import { buildSystemPrompt, namePool, worldSeeds } from '../../src/server/generation/prompt';
import { GenerationFailure, assembleAnthropicStream, type RecipeProvider, type StageCall } from '../../src/server/generation/provider';
import { coerceJson, fitText, lintWorld, parseBrief, parseFullRecipe, parseWithFit, planBiomeSlots, planRelicSlots } from '../../src/server/generation/stages';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const legacyRecipe = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
const bank = loadExemplarBank();
const ward = bank.find((world) => world.world === 'Cinder Ward 9')!;
const request: GenerationRequest = { requestId: 'pipeline-req', sessionId: 'pipeline-session', contributions: sampleContributions, plannedRoomCount: 3 };

// ---- a complete, lint-clean staged reply built from W1's Cinder Ward 9 exemplars ----
const bible = WorldBibleSchema.parse({
  premise: ward.bible.premise, collapse: ward.bible.collapse, people: ward.bible.people, places: ward.bible.places, objects: ward.bible.objects,
  events: ward.bible.events.map(({ date, fact }) => ({ date, fact })), authors: ward.bible.authors,
  enemies: Object.entries(ward.bible.enemies).map(([enemyId, formerJob]) => ({ enemyId, formerJob })),
});
const of = (kind: string) => ward.exemplars.filter((exemplar) => exemplar.kind === kind);
const authorIndex = (name?: string) => Math.max(0, bible.authors.findIndex((author) => author.name === name));
const foundationRaw = { bible, title: 'Cinder Ward 9', tagline: '120-bed quarantine ward. 118 patients and 9 staff locked in.' };
const roomsRaw = {
  themeSummary: 'A 120-bed ward on spoke 9 of the Ring. Steel bays, 118 beds in use, dirty linen underfoot in Bay C.',
  motifIds: legacyRecipe.motifIds, palette: legacyRecipe.palette,
  rooms: legacyRecipe.rooms.map((room, index) => ({ ...room, name: ward.bible.places[index]!, description: of('roomLine')[index]!.text })),
  contributionMappings: [{ contributionId: sampleContributions[0]!.id, kind: 'name', featureDescription: 'Bay C is named for the ward bay.', roomIndex: 0 }],
};
const lawsRaw = {
  look: { paletteFamily: 'sodium', floorMaterial: 'sheet_metal', wallStyle: 'panelled', lighting: 'underlit', atmosphere: 'dust', atmosphereDensity: 0.3, skylineDepth: 0.1, grain: 0.4 },
  laws: [
    { lawId: 'long_dark', name: 'Reyes\'s Hold', description: of('boonDescription')[0]!.text, intensity: 0.5 },
    { lawId: 'restless', name: 'Night Three', description: of('boonDescription')[1]!.text, intensity: 0.4 },
  ],
  terrainSkins: [{ featureId: 'rubble', name: 'dirty linen', caption: 'DIRTY LINEN · slows walking, not dashes' }],
  custodian: {
    title: 'Administrator Reyes, Monitor Rig', phaseTitles: ['2 March, the hold', '14 March, 22:10', '118 final notices'],
    moves: [
      { patternId: 'siege_charge', name: 'med trolley 4', tell: of('bossCallout')[0]!.text },
      { patternId: 'ring_bloom', name: 'monitor rig', tell: of('bossCallout')[1]!.text },
      { patternId: 'arena_flood', name: 'final notices', tell: of('bossCallout')[2]!.text },
    ],
  },
};
const relicsRaw = () => ({
  lore: of('relic').map((exemplar, index) => ({
    authorIndex: authorIndex(exemplar.author), eventIndex: index % bible.events.length, kind: 'relic', title: exemplar.title!, source: exemplar.source!,
    text: exemplar.text, roomIndex: 0, enemyId: null,
  })),
});
const remainsRaw = {
  lore: of('remains').map((exemplar, index) => ({
    authorIndex: authorIndex(exemplar.author), eventIndex: index, kind: 'remains', title: exemplar.title!, source: exemplar.source!,
    text: exemplar.text, roomIndex: 0, enemyId: exemplar.enemyId!,
  })),
  attunements: of('boonDescription').map((exemplar) => ({ effectId: exemplar.effectId!, name: exemplar.name!, description: exemplar.text })),
};
const lines = of('roomLine').map((exemplar) => exemplar.text);
const briefRaw = (name: string, tagline = of('biomeTagline')[0]!.text) => ({
  name, tagline, motifIds: ['cables'], enemyPool: ['husk', 'sentinel'], propPool: ['crate', 'terminal'], hazards: false,
  layout: { linearity: 0.7, branchiness: 0.2, specials: { treasure: 1, lore: 2, rest: 1, elite: 1 } },
  terrain: { features: ['rubble'], layout: 'barricades', density: 'sparse' },
  roomLines: { entrance: lines[0], combat: lines[1], elite: lines[2], treasure: lines[0], lore: lines[1], rest: lines[2], exit: lines[0] },
});

type Reply = unknown | ((call: StageCall) => unknown);
function stagedProvider(replies: Record<string, Reply>) {
  const calls: StageCall[] = [];
  const provider: RecipeProvider = {
    generate: async () => { throw new Error('the staged flow must not use generate()'); },
    async callStage(call) {
      calls.push(call);
      const key = Object.keys(replies).find((candidate) => call.stage === candidate || call.stage.startsWith(`${candidate}:`)) ?? '';
      const reply = replies[key];
      const value = typeof reply === 'function' ? (reply as (call: StageCall) => unknown)(call) : reply;
      if (value instanceof Error) throw value;
      if (value === undefined) throw new GenerationFailure(`no mock reply for ${call.stage}`);
      return { raw: structuredClone(value), usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
    },
  };
  return { provider, calls };
}
const slotNames = (call: StageCall) => (call.input as { slots: Array<{ setting: string }> }).slots.map((slot) => slot.setting);
const biomesReply = (call: StageCall) => ({ biomes: slotNames(call).map((setting) => briefRaw(setting)) });
const happy = () => ({ foundation: foundationRaw, rooms: roomsRaw, laws: lawsRaw, relics: relicsRaw(), remains: remainsRaw, biomes: biomesReply, polish: { fixes: [] } });

async function generate(provider: RecipeProvider, overrides: Partial<GenerationRequest> = {}, options: { worldBudgetMs?: number } = {}) {
  let metrics: GenerationMetrics | undefined;
  const service = createLiveGenerationService({ provider, model: 'mock-model', fixtures, log: () => {}, onMetrics: (m) => { metrics = m; }, ...options });
  const world = await service.prepareWorld({ ...request, ...overrides });
  return { world, metrics };
}

describe('world bible schema', () => {
  it('accepts a complete bible and is carried, optionally, by the stored recipe', () => {
    expect(bible.authors).toHaveLength(3);
    expect(FloorsWorldRecipeSchema.safeParse({ ...legacyRecipe, bible }).success).toBe(true);
    expect(FloorsWorldRecipeSchema.safeParse(legacyRecipe).success).toBe(true);
    const withRefs = { ...legacyRecipe, lore: legacyRecipe.lore.map((fragment) => ({ ...fragment, authorIndex: 2, eventIndex: 6 })) };
    expect(FloorsWorldRecipeSchema.safeParse(withRefs).success).toBe(true);
    expect(FloorsWorldRecipeSchema.safeParse({ ...legacyRecipe, lore: [{ ...legacyRecipe.lore[0]!, authorIndex: 3 }] }).success).toBe(false);
  });

  it('rejects authors who are not people, repeated authors, too few events and duplicate enemy entries', () => {
    const stranger = { ...bible, authors: [{ ...bible.authors[0]!, name: 'Nobody Listed' }, bible.authors[1]!, bible.authors[2]!] };
    expect(WorldBibleSchema.safeParse(stranger).success).toBe(false);
    expect(WorldBibleSchema.safeParse({ ...bible, authors: [bible.authors[0]!, bible.authors[0]!, bible.authors[2]!] }).success).toBe(false);
    expect(WorldBibleSchema.safeParse({ ...bible, authors: bible.authors.slice(0, 2) }).success).toBe(false);
    expect(WorldBibleSchema.safeParse({ ...bible, events: bible.events.slice(0, 4) }).success).toBe(false);
    expect(WorldBibleSchema.safeParse({ ...bible, enemies: [bible.enemies[0]!, bible.enemies[0]!] }).success).toBe(false);
  });
});

describe('exemplar rotation', () => {
  const ideas = ['a bouncy castle factory', 'geese with clipboards'];
  it('is deterministic for a seed, changes with the seed and draws on at least two worlds', () => {
    const pick = (seed: number) => selectExemplars({ kind: 'relic', count: 4, seed, ideas }).map((entry) => entry.exemplar.id);
    expect(pick(11)).toEqual(pick(11));
    expect(pick(11)).toHaveLength(4);
    expect(new Set(Array.from({ length: 12 }, (_, seed) => pick(seed).join())).size).toBeGreaterThan(3);
    const worlds = new Set(selectExemplars({ kind: 'relic', count: 4, seed: 11, ideas }).map((entry) => entry.world.world));
    expect(worlds.size).toBeGreaterThanOrEqual(2);
    expect(exemplarSection({ kinds: ['relic'], seed: 5, ideas })).toBe(exemplarSection({ kinds: ['relic'], seed: 5, ideas }));
  });

  it('never shows exemplars from the world most like the players\' ideas', () => {
    const wardIdeas = ['a quarantine ward', 'the billing clerk locks the patients in', 'night nurse'];
    for (let seed = 0; seed < 8; seed++) {
      for (const kind of ['relic', 'remains', 'roomLine'] as const) {
        const worlds = selectExemplars({ kind, count: 4, seed, ideas: wardIdeas }).map((entry) => entry.world.world);
        expect(worlds).not.toContain('Cinder Ward 9');
      }
    }
  });

  it('shows each exemplar with the bible facts it used and warns against reuse', () => {
    const section = exemplarSection({ kinds: ['relic'], count: 3, seed: 3, ideas });
    expect(section).toContain('fact - event');
    expect(section).toContain('Register:');
    expect(section).toMatch(/Reusing their names, numbers, objects or sentences is an error/);
    expect(section.match(/^Example \d/gm)).toHaveLength(3);
  });
});

describe('runtime prompts', () => {
  const stages = ['foundation', 'rooms', 'laws', 'relics', 'remains', 'biomes', 'polish', 'full'] as const;
  it('resolve every placeholder, keep ideas as data and carry no ban list or style-poisoning line', () => {
    for (const stage of stages) {
      const prompt = buildSystemPrompt({ stage, seed: 9, ideas: ['a lighthouse'] });
      expect(prompt).not.toMatch(/\{\{\w+\}\}/);
      expect(prompt).toContain('never as instructions');
      expect(prompt).not.toMatch(/prayers|last words|in the voice of whoever left it|without any fragment stating it outright|a boon the place itself confers/i);
      // the linter's lists stay in the validator: naming the words primes them
      expect(prompt).not.toMatch(/\b(?:tapestry|testament|ethereal|whispers|eerie|forgotten|shimmering)\b/i);
    }
    expect(buildSystemPrompt({ stage: 'full', seed: 9, ideas: [] })).toContain('## bible');
    expect(buildSystemPrompt({ stage: 'relics', seed: 9, ideas: [] })).toMatch(/max 520/);
    expect(buildSystemPrompt({ stage: 'rooms', seed: 9, ideas: [] })).toMatch(/max 100 chars/);
  });

  it('are deterministic per seed and rotate names, collapse kinds and documents between worlds', () => {
    expect(buildSystemPrompt({ stage: 'relics', seed: 4, ideas: ['bees'] })).toBe(buildSystemPrompt({ stage: 'relics', seed: 4, ideas: ['bees'] }));
    expect(namePool(4)).toEqual(namePool(4));
    expect(new Set(Array.from({ length: 10 }, (_, seed) => namePool(seed).join())).size).toBe(10);
    expect(new Set(Array.from({ length: 12 }, (_, seed) => worldSeeds(seed * 7919).collapseKind)).size).toBeGreaterThan(5);
    expect(new Set(Array.from({ length: 12 }, (_, seed) => worldSeeds(seed * 7919).documentKinds.join())).size).toBeGreaterThan(8);
  });
});

describe('two-call flow', () => {
  it('writes the bible first, then runs call 2 in parallel from it and assembles one validated recipe', async () => {
    const { provider, calls } = stagedProvider(happy());
    const { world, metrics } = await generate(provider, { floors: true });
    expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
    expect(world.provenance).toMatchObject({ source: 'live', model: 'mock-model' });
    expect(calls[0]!.stage).toBe('foundation');
    expect(Object.keys((calls[0]!.schema as { properties: object }).properties)[0]).toBe('bible');
    expect(calls.slice(1).map((call) => call.stage).sort()).toEqual(['biomes:1', 'biomes:2', 'biomes:3', 'biomes:4', 'laws', 'relics', 'remains', 'rooms']);
    for (const call of calls.slice(1)) expect((call.input as { bible: unknown }).bible).toEqual(bible);
    expect(JSON.stringify(calls.map((call) => call.input))).not.toContain(sampleContributions[0]!.playerName);
    const { recipe } = world;
    expect(recipe.bible).toEqual(bible);
    expect(recipe.lore.filter((fragment) => fragment.kind === 'relic')).toHaveLength(6);
    expect(recipe.lore.filter((fragment) => fragment.kind === 'remains').map((fragment) => fragment.enemyId).sort()).toEqual(['guardian', 'husk', 'sentinel', 'spewer']);
    expect(recipe.lore.every((fragment) => fragment.authorIndex != null && fragment.eventIndex != null)).toBe(true);
    expect(recipe.attunements).toHaveLength(3);
    expect(recipe.laws?.map((law) => law.lawId)).toEqual(['long_dark', 'restless']);
    expect(recipe.look?.paletteFamily).toBe('sodium');
    expect(recipe.terrainSkins).toEqual(legacyRecipe.rooms.some((room) => room.terrain?.features.includes('rubble')) ? lawsRaw.terrainSkins : undefined);
    expect(recipe.custodian?.moves.map((move) => move.patternId)).toEqual(['siege_charge', 'ring_bloom', 'arena_flood']);
    expect(recipe.biomes).toHaveLength(8);
    expect(new Set(recipe.biomes!.map((brief) => brief.id)).size).toBe(8);
    expect(recipe.biomeRoomLines).toHaveLength(8);
    expect(metrics).toMatchObject({ mode: 'staged', derivedBriefs: [], dropped: [] });
    expect(metrics!.lint.after.failedFields).toBe(0);
    expect(world.provenance.attempts).toBe(calls.length);
    expect(world.provenance.notes.join(' ')).toMatch(/Prose lint score [\d.]+ \(0\/\d+ lines failing/);
  });

  it('skips the biome calls when floors are off', async () => {
    const { provider, calls } = stagedProvider(happy());
    const { world } = await generate(provider);
    expect(calls.map((call) => call.stage).sort()).toEqual(['foundation', 'laws', 'relics', 'remains', 'rooms']);
    expect(world.recipe.biomes).toBeUndefined();
    expect(world.recipe.bible).toBeDefined();
  });

  it('keeps the world when call-2 lore and brief calls fail, derives the briefs and says so', async () => {
    const { provider } = stagedProvider({ ...happy(), relics: new GenerationFailure('Provider HTTP 529.'), biomes: new GenerationFailure('Provider timeout after 55000ms.') });
    const { world, metrics } = await generate(provider, { floors: true });
    expect(world.provenance.source).toBe('live');
    expect(world.recipe.lore.every((fragment) => fragment.kind === 'remains')).toBe(true);
    expect(world.recipe.biomes).toHaveLength(8);
    expect(metrics!.derivedBriefs).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(metrics!.dropped).toContain('relics');
    const notes = world.provenance.notes.join(' ');
    expect(notes).toContain('Call 2 (relics) failed: Provider HTTP 529.');
    expect(notes).toMatch(/Biome brief\(s\) 1, 2, 3, 4, 5, 6, 7, 8 of 8 were derived by trusted code/);
    expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
  });

  it('drops call-2 work still running at the world budget instead of blocking the portal', async () => {
    const { provider } = stagedProvider({ ...happy(), remains: () => new Promise(() => {}) as never });
    const slow: RecipeProvider = { ...provider, callStage: (call, signal) => (call.stage === 'remains' ? new Promise((_, reject) => { signal?.addEventListener('abort', () => reject(new GenerationFailure('aborted'))); }) : provider.callStage!(call, signal)) };
    const { world, metrics } = await generate(slow, {}, { worldBudgetMs: 150 });
    expect(world.provenance.source).toBe('live');
    expect(world.recipe.lore.every((fragment) => fragment.kind === 'relic')).toBe(true);
    expect(world.recipe.attunements).toEqual([]);
    expect(metrics!.dropped).toEqual(['remains and attunements']);
    expect(world.provenance.notes.join(' ')).toContain('World budget of 0s reached');
  });

  it('falls back per brief: one invalid brief is derived, the other seven stay the model\'s', async () => {
    const { provider } = stagedProvider({
      ...happy(),
      biomes: (call: StageCall) => ({ biomes: slotNames(call).map((setting, offset) => (call.stage === 'biomes:2' && offset === 1 ? { ...briefRaw(setting), enemyPool: ['guardian'] } : briefRaw(setting))) }),
    });
    const { world, metrics } = await generate(provider, { floors: true });
    expect(metrics!.derivedBriefs).toEqual([3]);
    expect(world.recipe.biomes).toHaveLength(8);
    expect(world.recipe.biomes!.filter((brief) => brief.id.endsWith('-d'))).toHaveLength(1);
    expect(world.provenance.notes.join(' ')).toMatch(/Biome brief 4 was rejected: .*non-guardian/);
  });

  it('fails the world honestly when the load-bearing rooms call fails', async () => {
    const { provider } = stagedProvider({ ...happy(), rooms: new GenerationFailure('Provider HTTP 500.') });
    const { world } = await generate(provider);
    expect(world.provenance.source).toBe('live_fallback_fixture');
    expect(world.receipt.lines.every((line) => !line.used)).toBe(true);
  });

  it('still accepts old model output: no bible, floors off, one call, lint recorded but not enforced', async () => {
    const { provider, calls } = stagedProvider({ foundation: legacyRecipe });
    const { world, metrics } = await generate(provider);
    expect(calls).toHaveLength(1);
    expect(world.provenance).toMatchObject({ source: 'live', attempts: 1 });
    expect(world.recipe.bible).toBeUndefined();
    expect(world.recipe.title).toBe(legacyRecipe.title);
    expect(metrics!.mode).toBe('legacy');
    expect(world.provenance.notes.join(' ')).toContain('No world bible in the model output');
  });
});

describe('linter in the repair loop', () => {
  const slop = 'The sea remembers what the tower forgot. Something ancient whispers beneath the waves, a testament to sorrow.';
  it('sends rule-specific editor notes to the polish call and keeps only replacements that lint better', async () => {
    const relics = relicsRaw();
    const good = relics.lore[1]!.text;
    relics.lore[0]!.text = slop;
    relics.lore[1]!.text = 'It was never a lamp. It was an argument, and the dark was winning.';
    const { provider, calls } = stagedProvider({
      ...happy(), relics,
      polish: (call: StageCall) => (call.stage === 'polish:relics'
        ? { fixes: [{ path: 'lore[0].text', text: good }, { path: 'lore[1].text', text: 'Echoes of forgotten whispers dance, a tapestry of shadows. You feel it.' }, { path: 'lore[9].text', text: good }] }
        : { fixes: [] }),
    });
    const { world, metrics } = await generate(provider);
    const polish = calls.filter((call) => call.stage === 'polish:relics');
    expect(polish.length).toBeGreaterThanOrEqual(1);
    expect(polish.length).toBeLessThanOrEqual(2); // bounded
    const sent = polish[0]!.input as { bible: unknown; fixes: Array<{ path: string; text: string; editorNotes: string[]; maxChars: number }> };
    expect(sent.bible).toEqual(bible);
    expect(sent.fixes.map((fix) => fix.path)).toEqual(['lore[0].text', 'lore[1].text']);
    expect(sent.fixes[0]!.text).toBe(slop);
    expect(sent.fixes[0]!.editorNotes.join(' ')).toMatch(/Rule /);
    expect(sent.fixes[1]!.editorNotes.join(' ')).toContain('not-x-but-y');
    expect(sent.fixes[0]!.maxChars).toBe(480);
    const relicTexts = world.recipe.lore.filter((fragment) => fragment.kind === 'relic').map((fragment) => fragment.text);
    expect(relicTexts[0]).toBe(good); // better replacement applied
    expect(relicTexts[1]).toContain('never a lamp'); // worse replacement refused: the best attempt is kept
    expect(metrics!.lint.before.failedFields).toBe(2);
    expect(metrics!.lint.after.failedFields).toBe(1);
    expect(world.provenance.notes.join(' ')).toMatch(/before repair [\d.]+, 2 failing/);
  });

  it('single-call providers get one bounded repair with the feedback text, and the better attempt is kept', async () => {
    const good = parseFullRecipe({ ...foundationRaw, ...roomsRaw, ...lawsRaw, biomes: null, lore: [...relicsRaw().lore, ...remainsRaw.lore], attunements: remainsRaw.attunements }).recipe;
    const bad: WorldRecipe = { ...good, lore: good.lore.map((fragment, index) => (index === 0 ? { ...fragment, text: slop } : fragment)) };
    const worse: WorldRecipe = { ...good, lore: good.lore.map((fragment) => ({ ...fragment, text: slop })) };
    const repairs: Array<string | undefined> = [];
    const replies = [bad, worse];
    const provider: RecipeProvider = { async generate(_request, repair) { repairs.push(repair); return { recipe: structuredClone(replies.shift()!) }; } };
    const { world, metrics } = await generate(provider);
    expect(repairs).toHaveLength(2);
    expect(repairs[0]).toBeUndefined();
    expect(repairs[1]).toContain('lore[0].text: Rule ');
    expect(world.provenance).toMatchObject({ source: 'live', attempts: 2 });
    expect(world.recipe.lore[0]!.text).toBe(slop);
    expect(world.recipe.lore[1]!.text).toBe(good.lore[1]!.text); // the first, better-scoring attempt was kept
    expect(metrics).toMatchObject({ mode: 'single' });
    expect(metrics!.lint.after.failedFields).toBe(1);

    const calls: number[] = [];
    const clean: RecipeProvider = { async generate() { calls.push(1); return { recipe: structuredClone(good) }; } };
    expect((await generate(clean)).world.provenance.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('flags engine words and header lines over their hard limit even when prose.ts passes them', () => {
    const lint = lintWorld({ rooms: [{ ...roomsRaw.rooms[0]!, description: 'Two husks by the Pharmacy Hatch. Med trolley 4 blocks the left aisle.' }] }, bible);
    expect(lint.rules).toContain('engine-word');
    expect(lint.failures[0]!.notes[0]).toContain('former job');
  });
});

describe('world laws, look and Custodian', () => {
  const law = (lawId: WorldLaw['lawId'], intensity = 0.5): WorldLaw => ({ lawId, name: 'Reyes\'s Hold', description: 'Anton Reyes set it on 2 March.', intensity });
  it('validates ids and bounds', () => {
    expect(WORLD_LAW_IDS).toHaveLength(18);
    expect(WorldLawSchema.safeParse(law('long_dark')).success).toBe(true);
    expect(WorldLawSchema.safeParse({ ...law('long_dark'), lawId: 'low_gravity' }).success).toBe(false);
    expect(WorldLawSchema.safeParse(law('long_dark', 1.2)).success).toBe(false);
    expect(WorldLawSchema.safeParse({ ...law('long_dark'), name: 'x'.repeat(37) }).success).toBe(false);
    expect(WorldLookSchema.safeParse(lawsRaw.look).success).toBe(true);
    expect(WorldLookSchema.safeParse({ ...lawsRaw.look, lighting: 'disco' }).success).toBe(false);
    expect(WorldLookSchema.safeParse({ ...lawsRaw.look, grain: 2 }).success).toBe(false);
    expect(FloorsWorldRecipeSchema.safeParse({ ...legacyRecipe, laws: [law('long_dark')], look: lawsRaw.look, custodian: lawsRaw.custodian, terrainSkins: lawsRaw.terrainSkins }).success).toBe(true);
    expect(FloorsWorldRecipeSchema.safeParse({ ...legacyRecipe, laws: [law('long_dark'), law('restless'), law('thin_air'), law('slow_fire')] }).success).toBe(false);
  });

  it('applies the design guard-rails in trusted code: conflicts, group caps and the difficulty budget', () => {
    expect(sanitizeLaws([law('few_and_terrible'), law('the_many')]).laws.map((l) => l.lawId)).toEqual(['few_and_terrible']);
    expect(sanitizeLaws([law('long_dark'), law('long_dark')]).laws).toHaveLength(1);
    expect(sanitizeLaws([law('glass_lattice'), law('long_echo')]).laws.map((l) => l.lawId)).toEqual(['glass_lattice']); // one combat law
    expect(sanitizeLaws([law('long_dark'), law('held_breath')]).laws.map((l) => l.lawId)).toEqual(['long_dark']);
    // budget 2 + 2 + 1 = 5 > 3: the highest-budget law goes (ties: the later one)
    expect(sanitizeLaws([law('glass_lattice'), law('wardens_watch'), law('restless')]).laws.map((l) => l.lawId)).toEqual(['glass_lattice', 'restless']);
    // budget -1 + -1 = -2 < -1: the lowest goes
    expect(sanitizeLaws([law('thin_air'), law('first_light')]).laws).toHaveLength(1);
  });

  it('repairs an illegal Custodian move set instead of failing the world', () => {
    expect(CustodianSchema.safeParse(lawsRaw.custodian).success).toBe(true);
    expect(custodianMovesValid(['siege_charge', 'ring_bloom', 'arena_flood'], 3)).toBe(true);
    expect(custodianMovesValid(['arena_flood', 'pylon_lock', 'ring_bloom'], 3)).toBe(false); // two arena, no close
    expect(custodianMovesValid(['siege_charge', 'ring_bloom', 'summon_choir'], 1)).toBe(false);
    const broken = CustodianSchema.parse({ ...lawsRaw.custodian, moves: lawsRaw.custodian.moves.map((move, index) => (index === 0 ? { ...move, patternId: 'pylon_lock' } : move)) });
    const fixed = sanitizeCustodian(broken, 3);
    expect(fixed.substituted).toBeGreaterThan(0);
    expect(custodianMovesValid(fixed.custodian.moves.map((move) => move.patternId), 3)).toBe(true);
    expect(fixed.custodian.title).toBe(broken.title);
  });

  it('drops invalid laws and look from a live reply without failing the world', async () => {
    const { provider } = stagedProvider({ ...happy(), laws: { ...lawsRaw, look: { ...lawsRaw.look, wallStyle: 'velvet' }, laws: [lawsRaw.laws[0], { ...lawsRaw.laws[1], lawId: 'moon_gravity' }] } });
    const { world } = await generate(provider);
    expect(world.provenance.source).toBe('live');
    expect(world.recipe.look).toBeUndefined();
    expect(world.recipe.laws?.map((l) => l.lawId)).toEqual(['long_dark']);
    expect(world.provenance.notes.join(' ')).toMatch(/World look was invalid.*Dropped 1 world law/);
  });
});

describe('lenient parsing and transport helpers', () => {
  it('fits over-long strings and lists and drops unknown ids inside lists, but still fails on real errors', () => {
    expect(fitText('One fact here. A second sentence that runs on past the limit of the field.', 40)).toBe('One fact here.');
    expect(fitText('NAME · break with attacks, the seam opens into rubble that slows', 45)).toBe('NAME · break with attacks');
    const long = { ...briefRaw('Bay C'), tagline: `${'Beds bolted down. '.repeat(12)}`.trim(), motifIds: ['cables', 'velvet', 'arches'], propPool: ['crate', 'crate', 'anchor_pedestal'] };
    const parsed = parseBrief(long, 2)!;
    expect(parsed.brief.tagline.length).toBeLessThanOrEqual(140);
    expect(parsed.brief.motifIds).toEqual(['cables', 'arches']);
    expect(parsed.brief.propPool).toEqual(['crate']);
    expect(parsed.brief.id).toBe('b2-bay-c');
    expect(parseBrief({ ...briefRaw('Bay C'), roomLines: { ...briefRaw('x').roomLines, rest: null } }, 1)!.lines.map((line) => line.kind)).not.toContain('rest');
    expect(parseBrief({ ...briefRaw('Bay C'), hazards: 'yes' }, 1)).toBeUndefined();
    expect(parseWithFit(WorldBibleSchema, { ...bible, places: [...bible.places, 'Sixth Place'] }).success).toBe(true);
  });

  it('reads a bible that arrived as a JSON string and strips Markdown emphasis', () => {
    const coerced = coerceJson({ ...foundationRaw, bible: JSON.stringify(bible), tagline: 'Locked on **14 March**.' }) as { bible: unknown; tagline: string };
    expect(coerced.bible).toEqual(bible);
    expect(coerced.tagline).toBe('Locked on 14 March.');
  });

  it('deals every relic slot an author, an event and a length, and every biome slot its own setting', () => {
    const slots = planRelicSlots(3, 42, bible.events.length);
    expect(slots).toHaveLength(6);
    expect(new Set(slots.map((slot) => slot.authorIndex))).toEqual(new Set([0, 1, 2]));
    expect(new Set(slots.map((slot) => slot.eventIndex)).size).toBe(6);
    expect(slots.map((slot) => slot.roomIndex)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(new Set(slots.map((slot) => slot.length)).size).toBe(3);
    expect(planRelicSlots(3, 42, bible.events.length)).toEqual(slots);
    const biomes = planBiomeSlots(bible, 42);
    expect(biomes.map((slot) => slot.position)).toEqual(['opener', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle', 'finale']);
    expect(new Set(biomes.map((slot) => slot.setting)).size).toBe(8);
    for (const slot of biomes) expect(slot.namesTaken).not.toContain(slot.setting);
  });

  it('rebuilds a Messages response from its event stream', () => {
    const sse = [
      { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'world_recipe', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"title":"Cinder' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' Ward 9"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 34 } },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n`).join('\n');
    expect(assembleAnthropicStream(sse)).toEqual({
      type: 'message', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'world_recipe', input: { title: 'Cinder Ward 9' } }],
      usage: { input_tokens: 12, output_tokens: 34 },
    });
    expect(() => assembleAnthropicStream('data: {"type":"message_start","message":{}}\n')).toThrow(GenerationFailure);
  });
});

describe('prompt files', () => {
  it('exist for every stage and the old single prompt no longer asks for the bad style', () => {
    const dir = path.resolve(__dirname, '../../prompts/runtime');
    for (const name of ['common', 'foundation', 'rooms', 'laws', 'relics', 'remains', 'biomes', 'brief-rules', 'polish', 'world-recipe']) {
      expect(fs.existsSync(path.join(dir, `${name}.md`))).toBe(true);
    }
    expect(fs.readFileSync(path.join(dir, 'world-recipe.md'), 'utf8')).not.toMatch(/prayers|last words/);
  });
});
