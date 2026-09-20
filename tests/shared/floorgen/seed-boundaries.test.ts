import { describe, expect, it } from 'vitest';
import { FloorPlanSchema, WorldFloorsSchema } from '../../../src/shared/floors';
import {
  DEFAULT_BIOME_BRIEFS, createFloorRuntime, generateFloorPlan, minExitDepth, planWorldRoute,
} from '../../../src/shared/floorgen';

describe('maximum-length world seeds', () => {
  it.each([
    ['plain', 'x'.repeat(128)],
    ['pipes', '|'.repeat(128)],
    ['backslashes', '\\'.repeat(128)],
    ['mixed escaping', '\\|'.repeat(64)],
  ])('produces valid deterministic connected plans for %s', (_, seed) => {
    const floors = WorldFloorsSchema.parse({ seed, route: planWorldRoute(seed), briefs: DEFAULT_BIOME_BRIEFS });
    const runtime = createFloorRuntime(floors);
    for (const node of floors.route.graph.nodes) {
      const brief = floors.briefs.find((item) => item.id === node.biomeId)!;
      const plan = generateFloorPlan(brief, node.tier, seed);
      expect(FloorPlanSchema.parse(plan)).toEqual(plan);
      expect(plan.seed).toBe(seed);
      expect(generateFloorPlan(brief, node.tier, seed)).toEqual(plan);
      expect(runtime.plan(node.biomeId)).toEqual(plan);
      expect(plan.rooms).toHaveLength(node.roomBudget);
      expect(new Set(plan.rooms.map((room) => `${room.cell.x},${room.cell.y}`)).size).toBe(node.roomBudget);
      expect(plan.rooms.reduce((sum, room) => sum + Object.keys(room.doors).length, 0)).toBe(2 * (node.roomBudget - 1));

      const byId = new Map(plan.rooms.map((room) => [room.id, room]));
      const depths = new Map([[plan.entranceId, 0]]);
      const queue = [plan.entranceId];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]!;
        for (const neighbour of Object.values(byId.get(id)!.doors)) {
          if (depths.has(neighbour)) continue;
          depths.set(neighbour, depths.get(id)! + 1);
          queue.push(neighbour);
        }
      }
      expect(depths.size).toBe(node.roomBudget);
      for (const room of plan.rooms) expect(depths.get(room.id)).toBe(room.depth);
      expect(depths.get(plan.exitId)).toBeGreaterThanOrEqual(minExitDepth(node.roomBudget));
      expect(depths.get(plan.exitId)).toBe(plan.stats.maxDepth);
    }
  });
});
