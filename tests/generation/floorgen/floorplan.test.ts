/**
 * Floor-plan property tests (Agent F1a). Pure, seeded, no I/O.
 */
import { describe, expect, it } from 'vitest';
import {
  BiomeBriefSchema,
  DOOR_SIDES,
  FloorPlanSchema,
  OPPOSITE_SIDE,
  ROOM_BUDGETS,
  SIDE_DELTA,
  WorldRouteSchema,
  type BiomeBrief,
  type BiomeSpecials,
  type FloorPlan,
} from '../../../src/shared/floors';
import {
  DEFAULT_BIOME_BRIEFS,
  clampDeadEndSpecials,
  combFallback,
  deadEndSpecialCap,
  eliteCap,
  generateFloorPlan,
  minExitDepth,
  nextBiomeChoices,
  planWorldRoute,
  renderFloorPlan,
} from '../../../src/server/generation/floorgen';

function brief(id: string, linearity: number, branchiness: number, specials: BiomeSpecials = { treasure: 1, lore: 1, rest: 1, elite: 1 }): BiomeBrief {
  return {
    id,
    name: id,
    tagline: 'test biome',
    motifIds: ['arches'],
    enemyPool: ['husk', 'spewer'],
    propPool: ['crate', 'lantern'],
    hazards: false,
    layout: { linearity, branchiness, specials },
  };
}

const LINEAR = brief('linear', 0.95, 0.05);
const BRANCHY = brief('branchy', 0.05, 0.95);
const MIXED = brief('mixed', 0.5, 0.5);
const GREEDY = { treasure: 2, lore: 4, rest: 2, elite: 4 };

