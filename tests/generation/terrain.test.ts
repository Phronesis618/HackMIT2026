import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  RoomBlueprintSchema, RoomSpecSchema, RoomTerrainSchema,
  type RoomSpec, type RoomTerrain,
} from '../../src/shared/contracts';
import { ANCHOR_RANGE, LORE_READ_RANGE, TILE_SIZE } from '../../src/shared/conventions';
import {
  MOTIF_IDS, PROP_INFO, PROP_IDS, TERRAIN_DENSITIES, TERRAIN_FEATURE_IDS, TERRAIN_LAYOUT_IDS,
} from '../../src/shared/registry';
import { buildSolidGrid, isSolidAt } from '../../src/sim/collision';
import { compileWorldRecipe } from '../../src/server/generation/compiler';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const recipe = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
/**
 * PR #16's four movement features. `RoomTerrain.features` is capped at 4, so the combat-facing
 * ids from docs/design/TILES.md are exercised by their own cases rather than by one mega-list.
 */
const MOVEMENT_FEATURES = ['breakable_walls', 'bridges', 'rubble', 'conduits'] as const;
const allTerrain: RoomTerrain = { features: [...MOVEMENT_FEATURES], layout: 'crossroads', density: 'balanced' };

function reachable(room: RoomSpec): Set<string> {
  const grid = buildSolidGrid(room);
  const y = room.tiles.findIndex((line) => line.includes('P'));
  const queue = [{ x: room.tiles[y]!.indexOf('P'), y }];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    const key = `${point.x},${point.y}`;
    if (seen.has(key) || isSolidAt(grid, point.x, point.y) || room.tiles[point.y]?.[point.x] === '~') continue;
    seen.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      queue.push({ x: point.x + dx!, y: point.y + dy! });
    }
  }
  return seen;
}

function assertRelays(room: RoomSpec): void {
  expect(room.anchorRelays).toHaveLength(3);
  const relays = room.anchorRelays!;
  const reached = reachable(room);
  const coreY = room.tiles.findIndex((line) => line.includes('A'));
  const coreX = room.tiles[coreY]!.indexOf('A');
  for (const relic of room.relics) {
    expect(Math.hypot(relic.x - coreX, relic.y - coreY) * TILE_SIZE).toBeGreaterThan(LORE_READ_RANGE + ANCHOR_RANGE);
  }
  expect(new Set(relays.map(({ x, y }) => `${x},${y}`)).size).toBe(3);
  for (const relay of relays) {
    expect(room.tiles[relay.y]![relay.x]).toBe('.');
    expect(reached.has(`${relay.x},${relay.y}`)).toBe(true);
    for (const relic of room.relics) {
      expect(Math.hypot(relic.x - relay.x, relic.y - relay.y) * TILE_SIZE).toBeGreaterThan(LORE_READ_RANGE + ANCHOR_RANGE);
    }
    for (const prop of room.props) {
      const { w, h } = PROP_INFO[prop.propId].footprint;
      expect(relay.x >= prop.x && relay.x < prop.x + w && relay.y >= prop.y && relay.y < prop.y + h).toBe(false);
    }
    for (const other of relays) {
      if (other !== relay) expect(Math.hypot(relay.x - other.x, relay.y - other.y)).toBeGreaterThanOrEqual(4);
    }
  }
}

describe('terrain schema boundary', () => {
  it('accepts legacy room recipes and nullable defaults while requiring the key in provider JSON', () => {
    const { terrain, ...legacy } = recipe.rooms[0]!;
    expect(RoomBlueprintSchema.safeParse(legacy).success).toBe(true);
    expect(RoomBlueprintSchema.safeParse({ ...legacy, terrain: null }).success).toBe(true);
    expect(terrain).toBeDefined();
    expect(z.toJSONSchema(RoomBlueprintSchema)).toMatchObject({
      required: expect.arrayContaining(['terrain']),
      additionalProperties: false,
      properties: {
        terrain: {
          anyOf: expect.arrayContaining([
            { type: 'null' },
            expect.objectContaining({ required: ['features', 'layout', 'density'], additionalProperties: false }),
          ]),
        },
      },
    });
  });

  it('rejects unsupported mechanics, layouts and densities', () => {
    expect(RoomTerrainSchema.safeParse(allTerrain).success).toBe(true);
    for (const terrain of [
      { ...allTerrain, features: ['flight'] },
      { ...allTerrain, features: [...TERRAIN_FEATURE_IDS, 'rubble'] },
      { ...allTerrain, layout: 'teleport' },
      { ...allTerrain, density: 'unlimited' },
    ]) expect(RoomTerrainSchema.safeParse(terrain).success).toBe(false);
  });

  it('rejects a blocking prop on any special terrain or breakable wall', () => {
    const room = compileWorldRecipe(recipe, { plannedRoomCount: 1, seed: 7 }).rooms[0]!;
    const row = room.tiles.findIndex((line) => line.includes('.'));
    const col = room.tiles[row]!.indexOf('.');
    for (const tile of ['B', '=', '>', ':', '+', '~']) {
      const tiles = [...room.tiles];
      tiles[row] = `${tiles[row]!.slice(0, col)}${tile}${tiles[row]!.slice(col + 1)}`;
      expect(RoomSpecSchema.safeParse({
        ...room, tiles, props: [{ id: 'invalid-cover', propId: 'pillar', x: col, y: row }],
      }).success).toBe(false);
    }
    expect(RoomSpecSchema.safeParse({ ...room, anchorRelays: undefined }).success).toBe(true);
    expect(RoomSpecSchema.safeParse({ ...room, anchorRelays: room.anchorRelays!.slice(0, 2) }).success).toBe(false);
  });
});

