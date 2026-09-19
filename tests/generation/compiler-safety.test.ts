import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomSpecSchema, type RoomSpec } from '../../src/shared/contracts';
import { MOTIF_IDS, PROP_INFO, PROP_IDS, ENEMY_IDS } from '../../src/shared/registry';
import { compileWorldRecipe } from '../../src/server/generation/compiler';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const recipe = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;

function blocked(room: RoomSpec): Set<string> {
  const occupied = new Set<string>();
  for (const prop of room.props) {
    const { w, h } = PROP_INFO[prop.propId].footprint;
    for (let y = prop.y; y < prop.y + h; y++) {
      for (let x = prop.x; x < prop.x + w; x++) {
        expect(room.tiles[y]?.[x]).toBe(prop.propId === 'anchor_pedestal' && room.isFinal ? 'A' : '.');
        expect(occupied.has(`${x},${y}`)).toBe(false);
        occupied.add(`${x},${y}`);
      }
    }
  }
  return occupied;
}

describe('compiler geometry and fixture variety', () => {
  it('places every registry prop and encounter safely across motifs, seeds and room counts', () => {
    for (const motif of MOTIF_IDS) {
      for (let seed = 0; seed < 20; seed++) {
        const plannedRoomCount = seed % 3 + 1;
        const compiled = compileWorldRecipe({
          ...recipe,
          rooms: [{
            ...recipe.rooms[0]!,
            motifIds: [motif], propIds: [...PROP_IDS.slice(seed % 4, seed % 4 + 6)],
            enemyIds: [...ENEMY_IDS.slice(seed % 2, seed % 2 + 3)], hazards: seed % 2 === 0,
          }],
        }, { seed, plannedRoomCount });
        for (const room of compiled.rooms) {
          expect(RoomSpecSchema.safeParse(room).success).toBe(true);
          const occupied = blocked(room);
          for (const encounter of room.encounters) {
            const padding = encounter.enemyId === 'guardian' ? 1 : 0;
            for (let y = encounter.y - padding; y <= encounter.y + padding; y++) {
              for (let x = encounter.x - padding; x <= encounter.x + padding; x++) {
                expect(room.tiles[y]?.[x]).toBe('.');
                expect(occupied.has(`${x},${y}`)).toBe(false);
                occupied.add(`${x},${y}`);
              }
            }
          }
          const spawnY = room.tiles.findIndex((row) => row.includes('P'));
          for (let x = 1; x < room.width - 1; x++) {
            expect(['.', 'P', 'A']).toContain(room.tiles[spawnY]![x]);
            expect(room.props.some((prop) => PROP_INFO[prop.propId].blocksMovement && prop.x === x && prop.y === spawnY)).toBe(false);
          }
          if (room.isFinal) {
            const pedestal = room.props.find((prop) => prop.propId === 'anchor_pedestal')!;
            expect(room.tiles[pedestal.y]![pedestal.x]).toBe('A');
            expect(room.encounters.some((encounter) => encounter.enemyId === 'guardian')).toBe(true);
          }
        }
      }
    }
  });

  it('has three authored fallback identities that differ beyond palette', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    for (const select of [
      (room: typeof fixtures[number]) => room.art.motifIds,
      (world: typeof fixtures[number]) => world.rooms.map((room) => room.tiles),
      (world: typeof fixtures[number]) => world.rooms.map((room) => room.props.map((prop) => prop.propId)),
      (world: typeof fixtures[number]) => world.rooms.map((room) => room.encounters.map((encounter) => encounter.enemyId)),
    ]) {
      expect(new Set(fixtures.map((fixture) => JSON.stringify(select(fixture)))).size).toBe(fixtures.length);
    }
    for (const fixture of fixtures) expect(fixture.recipe.contributionMappings).toEqual([]);
  });
});
