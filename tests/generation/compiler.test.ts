import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PreparedWorldSchema,
  RoomSpecSchema,
  type RoomSpec,
  type WorldRecipe,
} from '../../src/shared/contracts';
import { PROP_INFO } from '../../src/shared/registry';
import { sampleContributions } from '../../src/shared/samples';
import { compileWorldRecipe } from '../../src/server/generation/compiler';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';
import { buildReceipt } from '../../src/server/generation/receipt';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const fixture = loadWorldFixtures(fixturesDir)[0]!;

describe('compileWorldRecipe', () => {
  it('deterministically compiles schema-valid rooms and art', () => {
    const first = compileWorldRecipe(fixture.recipe, { plannedRoomCount: 3, seed: 618 });
    const second = compileWorldRecipe(fixture.recipe, { plannedRoomCount: 3, seed: 618 });

    expect(second).toEqual(first);
    expect(first.rooms).toHaveLength(3);
    for (const room of first.rooms) expect(RoomSpecSchema.safeParse(room).success).toBe(true);
    expect(first.rooms.map((room) => room.index)).toEqual([0, 1, 2]);
    expect(first.rooms.at(-1)?.isFinal).toBe(true);
    expect(first.art.motifIds).toEqual(fixture.recipe.motifIds);
  });

  it('keeps a walkable route from every spawn to its exit or Anchor', () => {
    const { rooms } = compileWorldRecipe(fixture.recipe, { plannedRoomCount: 3, seed: 42 });
    for (const room of rooms) expect(hasCriticalRoute(room)).toBe(true);
  });

  it('repairs short recipes and final rooms without changing the recipe', () => {
    const recipe: WorldRecipe = {
      ...fixture.recipe,
      rooms: [
        {
          ...fixture.recipe.rooms[0]!,
          propIds: ['lantern'],
          enemyIds: ['husk'],
        },
      ],
    };
    const original = structuredClone(recipe);
    const compiled = compileWorldRecipe(recipe, { plannedRoomCount: 3, seed: 7 });

    expect(recipe).toEqual(original);
    expect(compiled.rooms).toHaveLength(3);
    expect(compiled.rooms[2]!.encounters.some((encounter) => encounter.enemyId === 'guardian')).toBe(true);
    expect(compiled.rooms[2]!.props.some((prop) => prop.propId === 'anchor_pedestal')).toBe(true);
    expect(compiled.notes.join(' ')).toMatch(/reused the final blueprint/i);
    expect(compiled.notes.join(' ')).toMatch(/Guardian/i);
  });

  it('can be assembled into a PreparedWorld with real contribution attributions', () => {
    const recipe: WorldRecipe = {
      ...fixture.recipe,
      contributionMappings: [
        {
          contributionId: sampleContributions[0]!.id,
          kind: 'prop',
          featureDescription: 'Lanterns illuminate the abandoned platform luggage.',
          roomIndex: 0,
        },
      ],
    };
    const compiled = compileWorldRecipe(recipe, { plannedRoomCount: 3, seed: 99 });
    const world = PreparedWorldSchema.parse({
      worldId: 'test-compiled-world',
      createdAt: 1,
      recipe,
      art: compiled.art,
      rooms: compiled.rooms,
      plannedRoomCount: 3,
      provenance: {
        source: 'live',
        label: 'LIVE · gpt-test',
        model: 'gpt-test',
        generatedAt: 1,
        durationMs: 25,
        attempts: 1,
        notes: compiled.notes,
      },
      receipt: buildReceipt({
        worldTitle: recipe.title,
        source: 'live',
        contributions: sampleContributions,
        mappings: recipe.contributionMappings,
      }),
    });

    expect(world.rooms[0]!.attributions[0]).toMatchObject({
      contributionId: sampleContributions[0]!.id,
      kind: 'prop',
    });
    expect(world.receipt.lines[0]).toMatchObject({ used: true });
  });
});

function hasCriticalRoute(room: RoomSpec): boolean {
  const start = findTile(room, 'P');
  const goal = findTile(room, room.isFinal ? 'A' : 'X');
  if (!start || !goal) return false;

  const blocked = new Set<string>();
  room.props.forEach((prop) => {
    const info = PROP_INFO[prop.propId];
    if (!info.blocksMovement) return;
    for (let dy = 0; dy < info.footprint.h; dy++) {
      for (let dx = 0; dx < info.footprint.w; dx++) blocked.add(`${prop.x + dx},${prop.y + dy}`);
    }
  });

  const queue = [start];
  const seen = new Set([`${start.x},${start.y}`]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    if (current.x === goal.x && current.y === goal.y) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = `${x},${y}`;
      const tile = room.tiles[y]?.[x];
      if (!tile || tile === '#' || tile === ' ' || blocked.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return false;
}

function findTile(room: RoomSpec, tile: string): { x: number; y: number } | undefined {
  for (let y = 0; y < room.tiles.length; y++) {
    const x = room.tiles[y]!.indexOf(tile);
    if (x >= 0) return { x, y };
  }
  return undefined;
}