describe('deterministic terrain compiler', () => {
  it('keeps three relic interaction zones clear of every relay and the central Anchor', () => {
    const crowded = {
      ...recipe,
      rooms: recipe.rooms.map((room) => ({ ...room, terrain: { ...allTerrain, density: 'dense' as const } })),
      lore: recipe.lore.filter((fragment) => fragment.kind === 'relic').slice(0, 3)
        .map((fragment) => ({ ...fragment, roomIndex: 2 })),
    };
    for (let seed = 0; seed < 40; seed++) {
      const room = compileWorldRecipe(crowded, { plannedRoomCount: 3, seed }).rooms[2]!;
      expect(room.relics).toHaveLength(3);
      assertRelays(room);
    }
  });

  it('implements every selected mechanic while retaining safe corridors, props and spread relays', () => {
    for (const motif of MOTIF_IDS) {
      for (const layout of TERRAIN_LAYOUT_IDS) {
        for (const density of TERRAIN_DENSITIES) {
          for (let seed = 0; seed < 8; seed++) {
            const generated = compileWorldRecipe({
              ...recipe,
              rooms: [{
                ...recipe.rooms[0]!, motifIds: [motif], propIds: [...PROP_IDS.slice(seed % 5, seed % 5 + 6)],
                hazards: true, terrain: { ...allTerrain, layout, density },
              }],
            }, { plannedRoomCount: 1, seed });
            const room = generated.rooms[0]!;
            expect(RoomSpecSchema.safeParse(room).success).toBe(true);
            for (const tile of ['B', '=', '>', ':', '+']) expect(room.tiles.join('')).toContain(tile);
            const spawnY = room.tiles.findIndex((line) => line.includes('P'));
            expect(room.tiles[spawnY]!.slice(1, -1)).toMatch(/^P\.+A\.$/);
            for (const prop of room.props.filter((p) => PROP_INFO[p.propId].blocksMovement)) {
              const { w, h } = PROP_INFO[prop.propId].footprint;
              for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) expect(room.tiles[prop.y + dy]![prop.x + dx]).toBe('.');
              }
            }
            assertRelays(room);
          }
        }
      }
    }
  });

  it('builds crossings with two ramp approaches and walls on the perpendicular axis', () => {
    for (const layout of TERRAIN_LAYOUT_IDS) {
      const compiled = compileWorldRecipe({
        ...recipe, rooms: [{ ...recipe.rooms[0]!, terrain: { ...allTerrain, layout, density: 'dense' } }],
      }, { plannedRoomCount: 3, seed: 94 });
      for (const room of compiled.rooms) {
        for (let y = 1; y < room.height - 1; y++) {
          for (let x = 1; x < room.width - 1; x++) {
            if (room.tiles[y]![x] !== '=') continue;
            const sides = [
              room.tiles[y]![x - 1], room.tiles[y]![x + 1], room.tiles[y - 1]![x], room.tiles[y + 1]![x],
            ].join('');
            expect(['>>##', '##>>']).toContain(sides);
          }
        }
      }
      expect(compiled.rooms.slice(0, 2).every((room) => room.anchorRelays === undefined)).toBe(true);
    }
  });

  it('is reproducible and lets explicit empty feature selections opt out', () => {
    const options = { seed: 912, plannedRoomCount: 3 };
    expect(compileWorldRecipe(recipe, options)).toEqual(compileWorldRecipe(recipe, options));
    const empty = compileWorldRecipe({
      ...recipe, rooms: [{ ...recipe.rooms[0]!, terrain: { ...allTerrain, features: [] } }],
    }, options);
    for (const room of empty.rooms) expect(room.tiles.join('')).not.toMatch(/[B=>:+]/);
    const defaults = compileWorldRecipe({
      ...recipe, rooms: [{ ...recipe.rooms[0]!, terrain: null }],
    }, options);
    expect(defaults.rooms[0]!.tiles.join('')).toMatch(/[B=>:+]/);
  });

  it('ships all authored fixtures through the compiler with final relays and varied terrain', () => {
    const seeds: Record<string, number> = { 'vantage-spire': 2027, 'crystal-tide': 618, 'root-archive': 2026 };
    const palette = new Set<string>();
    for (const fixture of fixtures) {
      const compiled = compileWorldRecipe(fixture.recipe, { seed: seeds[fixture.fixtureId]!, plannedRoomCount: 3 });
      expect(fixture.rooms.map(({ id, ...room }) => room)).toEqual(compiled.rooms.map(({ id, ...room }) => room));
      expect(fixture.art.palette).toEqual(compiled.art.palette);
      expect(fixture.art.motifIds).toEqual(compiled.art.motifIds);
      expect(fixture.recipe.contributionMappings).toEqual([]);
      expect(fixture.fixtureNote).toContain('Authored offline');
      assertRelays(fixture.rooms[2]!);
      for (const room of fixture.rooms) {
        for (const char of room.tiles.join('')) palette.add(char);
      }
    }
    for (const tile of ['B', '=', '>', ':', '+']) expect(palette.has(tile)).toBe(true);
  });
});
