/**
 * Offline composer: instant `procedural` worlds from player ideas. No network, no model.
 * These tests pin the honesty rules (attributions match placed features), determinism,
 * distinctness across ideas, and robustness against junk input.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, WorldRecipeSchema, type Contribution, type GenerationRequest } from '../../src/shared/contracts';
import { composeWorld, composeWorldRecipe } from '../../src/server/composer/compose';
import { COMPOSER_MODEL, createComposerProvider } from '../../src/server/composer/provider';
import { compileWorldRecipe, createGenerationService } from '../../src/server/generation';
import { GenerationFailure, type RecipeProvider } from '../../src/server/generation/provider';
import { parseWorldPrefix } from '../../src/client/transport/worldProviders';
import { BiomeBriefListSchema } from '../../src/shared/floors';
import { lintProse, lintRecipeText } from '../../src/shared/prose';
import { REMAINS_TEMPLATES, THEMES } from '../../src/server/composer/themes';
import { floorsSeedFor, upgradeToFloors } from '../../src/shared/floorgen';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');

let counter = 0;
const idea = (text: string, playerName = 'Ada'): Contribution => ({
  id: `contrib-${++counter}`, playerId: `player-${playerName.toLowerCase()}`, playerName, text, submittedAt: 1_700_000_000_000,
});
const request = (texts: string[], requestId = `req-${++counter}`): GenerationRequest => ({
  requestId, sessionId: 'session-composer', contributions: texts.map((t) => idea(t)), plannedRoomCount: 3,
});

const DISPLAY_GUARD = /[<>]|```|(?:https?:\/\/|www\.|data:|javascript:)|\b(?:eval|function)\s*\(/i;
const displayText = (recipe: ReturnType<typeof composeWorldRecipe>): string[] => [
  recipe.title, recipe.tagline, recipe.themeSummary,
  ...recipe.rooms.flatMap((r) => [r.name, r.description]),
  ...recipe.contributionMappings.map((m) => m.featureDescription),
  ...recipe.lore.flatMap((l) => [l.title, l.source, l.text]),
  ...recipe.attunements.flatMap((a) => [a.name, a.description]),
];

describe('composeWorld', () => {
  it('is deterministic for the same request and different for different ideas', () => {
    const same = request(['space pirates'], 'req-same');
    const a1 = composeWorldRecipe(same);
    const a2 = composeWorldRecipe(structuredClone(same));
    expect(a2).toEqual(a1);
    const b = composeWorldRecipe(request(['a drowned cathedral where the bells still ring'], 'req-other'));
    expect(b.title).not.toBe(a1.title);
    expect(b.palette.floor).not.toBe(a1.palette.floor);
    expect(b.motifIds[0]).not.toBe(a1.motifIds[0]);
    expect(b.rooms.map((r) => r.name)).not.toEqual(a1.rooms.map((r) => r.name));
  });

  it('picks the theme the ideas describe and echoes the players\' words', () => {
    const pirates = composeWorld(request(['space pirates raiding a treasure galleon']));
    expect(pirates.themes.primary).toBe('pirates');
    expect(pirates.recipe.motifIds[0]).toBe('ruined_machinery');
    const forest = composeWorld(request(['an overgrown jungle temple with moss everywhere']));
    expect(forest.themes.primary).toBe('jungle');
    expect(forest.recipe.motifIds[0]).toBe('roots');
    expect(JSON.stringify(forest.recipe).toLowerCase()).toMatch(/jungle|overgrown|temple|moss/);
  });

  it('blends a secondary theme into the middle room', () => {
    const { recipe, themes } = composeWorld(request(['a frozen glacier station', 'haunted by ghosts of the crew']));
    expect(themes.primary).toBe('frozen');
    expect(themes.secondary).toBe('haunted');
    expect(recipe.motifIds).toContain('monoliths');
    expect(recipe.attunements.length).toBeGreaterThanOrEqual(3);
  });

  it('maps ideas only to features it really placed, in compiler order', () => {
    const req = request([
      'a drowned cathedral where the bells still ring underwater',
      'giant glowing jellyfish drift through the halls as sentries',
      'lanterns everywhere',
      'rivers of lava',
      'the Hall of Mirrors',
    ]);
    const { recipe } = composeWorld(req);
    expect(recipe.contributionMappings).toHaveLength(5);
    const kinds = recipe.contributionMappings.map((m) => m.kind);
    expect(kinds).toContain('encounter');
    expect(kinds).toContain('prop');
    expect(kinds).toContain('hazard');
    // jellyfish → swarmling encounter placed first in its room's enemy list
    const encounter = recipe.contributionMappings.find((m) => m.kind === 'encounter')!;
    expect(recipe.rooms[encounter.roomIndex]!.enemyIds[0]).toBe('swarmling');
    const prop = recipe.contributionMappings.find((m) => m.kind === 'prop')!;
    expect(recipe.rooms[prop.roomIndex]!.propIds[0]).toBe('lantern');
    const hazard = recipe.contributionMappings.find((m) => m.kind === 'hazard')!;
    expect(recipe.rooms[hazard.roomIndex]!.hazards).toBe(true);
    // The trusted compiler accepts every mapping: attributions == mappings.
    const compiled = compileWorldRecipe(recipe, { plannedRoomCount: 3, seed: 7 });
    const attributions = compiled.rooms.flatMap((r) => r.attributions);
    expect(attributions.map((a) => a.contributionId).sort()).toEqual(recipe.contributionMappings.map((m) => m.contributionId).sort());
  });

  it('always puts the guardian and anchor pedestal in the final room, even when an idea names the boss', () => {
    const { recipe } = composeWorld(request(['a dragon boss guards the vault', 'crates of gold']));
    const final = recipe.rooms.at(-1)!;
    expect(final.enemyIds).toContain('guardian');
    expect(final.propIds).toContain('anchor_pedestal');
    const encounter = recipe.contributionMappings.find((m) => m.kind === 'encounter')!;
    expect(encounter.roomIndex).toBe(recipe.rooms.length - 1);
    expect(final.enemyIds[0]).toBe('guardian');
  });

  it('survives junk, markup and empty input and never emits unsafe display text', () => {
    const junk = [
      '<script>alert(1)</script> haunted mansion',
      'https://example.com pirates',
      '```code``` function(x) { eval(x) }',
      '🦑🦑🦑 kraken',
      '     ',
      'a'.repeat(200),
      'ÜBERGROß Kathedrale mit Glocken',
    ];
    for (const text of junk) {
      const recipe = composeWorldRecipe(request([text]));
      expect(WorldRecipeSchema.safeParse(recipe).success).toBe(true);
      for (const value of displayText(recipe)) expect(value).not.toMatch(DISPLAY_GUARD);
    }
    const empty = composeWorldRecipe({ requestId: 'req-empty', sessionId: 's', contributions: [], plannedRoomCount: 3 });
    expect(empty.contributionMappings).toEqual([]);
    expect(empty.rooms).toHaveLength(3);
    const many = composeWorldRecipe(request(Array.from({ length: 24 }, (_, i) => `idea number ${i} about ${['robots', 'ghosts', 'lava', 'lanterns', 'ocean', 'forest'][i % 6]}`)));
    expect(many.contributionMappings.length).toBeLessThanOrEqual(24);
    for (let n = 1; n <= 3; n++) {
      const sized = composeWorldRecipe({ ...request(['clockwork factory']), plannedRoomCount: n });
      expect(sized.rooms).toHaveLength(n);
      expect(compileWorldRecipe(sized, { plannedRoomCount: n, seed: 1 }).rooms).toHaveLength(n);
    }
  });

  it('ships eight theme-driven floors biome briefs that the floors pipeline accepts as its own', () => {
    const { recipe, themes } = composeWorld(request(['space pirates', 'a frozen moon full of crystal moths'], 'req-briefs'));
    expect(BiomeBriefListSchema.safeParse(recipe.biomes).success).toBe(true);
    const briefs = recipe.biomes!;
    expect(briefs).toHaveLength(8);
    expect(new Set(briefs.map((b) => b.name)).size).toBe(8);
    // Choice pairs really differ: the middle slots draw on at least two construction vocabularies.
    expect(new Set(briefs.slice(1, 7).map((b) => b.motifIds[0])).size).toBeGreaterThanOrEqual(2);
    for (const brief of briefs) {
      expect(brief.enemyPool.some((e) => e !== 'guardian')).toBe(true);
      expect(brief.propPool).not.toContain('anchor_pedestal');
    }
    // A composed legacy world upgrades into a floors world using the composer's briefs, not derived ones.
    const compiled = compileWorldRecipe(recipe, { plannedRoomCount: 3, seed: 5 });
    const world = PreparedWorldSchema.parse({
      worldId: 'world-composed-briefs', createdAt: 0, recipe, art: compiled.art, rooms: compiled.rooms, plannedRoomCount: 3,
      provenance: { source: 'procedural', label: 'COMPOSED · relay-composer', model: 'relay-composer', generatedAt: 0, durationMs: 1, attempts: 1, notes: [] },
      receipt: { worldTitle: recipe.title, source: 'procedural', headline: 'h', lines: [] },
    });
    const floors = upgradeToFloors(world, floorsSeedFor(world));
    expect(floors.floors?.briefs.map((b) => b.name)).toEqual(briefs.map((b) => b.name));
    expect(floors.rooms).toHaveLength(1);
    expect(themes.primary).toBeTruthy();
  });

  it('writes text the house prose linter accepts (no hard failures) for a spread of ideas', () => {
    const prompts = ['space pirates', 'a drowned cathedral where the bells still ring', 'neon city night market run by robots', 'haunted graveyard', 'clockwork factory', 'volcanic forge', 'candy land', 'frozen research station', 'overgrown library', 'crystal caves'];
    for (const prompt of prompts) {
      const { recipe } = composeWorld(request([prompt], `req-lint-${prompt.replace(/\W+/g, '-')}`));
      const lint = lintRecipeText(recipe);
      const hard = lint.fields.filter((f) => f.result.issues.some((i) => i.severity === 'hard')).map((f) => `${f.path}: ${f.result.issues.filter((i) => i.severity === 'hard').map((i) => i.rule).join(',')}`);
      expect(hard, `${prompt} -> ${hard.join(' | ')}`).toEqual([]);
      expect(lint.score).toBeLessThan(30);
    }
  });

  it('every authored theme string passes the house linter\'s hard rules in its own kind', () => {
    const fill = (text: string) => text.replace(/\{word\}/g, 'lantern').replace(/\{flavor\}/g, 'in the hold');
    const hard: string[] = [];
    const check = (label: string, text: string, kind: Parameters<typeof lintProse>[1]['kind']) => {
      const issues = lintProse(fill(text), { kind }).issues.filter((i) => i.severity === 'hard');
      if (issues.length) hard.push(`${label}: ${issues.map((i) => i.rule).join(',')}`);
    };
    for (const theme of THEMES) {
      theme.taglines.forEach((t, i) => check(`${theme.id}.tagline[${i}]`, t, 'tagline'));
      check(`${theme.id}.summary`, theme.summary, 'themeSummary');
      for (const role of ['entry', 'mid', 'final'] as const) {
        theme.rooms[role].names.forEach((t, i) => check(`${theme.id}.${role}.name[${i}]`, t, 'roomName'));
        theme.rooms[role].descriptions.forEach((t, i) => check(`${theme.id}.${role}.desc[${i}]`, t, 'roomLine'));
      }
      theme.relics.forEach((l, i) => { check(`${theme.id}.relic[${i}].title`, l.title, 'loreTitle'); check(`${theme.id}.relic[${i}].source`, l.source, 'loreSource'); check(`${theme.id}.relic[${i}].text`, l.text, 'relic'); });
      theme.attunements.forEach((a, i) => { check(`${theme.id}.attune[${i}].name`, a.name, 'boonName'); check(`${theme.id}.attune[${i}].desc`, a.description, 'boonDescription'); });
    }
    for (const [enemy, list] of Object.entries(REMAINS_TEMPLATES)) {
      list.forEach((l, i) => { check(`remains.${enemy}[${i}].title`, l.title, 'loreTitle'); check(`remains.${enemy}[${i}].source`, l.source, 'loreSource'); check(`remains.${enemy}[${i}].text`, l.text, 'remains'); });
    }
    expect(hard).toEqual([]);
    expect(THEMES.length).toBeGreaterThanOrEqual(19);
  });

  it('produces distinct worlds across many different ideas', () => {
    const prompts = ['space pirates', 'sunken cathedral', 'neon city market', 'frozen research station', 'volcanic forge', 'haunted graveyard', 'overgrown library', 'crystal caves', 'storm-lashed airship dock', 'clockwork factory'];
    const recipes = prompts.map((p) => composeWorldRecipe(request([p])));
    expect(new Set(recipes.map((r) => r.title)).size).toBe(recipes.length);
    expect(new Set(recipes.map((r) => r.palette.floor)).size).toBeGreaterThanOrEqual(recipes.length - 1);
    expect(new Set(recipes.map((r) => r.motifIds[0])).size).toBeGreaterThanOrEqual(6);
    expect(new Set(recipes.map((r) => r.lore[0]!.text)).size).toBeGreaterThanOrEqual(8);
  });
});

describe('composer through the generation service', () => {
  it('serves an instant procedural world with honest provenance the client accepts', async () => {
    const composer = createComposerProvider();
    const service = createGenerationService({
      mode: 'live', provider: 'composer', openaiApiKey: null, openaiModel: 'unused', fixturesDir, log: () => {},
      recipeProvider: { provider: composer, model: COMPOSER_MODEL },
    });
    expect(service.info()).toMatchObject({ effectiveMode: 'live', liveConfigured: true, provider: 'composer' });
    const req = request(['space pirates', 'glowing jellyfish sentries'], 'req-composer-1');
    const phases: string[] = [];
    const world = PreparedWorldSchema.parse(await service.prepareWorld(req, (s) => phases.push(s.phase)));
    expect(world.provenance.source).toBe('procedural');
    expect(world.provenance.label).toBe(`COMPOSED · ${COMPOSER_MODEL}`);
    expect(world.receipt.source).toBe('procedural');
    expect(world.receipt.lines.filter((l) => l.used).length).toBeGreaterThanOrEqual(1);
    expect(world.receipt.headline).toMatch(/composed/i);
    expect(phases.at(-1)).toBe('ready');
    expect(world.provenance.durationMs).toBeLessThan(500);
    // The client's prefix validator accepts procedural attributions.
    expect(() => parseWorldPrefix(world, req)).not.toThrow();
  });

  it('in floors mode the service ships a floors world built on the composer\'s own briefs', async () => {
    const service = createGenerationService({
      mode: 'live', provider: 'composer', openaiApiKey: null, openaiModel: 'unused', fixturesDir, log: () => {},
      recipeProvider: { provider: createComposerProvider(), model: COMPOSER_MODEL }, floors: true,
    });
    const req = request(['a haunted space station overrun by ghost pirates'], 'req-composer-floors');
    const world = PreparedWorldSchema.parse(await service.prepareWorld(req));
    expect(world.floors).toBeDefined();
    expect(world.rooms).toHaveLength(1);
    expect(world.rooms[0]!.biomeId).toBeDefined();
    expect(world.floors!.briefs.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']);
    expect(world.floors!.briefs.map((b) => b.name)).toEqual(world.recipe.biomes!.map((b) => b.name));
    expect(world.provenance.source).toBe('procedural');
  });

  it('is used as the fallback when a live provider fails, instead of a canned fixture', async () => {
    const broken: RecipeProvider = { async generate() { throw new GenerationFailure('Provider HTTP 500.'); } };
    const service = createGenerationService({
      mode: 'live', provider: 'openai', openaiApiKey: 'unit-test-only-key', openaiModel: 'gpt-test', fixturesDir, log: () => {},
      recipeProvider: { provider: broken, model: 'gpt-test' },
      fallbackProvider: createComposerProvider(),
    });
    const world = PreparedWorldSchema.parse(await service.prepareWorld(request(['volcanic forge full of lava'], 'req-fallback-1')));
    expect(world.provenance.source).toBe('procedural');
    expect(world.provenance.label).toBe(`COMPOSED · ${COMPOSER_MODEL}`);
    expect(world.provenance.notes.join(' ')).toMatch(/Provider HTTP 500/);
    expect(world.provenance.notes.join(' ')).toMatch(/composer/i);
    expect(world.recipe.motifIds[0]).toBe('ruined_machinery');
  });
});
