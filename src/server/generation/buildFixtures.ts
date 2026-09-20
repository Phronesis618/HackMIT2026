/**
 * Recompiles the offline fixtures in fixtures/worlds from the recipe each file already holds.
 *
 * The JSON files are the authored source: title, bible, lore, biome briefs, laws, look,
 * terrain skins and the Custodian all live there and are edited by hand. This script only
 * regenerates what is derived from them, the three legacy rooms and the art recipe, with a
 * fixed seed per fixture so the geometry never drifts between runs.
 *
 *   npx tsx src/server/generation/buildFixtures.ts
 */
import fs from 'node:fs';
import { FloorsWorldRecipeSchema, WorldFixtureSchema, type ArtRecipe, type WorldFixture } from '../../shared/contracts';
import { compileWorldRecipe } from './compiler';

export const FIXTURE_NOTE = 'Authored offline theme compiled with a fixed seed. Not generated from player contributions.';

export const FIXTURE_BUILDS: ReadonlyArray<{ fixtureId: string; seed: number; roomIdPrefix?: string; artOverrides?: Partial<ArtRecipe> }> = [
  { fixtureId: 'vantage-spire', seed: 2027, roomIdPrefix: 'vantage-spire', artOverrides: { skyline: 'spires', fog: 0.35, glowIntensity: 0.6 } },
  { fixtureId: 'crystal-tide', seed: 618 },
  { fixtureId: 'root-archive', seed: 2026 },
];

export const fixturePath = (fixtureId: string): URL => new URL(`../../../fixtures/worlds/${fixtureId}.json`, import.meta.url);

/** The fixture as it should be on disk for its stored recipe: rooms and art recompiled from the seed. */
export function buildFixture(build: (typeof FIXTURE_BUILDS)[number], rawRecipe: unknown): WorldFixture {
  const recipe = FloorsWorldRecipeSchema.parse(rawRecipe);
  const { rooms, art } = compileWorldRecipe(recipe, { seed: build.seed, plannedRoomCount: 3 });
  return WorldFixtureSchema.parse({
    fixtureId: build.fixtureId,
    fixtureNote: FIXTURE_NOTE,
    plannedRoomCount: 3,
    recipe,
    art: { ...art, ...build.artOverrides },
    rooms: rooms.map((room) => ({ ...room, id: build.roomIdPrefix ? `${build.roomIdPrefix}-room-${room.index}` : room.id })),
  });
}

export function readStoredRecipe(fixtureId: string): unknown {
  const stored = JSON.parse(fs.readFileSync(fixturePath(fixtureId), 'utf8')) as { recipe?: unknown };
  return stored.recipe;
}

if (process.argv[1] && /buildFixtures\.ts$/.test(process.argv[1])) {
  for (const build of FIXTURE_BUILDS) {
    const fixture = buildFixture(build, readStoredRecipe(build.fixtureId));
    fs.writeFileSync(fixturePath(build.fixtureId), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`Wrote ${build.fixtureId}.`);
  }
}
