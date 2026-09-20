/**
 * The offline fixtures are the demo's safety net and the house-style exemplars, so every
 * prose field in them is held to docs/WRITING.md via the same linter the live pipeline uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FloorsWorldRecipeSchema, WorldFixtureSchema } from '../../src/shared/contracts';
import { BIOME_BRIEF_COUNT } from '../../src/shared/floors';
import { custodianMovesValid, sanitizeLaws } from '../../src/shared/laws';
import { lintRecipeText } from '../../src/shared/prose';
import { FIXTURE_BUILDS, buildFixture, fixturePath } from '../../src/server/generation/buildFixtures';
import { lintWorld, parseFullRecipe } from '../../src/server/generation/stages';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const fixtureFiles = fs.readdirSync(fixturesDir).filter((name) => name.endsWith('.json')).sort();

const load = (file: string) => {
  const stored = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8')) as unknown;
  const fixture = WorldFixtureSchema.parse(stored);
  const recipe = FloorsWorldRecipeSchema.parse(fixture.recipe);
  return { fixture, recipe };
};

describe.each(fixtureFiles)('fixture %s', (file) => {
  const { fixture, recipe } = load(file);
  const bible = recipe.bible;

  it('passes WorldFixtureSchema and parseFullRecipe', () => {
    expect(fixture.fixtureId).toBe(file.replace(/\.json$/, ''));
    expect(fixture.fixtureNote).toMatch(/fixture|authored/i);
    const parsed = parseFullRecipe(fixture.recipe);
    expect(parsed.recipe.title).toBe(recipe.title);
    expect(parsed.notes).toEqual([]);
  });

  it('has a bible with three authors and lore by one author about one event', () => {
    expect(bible).toBeDefined();
    if (!bible) return;
    expect(bible.authors).toHaveLength(3);
    expect(bible.people.length).toBeGreaterThanOrEqual(3);
    expect(bible.collapse).not.toMatch(/clerical|paperwork|filing error|misfiled/i);
    for (const fragment of recipe.lore) {
      expect(fragment.authorIndex).toBeTypeOf('number');
      expect(fragment.eventIndex).toBeTypeOf('number');
      expect(bible.authors[fragment.authorIndex!]).toBeDefined();
      expect(bible.events[fragment.eventIndex!]).toBeDefined();
    }
    expect(new Set(recipe.lore.map((l) => l.authorIndex)).size).toBe(3);
  });

  it('has eight authored biome briefs, laws that survive sanitizeLaws, a look and a Custodian', () => {
    expect(recipe.biomes).toHaveLength(BIOME_BRIEF_COUNT);
    expect(new Set(recipe.biomes!.map((b) => b.name)).size).toBe(BIOME_BRIEF_COUNT);
    expect(recipe.laws!.length).toBeGreaterThanOrEqual(2);
    expect(sanitizeLaws(recipe.laws!).dropped).toBe(0);
    expect(recipe.look).toBeDefined();
    expect(recipe.terrainSkins!.length).toBeGreaterThan(0);
    const custodian = recipe.custodian!;
    const enemyKinds = new Set(bible!.enemies.map((e) => e.enemyId).filter((e) => e !== 'guardian')).size;
    expect(custodianMovesValid(custodian.moves.map((m) => m.patternId), enemyKinds)).toBe(true);
  });

  it('every prose field passes lintRecipeText with its bible, zero hard fails', () => {
    const result = lintRecipeText(recipe, { bible });
    expect(result.fields.length).toBeGreaterThan(40);
    const failures = result.fields.filter((f) => f.result.hardFail).map((f) => `${f.path}: ${f.text} -> ${f.result.issues.map((i) => i.rule).join(', ')}`);
    expect(failures).toEqual([]);

    const world = lintWorld(recipe, bible);
    expect(world.failures.map((f) => `${f.path}: ${f.notes.join('; ')}`)).toEqual([]);
  });

  it('recompiles to identical rooms and art from its fixed seed', () => {
    const build = FIXTURE_BUILDS.find((b) => b.fixtureId === fixture.fixtureId);
    expect(build).toBeDefined();
    const rebuilt = buildFixture(build!, recipe);
    expect(rebuilt).toEqual(fixture);
    expect(fs.existsSync(fixturePath(fixture.fixtureId))).toBe(true);
  });
});

describe('fixture worlds side by side', () => {
  const recipes = fixtureFiles.map((file) => load(file).recipe);

  it('differ in look, law set and collapse cause', () => {
    const looks = recipes.map((r) => r.look!);
    for (const key of ['paletteFamily', 'floorMaterial', 'wallStyle', 'lighting', 'atmosphere'] as const) {
      expect(new Set(looks.map((l) => l[key])).size).toBe(recipes.length);
    }
    const lawSets = recipes.map((r) => r.laws!.map((l) => l.lawId).sort().join(','));
    expect(new Set(lawSets).size).toBe(recipes.length);
    const biomeNames = recipes.flatMap((r) => r.biomes!.map((b) => b.name));
    expect(new Set(biomeNames).size).toBe(biomeNames.length);
  });
});
