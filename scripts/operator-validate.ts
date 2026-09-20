/**
 * Operator pre-flight (demo-only): validate a WorldRecipe reply exactly as the server will
 * before dropping it into .relay/operator/outbox. Zod schema, display-text guard, compiler.
 *
 *   npx tsx scripts/operator-validate.ts <recipe.json> [plannedRoomCount=3]
 *
 * Exit code 0 = the server would accept it; 1 = it would be rejected (reasons printed).
 */
import fs from 'node:fs';
import { WorldRecipeSchema, type WorldRecipe } from '../src/shared/contracts';
import { compileWorldRecipe } from '../src/server/generation/compiler';

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/operator-validate.ts <recipe.json> [plannedRoomCount]');
  process.exit(2);
}
const plannedRoomCount = Number(process.argv[3] ?? 3);
let raw: unknown;
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
} catch (error) {
  console.log(`INVALID: not JSON — ${(error as Error).message}`);
  process.exit(1);
}
const parsed = WorldRecipeSchema.safeParse(raw);
if (!parsed.success) {
  console.log('INVALID: schema');
  for (const issue of parsed.error.issues) console.log(` - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  process.exit(1);
}
const recipe: WorldRecipe = parsed.data;
const displayText = [
  recipe.title, recipe.tagline, recipe.themeSummary,
  ...recipe.rooms.flatMap((room) => [room.name, room.description]),
  ...recipe.contributionMappings.map((mapping) => mapping.featureDescription),
  ...recipe.lore.flatMap((fragment) => [fragment.title, fragment.source, fragment.text]),
];
const offending = displayText.find((value) => /[<>]|```|(?:https?:\/\/|www\.|data:|javascript:)|\b(?:eval|function)\s*\(/i.test(value));
if (offending) {
  console.log(`INVALID: display text contains markup, a URL or code: ${offending}`);
  process.exit(1);
}
try {
  const compiled = compileWorldRecipe(recipe, { plannedRoomCount, seed: 1 });
  console.log(`OK: "${recipe.title}" — ${compiled.rooms.length} room(s) compile${compiled.notes.length ? `; notes: ${compiled.notes.join(' | ')}` : ''}`);
  console.log(`lengths: title ${recipe.title.length}/40, tagline ${recipe.tagline.length}/80, summary ${recipe.themeSummary.length}/400, lore ${recipe.lore.length}/12, rooms ${recipe.rooms.length}/${plannedRoomCount}`);
} catch (error) {
  console.log(`INVALID: compiler rejected the recipe — ${(error as Error).message}`);
  process.exit(1);
}
