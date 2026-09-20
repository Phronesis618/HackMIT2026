import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RoomSpec } from '../../src/shared/contracts';
import { PLAYER_RADIUS, tileToWorld } from '../../src/shared/conventions';
import { MOTIF_IDS, PROP_IDS, WALKABLE_TILES } from '../../src/shared/registry';
import { buildSolidGrid, circleHitsSolid } from '../../src/sim/collision';
import { clearPath } from '../../src/sim/combat';
import { compileWorldRecipe, loadWorldFixtures } from '../../src/server/generation';

const recipe = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'))
  .find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;

function reachable(room: RoomSpec): Set<string> {
  const solid = buildSolidGrid(room);
  const y = room.tiles.findIndex((row) => row.includes('P'));
  const queue = [{ x: room.tiles[y]!.indexOf('P'), y }];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const tile = queue[i]!;
    const key = `${tile.x},${tile.y}`;
    const value = room.tiles[tile.y]?.[tile.x];
    const center = tileToWorld(tile.x, tile.y);
    if (!value || !WALKABLE_TILES.has(value) || value === '~' || seen.has(key) ||
      circleHitsSolid(solid, center.x, center.y, PLAYER_RADIUS)) continue;
    seen.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: tile.x + dx, y: tile.y + dy };
      if (clearPath(solid, center, tileToWorld(next.x, next.y), PLAYER_RADIUS, 'solid')) queue.push(next);
    }
  }
  return seen;
}

describe('compiled relic access', () => {
  it('does not put the second-room relic inside the arches seed 13 prop enclosure', () => {
    const room = compileWorldRecipe({
      ...recipe,
      rooms: [{ ...recipe.rooms[0]!, motifIds: ['arches'], propIds: [...PROP_IDS.slice(0, 6)], hazards: false }],
    }, { seed: 13, plannedRoomCount: 3 }).rooms[1]!;
    expect(room.relics).toHaveLength(2);
    for (const relic of room.relics) expect(reachable(room).has(`${relic.x},${relic.y}`)).toBe(true);
  });

  it('places relics on floor the player can reach after props and terrain are placed', () => {
    for (const motif of MOTIF_IDS) {
      for (let seed = 0; seed < 20; seed++) {
        const compiled = compileWorldRecipe({
          ...recipe,
          rooms: [{ ...recipe.rooms[0]!, motifIds: [motif], propIds: [...PROP_IDS.slice(0, 6)], hazards: false }],
        }, { seed, plannedRoomCount: 3 });
        for (const room of compiled.rooms) {
          const reached = reachable(room);
          for (const relic of room.relics) {
            expect(reached.has(`${relic.x},${relic.y}`), `${motif} seed ${seed}, room ${room.index}, relic ${relic.x},${relic.y}`).toBe(true);
          }
        }
      }
    }
  });
});