/** Throws with a readable message on the first broken invariant; returns nothing when the plan is sound. */
function assertPlanInvariants(plan: FloorPlan, budget: number): void {
  const fail = (message: string) => {
    throw new Error(`${plan.biomeId} seed=${plan.seed}: ${message}\n${renderFloorPlan(plan)}`);
  };
  if (plan.rooms.length !== budget) fail(`expected ${budget} rooms, got ${plan.rooms.length}`);
  if (plan.stats.usedFallback) fail('hit the retry cap and used the fallback');

  const byId = new Map(plan.rooms.map((room) => [room.id, room]));
  const cells = new Set(plan.rooms.map((room) => `${room.cell.x},${room.cell.y}`));
  if (cells.size !== budget) fail('two rooms share a cell');

  let doorCount = 0;
  for (const room of plan.rooms) {
    for (const side of DOOR_SIDES) {
      const nx = room.cell.x + SIDE_DELTA[side].dx;
      const ny = room.cell.y + SIDE_DELTA[side].dy;
      const toId = room.doors[side];
      if (toId === undefined) {
        // Isaac invariant: every grid adjacency is a door (the map is a tree on the grid).
        if (cells.has(`${nx},${ny}`)) fail(`${room.id} touches a room to the ${side} without a door`);
        continue;
      }
      doorCount++;
      const other = byId.get(toId);
      if (!other) return fail(`${room.id} door ${side} leads nowhere`);
      if (other.doors[OPPOSITE_SIDE[side]] !== room.id) fail(`${room.id} door ${side} has no twin`);
      if (other.cell.x !== nx || other.cell.y !== ny) fail(`${room.id} door ${side} is not to the adjacent cell`);
    }
  }
  if (doorCount !== (budget - 1) * 2) fail(`a tree of ${budget} rooms has ${budget - 1} doors, found ${doorCount / 2}`);

  // Connected, and `depth` is the true graph distance from the entrance.
  const depth = new Map<string, number>([[plan.entranceId, 0]]);
  const queue = [plan.entranceId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const side of DOOR_SIDES) {
      const next = byId.get(id)!.doors[side];
      if (next !== undefined && !depth.has(next)) {
        depth.set(next, depth.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  if (depth.size !== budget) fail(`only ${depth.size} rooms reachable from the entrance`);
  for (const room of plan.rooms) if (depth.get(room.id) !== room.depth) fail(`${room.id} depth ${room.depth} != bfs ${depth.get(room.id)}`);

  const entrance = byId.get(plan.entranceId)!;
  const exit = byId.get(plan.exitId)!;
  const doorsOf = (id: string) => DOOR_SIDES.filter((side) => byId.get(id)!.doors[side] !== undefined).length;
  if (entrance.kind !== 'entrance' || exit.kind !== 'exit') fail('entrance/exit kinds are wrong');
  if (plan.rooms.filter((room) => room.kind === 'entrance').length !== 1) fail('more than one entrance');
  if (plan.rooms.filter((room) => room.kind === 'exit').length !== 1) fail('more than one exit');
  if (doorsOf(exit.id) !== 1) fail('exit is not a dead end');
  if (exit.depth < minExitDepth(budget)) fail(`exit depth ${exit.depth} < ${minExitDepth(budget)}`);
  if (exit.depth !== plan.stats.maxDepth) fail('exit is not the farthest room');
  if (Math.abs(exit.cell.x - entrance.cell.x) + Math.abs(exit.cell.y - entrance.cell.y) <= 1) fail('exit is adjacent to the entrance');

  for (const room of plan.rooms) {
    if (room.kind === 'shop') fail('shop is reserved and must not be generated');
    if ((room.kind === 'treasure' || room.kind === 'lore' || room.kind === 'rest') && doorsOf(room.id) !== 1) fail(`${room.kind} ${room.id} is not a dead end`);
    if (room.kind === 'elite' && room.depth < 2) fail('elite next to the entrance');
  }
}

function countKinds(plan: FloorPlan): BiomeSpecials {
  const count = (kind: string) => plan.rooms.filter((room) => room.kind === kind).length;
  return { treasure: count('treasure'), lore: count('lore'), rest: count('rest'), elite: count('elite') };
}

describe('planWorldRoute', () => {
  it('lays 8 biomes out as 1-2-2-2-1 with a pick-1-of-2 after every biome', () => {
    const route = WorldRouteSchema.parse(planWorldRoute('world-1'));
    expect(route.tiers.map((tier) => tier.length)).toEqual([1, 2, 2, 2, 1]);
    expect(route.graph.nodes.map((node) => node.roomBudget)).toEqual([10, 15, 15, 20, 20, 25, 25, 30]);
    expect(nextBiomeChoices(route, 'b0')).toEqual(['b1a', 'b1b']);
    expect(nextBiomeChoices(route, 'b2b')).toEqual(['b3a', 'b3b']);
    expect(nextBiomeChoices(route, 'b3a')).toEqual(['b4']);
    expect(nextBiomeChoices(route, 'b4')).toEqual([]);
  });

  it('keeps opener and finale fixed, shuffles the middle by seed, deterministically', () => {
    const ids = ['open', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'final'];
    const a = planWorldRoute('seed-a', ids);
    expect(planWorldRoute('seed-a', ids)).toEqual(a);
    expect(a.tiers[0]).toEqual(['open']);
    expect(a.tiers[4]).toEqual(['final']);
    expect(a.tiers.flat().sort()).toEqual([...ids].sort());
    const orders = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((seed) => planWorldRoute(seed, ids).tiers.flat().join(',')));
    expect(orders.size).toBeGreaterThan(1);
    expect(() => planWorldRoute('x', ['a', 'b'])).toThrow();
  });

  it('ships 8 schema-valid default briefs', () => {
    expect(DEFAULT_BIOME_BRIEFS).toHaveLength(8);
    for (const item of DEFAULT_BIOME_BRIEFS) expect(BiomeBriefSchema.safeParse(item).success).toBe(true);
  });
});

describe('generateFloorPlan', () => {
  it('passes the schema and every invariant for the default briefs at their own tier', () => {
    const route = planWorldRoute('world-1');
    for (const node of route.graph.nodes) {
      const item = DEFAULT_BIOME_BRIEFS.find((candidate) => candidate.id === node.biomeId)!;
      for (let i = 0; i < 25; i++) {
        const plan = generateFloorPlan(item, node.tier, `world-${i}`);
        expect(FloorPlanSchema.safeParse(plan).success).toBe(true);
        assertPlanInvariants(plan, node.roomBudget);
      }
    }
  });

  it.each(ROOM_BUDGETS.map((budget, tier) => [budget, tier] as const))(
    '1000-seed fuzz at %i rooms: exact count, tree, twinned doors, far exit, zero fallbacks',
    (budget, tier) => {
      const briefs = [LINEAR, BRANCHY, MIXED, brief('greedy-linear', 1, 0, GREEDY), brief('greedy-branchy', 0, 1, GREEDY)];
      let worstAttempts = 0;
      for (let i = 0; i < 1000; i++) {
        const plan = generateFloorPlan(briefs[i % briefs.length]!, tier, `fuzz-${i}`);
        assertPlanInvariants(plan, budget);
        worstAttempts = Math.max(worstAttempts, plan.stats.attempts);
      }
      // The strict phase ends at attempt 40; staying under it means specials were never relaxed.
      expect(worstAttempts).toBeLessThanOrEqual(40);
    },
  );

  it('honours special-room requests, clamped to the documented caps', () => {
    for (let tier = 0; tier < ROOM_BUDGETS.length; tier++) {
      const budget = ROOM_BUDGETS[tier]!;
      for (const specials of [{ treasure: 1, lore: 1, rest: 1, elite: 1 }, { treasure: 0, lore: 0, rest: 0, elite: 0 }, GREEDY, { treasure: 0, lore: 4, rest: 0, elite: 2 }]) {
        const expected = { ...clampDeadEndSpecials(specials, deadEndSpecialCap(budget)), elite: Math.min(specials.elite, eliteCap(budget)) };
        for (const [linearity, branchiness] of [[0.95, 0.05], [0.05, 0.95], [0.5, 0.5]] as const) {
          for (let i = 0; i < 40; i++) {
            const plan = generateFloorPlan(brief('sp', linearity, branchiness, specials), tier, `sp-${i}`);
            const counted = countKinds(plan);
            expect(plan.stats.specials).toEqual(counted);
            // Dead-end specials are always exact. Elites need a combat room two or more steps in,
            // which a 10-room floor can run short of: there the count may fall below the request.
            expect({ ...counted, elite: 0 }).toEqual({ ...expected, elite: 0 });
            if (tier === 0) expect(counted.elite).toBeLessThanOrEqual(expected.elite);
            else expect(counted.elite).toBe(expected.elite);
          }
        }
      }
    }
    // The clamp trims the biggest request first and keeps one of each longest.
    expect(clampDeadEndSpecials(GREEDY, 3)).toEqual({ treasure: 1, lore: 1, rest: 1 });
    expect(clampDeadEndSpecials(GREEDY, 5)).toEqual({ treasure: 1, lore: 2, rest: 2 });
    expect(clampDeadEndSpecials(GREEDY, 0)).toEqual({ treasure: 0, lore: 0, rest: 0 });
  });

  it('makes linear biomes a spine and branchy biomes a maze', () => {
    for (const tier of [1, 2, 3, 4]) {
      const mean = (item: BiomeBrief, pickStat: (plan: FloorPlan) => number) => {
        let sum = 0;
        for (let i = 0; i < 120; i++) sum += pickStat(generateFloorPlan(item, tier, `shape-${i}`));
        return sum / 120;
      };
      const linearDepth = mean(LINEAR, (plan) => plan.stats.maxDepth);
      const branchyDepth = mean(BRANCHY, (plan) => plan.stats.maxDepth);
      const linearEnds = mean(LINEAR, (plan) => plan.stats.deadEnds);
      const branchyEnds = mean(BRANCHY, (plan) => plan.stats.deadEnds);
      expect(linearDepth).toBeGreaterThan(branchyDepth * 1.8);
      expect(branchyEnds).toBeGreaterThan(linearEnds * 1.4);
      // A linear floor spends most of its rooms on the critical path.
      expect(linearDepth).toBeGreaterThan(ROOM_BUDGETS[tier]! * 0.55);
    }
  });

  it('is deterministic: same inputs → byte-identical JSON; seed and biome id both matter', () => {
    for (let tier = 0; tier < 5; tier++) {
      const a = JSON.stringify(generateFloorPlan(MIXED, tier, 'det'));
      expect(JSON.stringify(generateFloorPlan(MIXED, tier, 'det'))).toBe(a);
      expect(JSON.stringify(generateFloorPlan(MIXED, tier, 'det-2'))).not.toBe(a);
      expect(JSON.stringify(generateFloorPlan({ ...MIXED, id: 'mixed-2' }, tier, 'det').rooms)).not.toBe(JSON.stringify(JSON.parse(a).rooms));
    }
    const layouts = new Set(Array.from({ length: 50 }, (_, i) => renderFloorPlan(generateFloorPlan(MIXED, 2, `variety-${i}`))));
    expect(layouts.size).toBeGreaterThan(45);
  });

  it('supports custom budgets and rejects invalid briefs', () => {
    for (const roomBudget of [6, 8, 12, 33, 40]) {
      for (let i = 0; i < 30; i++) assertPlanInvariants(generateFloorPlan(MIXED, 2, `custom-${i}`, { roomBudget }), roomBudget);
    }
    expect(() => generateFloorPlan({ ...MIXED, enemyPool: ['guardian'] }, 0, 'x')).toThrow();
    expect(() => generateFloorPlan({ ...MIXED, layout: { ...MIXED.layout, linearity: 2 } }, 0, 'x')).toThrow();
  });

  it('has a fallback comb that is a valid tree with the exact count for every budget', () => {
    for (let budget = 6; budget <= 40; budget++) {
      const map = combFallback(budget);
      expect(map.rooms).toHaveLength(budget);
      const cells = new Map(map.rooms.map((room) => [`${room.x},${room.y}`, room]));
      expect(cells.size).toBe(budget);
      let adjacencies = 0;
      for (const room of map.rooms) {
        expect(room.x >= 0 && room.y >= 0 && room.x < map.width && room.y < map.height).toBe(true);
        for (const side of DOOR_SIDES) if (cells.has(`${room.x + SIDE_DELTA[side].dx},${room.y + SIDE_DELTA[side].dy}`)) adjacencies++;
      }
      expect(adjacencies).toBe((budget - 1) * 2); // no loops: every adjacency is a parent/child pair
      const far = Math.max(...map.rooms.map((room) => room.depth));
      expect(far).toBeGreaterThanOrEqual(minExitDepth(budget));
    }
  });

  it('prints a readable ASCII map', () => {
    const plan = generateFloorPlan(DEFAULT_BIOME_BRIEFS[2]!, 1, 'doc');
    const art = renderFloorPlan(plan);
    expect(art.match(/S/g)).toHaveLength(1);
    expect(art.match(/X/g)).toHaveLength(1);
    expect(art.match(/[SoETLRX]/g)).toHaveLength(15);
    expect(art.match(/[-|]/g)).toHaveLength(14);
    expect(art).toMatchInlineSnapshot(`
      "  E-o-o
        |   |
      o-o   o-T
      |     |
      E   L-E
      |     |
      X     o
            |
            o-S
              |
              R"
    `);
  });
});
