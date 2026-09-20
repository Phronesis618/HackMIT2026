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
import {
  applyFixes, coerceJson, cutFailures, fitOverlong, fitText, lintWorld, parseBrief, parseFoundation, parseFullRecipe, parseLooseJson, parseWithFit,
  planBiomeSlots, planRelicSlots, replaceEngineWords, swapEngineWords,
} from '../../src/server/generation/stages';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const { bible: _bible, ...legacyRecipe } = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
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
/**
 * Seven room lines with seven different openings: the bank holds three, so four more are
 * written here in the same ward. A floor whose lines repeat an opening is a lint failure of
 * its own (`opener-repeat`), which is exercised on purpose further down.
 */
const lines = [
  ...of('roomLine').map((exemplar) => exemplar.text),
  'Bay C hatch is open. Two beds block the aisle behind it.',
  'Med trolley 4 lies across the lane. The ward clock reads 22:10.',
  "Wren's desk faces the door, 118 final notices stacked on it.",
  'Four dispensers along the far wall, one still holding 40 doses.',
];
const briefRaw = (name: string, tagline = of('biomeTagline')[0]!.text) => ({
  name, tagline, motifIds: ['cables'], enemyPool: ['husk', 'sentinel'], propPool: ['crate', 'terminal'], hazards: false,
  layout: { linearity: 0.7, branchiness: 0.2, specials: { treasure: 1, lore: 2, rest: 1, elite: 1 } },
  terrain: { features: ['rubble'], layout: 'barricades', density: 'sparse' },
  roomLines: { entrance: lines[0], combat: lines[1], elite: lines[2], treasure: lines[3], lore: lines[4], rest: lines[5], exit: lines[6] },
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
    expect(buildSystemPrompt({ stage: 'rooms', seed: 9, ideas: [] })).toMatch(/fourteen words at most/);
    // every stage that writes prose gives the model a word budget, not just a character limit
    for (const stage of ['foundation', 'rooms', 'laws', 'relics', 'remains', 'biomes'] as const) {
      expect(buildSystemPrompt({ stage, seed: 9, ideas: [] }), stage).toMatch(/words at most|word budget/);
    }
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
    expect(Object.keys((calls[0]!.schema as { properties: object }).properties).slice(0, 3)).toEqual(['premise', 'collapse', 'people']);
    expect(calls.slice(1).map((call) => call.stage).sort()).toEqual(['biomes:1', 'biomes:2', 'biomes:3', 'biomes:4', 'laws', 'relics', 'remains', 'rooms']);
    for (const call of calls.slice(1)) expect((call.input as { bible: unknown }).bible).toEqual(bible);
    expect(JSON.stringify(calls.map((call) => call.input))).not.toContain(sampleContributions[0]!.playerName);
    const { recipe } = world;
    expect(recipe.bible).toEqual(bible);
    expect(recipe.lore.filter((fragment) => fragment.kind === 'relic')).toHaveLength(6);
    expect(recipe.lore.filter((fragment) => fragment.kind === 'remains').map((fragment) => fragment.enemyId).sort()).toEqual(['guardian', 'husk', 'sentinel', 'spewer']);
    expect(recipe.lore.every((fragment) => fragment.authorIndex != null && fragment.eventIndex != null)).toBe(true);
    expect(recipe.attunements).toHaveLength(3);
    // The model offered `restless`, which the engine does not apply yet: the pipeline drops it
    // rather than show the crew a law that does nothing (tests/sim/law-honesty.test.ts).
    expect(recipe.laws?.map((law) => law.lawId)).toEqual(['long_dark']);
    expect(world.provenance.notes.join(' ')).toContain('not implemented by the engine');
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
    // The note names the replacement. The same advice without it survived two polish rounds live.
    expect(lint.failures[0]!.notes[0]).toContain(bible.enemies.find((enemy) => enemy.enemyId === 'husk')!.formerJob);
  });

  it('replaces an engine word left after polish with the bible former job, singular or plural', () => {
    expect(swapEngineWords('Two husks by the Pharmacy Hatch.', bible)).toBe(`Two ${bible.enemies.find((e) => e.enemyId === 'husk')!.formerJob} by the Pharmacy Hatch.`);
    expect(swapEngineWords('A husk holds the door.', bible)).toBe(`One of the ${bible.enemies.find((e) => e.enemyId === 'husk')!.formerJob} holds the door.`);
    expect(swapEngineWords('Behind the husk, med trolley 4.', bible)).toBe(`Behind one of the ${bible.enemies.find((e) => e.enemyId === 'husk')!.formerJob}, med trolley 4.`);
    // A creature the bible never cast keeps its word: trusted code does not invent a job.
    expect(swapEngineWords('Two lurkers wait.', { ...bible, enemies: [] })).toBe('Two lurkers wait.');

    const parts = { rooms: [{ ...roomsRaw.rooms[0]!, description: 'Two husks by the Pharmacy Hatch. Med trolley 4 blocks the left aisle.' }] };
    expect(replaceEngineWords(parts, bible)).toBe(1);
    expect(lintWorld(parts, bible).rules).not.toContain('engine-word');
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
    // never stop on a word that was leading somewhere ("...faces the photocopier that")
    expect(fitText("Eighty toner units ordered on Day 4; Dalgaard's desk faces the photocopier that jammed.", 80))
      .toBe("Eighty toner units ordered on Day 4; Dalgaard's desk faces the photocopier");
    // what is left of a clause the cut landed inside is dropped; a clause with content is kept
    expect(fitText('4 of 12 anchor bolts failed at 340 kPa; the remaining 8 are still in the ceiling.', 80))
      .toBe('4 of 12 anchor bolts failed at 340 kPa');
    expect(fitText('Brine monitors at 14 posts, one stamped pay claim filed in a tray and never opened.', 80))
      .toBe('Brine monitors at 14 posts, one stamped pay claim filed in a tray');
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

  it('reads call 1 flat (the bible fields at the top level) and nested alike', () => {
    const flat = { ...bible, title: foundationRaw.title, tagline: foundationRaw.tagline };
    const fromFlat = parseFoundation(flat);
    expect('foundation' in fromFlat && fromFlat.foundation).toMatchObject({ bible, header: { title: foundationRaw.title } });
    const fromNested = parseFoundation(foundationRaw);
    expect('foundation' in fromNested && fromNested.foundation.bible).toEqual(bible);
    // A complete pre-bible recipe still goes through untouched.
    expect('legacy' in parseFoundation(legacyRecipe)).toBe(true);
    // The flat reply never saw a `bible` key, so its repair note must not invent one.
    expect(() => parseFoundation({ ...flat, events: [] })).toThrow(/at events/);
    expect(() => parseFoundation({ ...foundationRaw, bible: 'a quarantine ward' })).toThrow(/at bible/);
  });

  it('keeps a floor whose room lines are unusable, and fits the ones that are', () => {
    const long = `${'Twelve beds along one wall of Bay C, med trolley 4 across the door. '.repeat(3)}`;
    const parsed = parseBrief({ ...briefRaw('Bay C'), roomLines: { ...briefRaw('x').roomLines, rest: null, combat: long, elite: 12 } }, 3);
    expect(parsed).toBeDefined();
    expect(parsed!.lines.map((line) => line.kind)).not.toContain('rest');
    expect(parsed!.lines.map((line) => line.kind)).not.toContain('elite');
    expect(parsed!.lines.find((line) => line.kind === 'combat')!.text.length).toBeLessThanOrEqual(140);
    // roomLines that are not an object at all cost the lines, never the floor
    expect(parseBrief({ ...briefRaw('Bay C'), roomLines: 'entrance: the airlock' }, 4)!.lines).toEqual([]);
  });

  it('reads a bible that arrived as a JSON string and strips Markdown emphasis', () => {
    const coerced = coerceJson({ ...foundationRaw, bible: JSON.stringify(bible), tagline: 'Locked on **14 March**.' }) as { bible: unknown; tagline: string };
    expect(coerced.bible).toEqual(bible);
    expect(coerced.tagline).toBe('Locked on 14 March.');
  });

  it('reads fenced and doubly encoded JSON strings, and gives up cleanly on a truncated one', () => {
    expect(parseLooseJson('```json\n{"a":[1]}\n```')).toEqual({ a: [1] });
    expect(parseLooseJson(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
    expect(parseLooseJson('Here it is: {"a":1} as asked')).toEqual({ a: 1 });
    expect(parseLooseJson('{"a": tru')).toBeUndefined();
    expect(parseLooseJson('Bay C')).toBeUndefined();
    // a bible that cannot be recovered stays a string and fails as an ordinary repairable schema error
    expect((coerceJson({ bible: '{"premise": "cut off' }) as { bible: unknown }).bible).toBe('{"premise": "cut off');
  });

  it('cuts a line whose only fault is length even when no polish call ran (budget cut it off)', () => {
    const parts = { biomes: [{ ...parseBrief(briefRaw('Bay C'), 0)!.brief, tagline: 'Twelve beds along one wall of Bay C. Med trolley 4 blocks the door; 118 final notices lie under it, one per bed.' }] };
    expect(lintWorld(parts, bible).rules).toContain('too-long');
    expect(fitOverlong(parts, bible)).toBe(1);
    expect(parts.biomes[0]!.tagline).toBe('Twelve beds along one wall of Bay C.');
    expect(lintWorld(parts, bible).rules).not.toContain('too-long');
  });

  it('sends a line trusted code had to cut back to be written short, instead of shipping the cut', () => {
    const cuts: Array<{ path: string; length: number; max: number }> = [];
    const long = `${'Beds bolted down along the whole left wall of Bay C, 31 of them, '.repeat(3)}and the door.`;
    const parsed = parseWithFit(WorldLawSchema, { lawId: 'long_dark', name: "Reyes's Hold", description: long, intensity: 0.5 }, cuts);
    expect(parsed.success).toBe(true);
    expect(cuts).toEqual([{ path: 'description', length: long.length, max: 160 }]);
    const parts = { laws: [parsed.data as WorldLaw] };
    const failures = cutFailures(parts, bible, cuts.map((cut) => ({ ...cut, path: `laws[0].${cut.path}` })));
    expect(failures).toHaveLength(1);
    expect(failures[0]!.notes[0]).toMatch(/Rule cut-short: this was written at \d+ characters .* at most \d+ words/);
    // and the polish reply is taken even though the cut line no longer breaks any line-level rule
    expect(applyFixes(parts, bible, failures, [{ path: 'laws[0].description', text: "Reyes locked Bay C on 2 March. Nothing shows beyond a step or two from each operative." }])).toBe(1);
    expect(parts.laws[0]!.description).toMatch(/^Reyes locked Bay C/);
  });

  it('rejects a law that states the fact and never gives the rule, and one that repeats the engine\'s numbers', () => {
    const law = (description: string): WorldLaw => ({ lawId: 'long_dark', name: "Reyes's Hold", description, intensity: 0.5 });
    const rules = (description: string) => lintWorld({ laws: [law(description)] }, bible).rules;
    expect(rules('Reyes cut the lights in Bay C on 2 March and kept 118 patients in the dark.')).toContain('law-needs-rule');
    expect(rules('Reyes cut the lights in Bay C on 2 March. Sight ends 215 px from each operative.')).toContain('law-engine-numbers');
    expect(rules('Reyes cut the lights in Bay C on 2 March. Sight ends a short way out; hazards still show.')).toEqual([]);
  });

  it('rejects a remains fragment that puts one of the three authors on the tag', () => {
    const author = bible.authors[0]!.name;
    const remains = (title: string, text: string) => lintWorld({ lore: [{
      kind: 'remains' as const, title, source: 'linen tag', text, roomIndex: 0, enemyId: 'husk' as const, authorIndex: 0, eventIndex: 0,
    }] }, bible);
    expect(remains(`Wristband, ${author}`, 'Ward wristband, Bay C, 14 March. 118 were issued that night.').rules).toContain('remains-author-name');
    expect(remains('Wristband, size M', `Ward wristband, Bay C, 14 March. ${author} wrote the bed number on the back.`).rules).not.toContain('remains-author-name');
  });

  it('rejects a callout in the engine\'s own words and a calendar date stitched into a sentence', () => {
    const tell = (text: string) => lintWorld({ custodian: { ...lawsRaw.custodian, moves: [{ ...lawsRaw.custodian.moves[0]!, tell: text }] } as never }, bible).rules;
    expect(tell('MONITOR RIG WINDS UP. DASH THE GAP.')).toContain('stock-callout');
    expect(tell('MONITOR RIG WINDS UP. GET BEHIND MED TROLLEY 4.')).not.toContain('stock-callout');
    const line = (text: string) => lintWorld({ themeSummary: text }, bible).rules;
    expect(line('Bay C was sealed after Reyes turned the key on Week 31 Monday, with 118 patients inside.')).toContain('stitched-date');
    expect(line('Bay C was sealed after Reyes turned the key on the Monday of that week, 118 patients inside.')).not.toContain('stitched-date');
  });

  it('rejects a floor whose room lines keep opening the same way', () => {
    const repeated = ['Two beds block the aisle.', 'Three rigged patients by the hatch.', 'Four dispensers on the wall, 40 doses left.'];
    const brief = parseBrief({ ...briefRaw('Bay C'), roomLines: {
      entrance: repeated[0], combat: repeated[1], elite: repeated[2], treasure: lines[0], lore: lines[1], rest: lines[2], exit: lines[3],
    } }, 0)!;
    const parts = { biomes: [brief.brief], biomeRoomLines: [{ biomeId: brief.brief.id, lines: brief.lines }] };
    const failure = lintWorld(parts, bible).failures.find((entry) => entry.notes[0]!.startsWith('Rule opener-repeat'));
    expect(failure?.path).toBe('biomes[0].rooms[2].description');
    expect(failure?.notes[0]).toContain('open on the same thing (a count)');
    // the article is not the opening: three lines starting "The" on three different nouns pass
    const articles = ['The hatch is open, two beds behind it.', 'The ward clock reads 22:10 above bed 4.', 'The linen cart blocks the aisle, 31 sheets on it.'];
    const spread = parseBrief({ ...briefRaw('Bay D'), roomLines: {
      entrance: articles[0], combat: articles[1], elite: articles[2], treasure: lines[0], lore: lines[1], rest: lines[2], exit: lines[3],
    } }, 1)!;
    expect(lintWorld({ biomes: [spread.brief], biomeRoomLines: [{ biomeId: spread.brief.id, lines: spread.lines }] }, bible).rules).not.toContain('opener-repeat');
    expect(lintWorld({ biomes: [brief.brief], biomeRoomLines: [{ biomeId: brief.brief.id, lines: parseBrief(briefRaw('Bay C'), 0)!.lines }] }, bible).rules).not.toContain('opener-repeat');
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
