import { describe, expect, it } from 'vitest';
import { RoomSpecSchema } from '../../src/shared/contracts';
import { PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../src/shared/conventions';
import { terrainSpeedMultiplier, terrainTileAt } from '../../src/shared/terrain';
import { buildSolidGrid, isSolidAt, moveCircle } from '../../src/sim/collision';
import { createTerrainState, damageBreakableWall, strikeBreakableWalls, type TerrainAttack } from '../../src/sim/terrain';

const room = RoomSpecSchema.parse({
  id: 'terrain-lab', index: 0, name: 'Terrain lab', description: '',
  width: 12, height: 8, isFinal: false, attributions: [], props: [], encounters: [],
  exits: [{ x: 11, y: 2, toRoomIndex: 1, direction: 'east' }],
  tiles: [
    '############',
    '#..........#',
    '#P.BB......X',
    '#..#B......#',
    '#..:+=>....#',
    '#..........#',
    '#..........#',
    '############',
  ],
});

const attack: TerrainAttack = {
  ...tileToWorld(1, 2), facing: 0, range: 6 * TILE_SIZE, arc: 0.1, damage: 20,
};

describe('pure runtime terrain', () => {
  it('accumulates damage immutably, destroys once and opens only the destroyed cell', () => {
    const original = createTerrainState();
    const first = damageBreakableWall(room, original, 3, 2, 20);
    expect(first.hits).toEqual([{ x: 3, y: 2, hp: 16, destroyed: false }]);
    expect(original).toEqual({ brokenWalls: [], wallDamage: {}, canisters: {}, coverDamage: {} });
    expect(isSolidAt(buildSolidGrid(room, first.state.brokenWalls), 3, 2)).toBe(true);

    const second = damageBreakableWall(room, first.state, 3, 2, 20);
    expect(second.hits).toEqual([{ x: 3, y: 2, hp: 0, destroyed: true }]);
    expect(first.state.wallDamage).toEqual({ '3,2': 20 });
    expect(second.state).toEqual({ brokenWalls: ['3,2'], wallDamage: { '3,2': 36 }, canisters: {}, coverDamage: {} });
    expect(damageBreakableWall(room, second.state, 3, 2, 100)).toEqual({ state: second.state, hits: [], armed: [] });
    const grid = buildSolidGrid(room, second.state.brokenWalls);
    expect(isSolidAt(grid, 3, 2)).toBe(false);
    expect(isSolidAt(grid, 4, 2)).toBe(true);
    expect(terrainTileAt(room, 3, 2, second.state.brokenWalls)).toBe(':');
    expect(room.tiles[2]![3]).toBe('B');
  });

  it('ignores invalid damage, ordinary walls and out-of-bounds coordinates', () => {
    const state = createTerrainState();
    for (const damage of [0, -1, NaN, Infinity]) {
      expect(damageBreakableWall(room, state, 3, 2, damage)).toEqual({ state, hits: [], armed: [] });
    }
    for (const [col, row] of [[0, 0], [1, 1], [-1, 2], [100, 100]]) {
      expect(damageBreakableWall(room, state, col!, row!, 100)).toEqual({ state, hits: [], armed: [] });
    }
    expect(terrainTileAt(room, -1, 2)).toBe(' ');
    expect(isSolidAt(buildSolidGrid(room, ['0,0']), 0, 0)).toBe(true);
  });

  it('blocks strikes behind an intact wall until a later attack after collision rebuild', () => {
    const first = strikeBreakableWalls(room, buildSolidGrid(room), createTerrainState(), { ...attack, damage: 36 });
    expect(first.hits).toEqual([{ x: 3, y: 2, hp: 0, destroyed: true }]);
    const next = strikeBreakableWalls(room, buildSolidGrid(room, first.state.brokenWalls), first.state, attack);
    expect(next.hits).toEqual([{ x: 4, y: 2, hp: 16, destroyed: false }]);
    expect(first.state.wallDamage['4,2']).toBeUndefined();
  });

  it('honors attack direction, reach, ordinary walls and blocking props', () => {
    const state = createTerrainState();
    const grid = buildSolidGrid(room);
    expect(strikeBreakableWalls(room, grid, state, { ...attack, facing: Math.PI }).hits).toEqual([]);
    expect(strikeBreakableWalls(room, grid, state, { ...attack, range: TILE_SIZE }).hits).toEqual([]);
    expect(strikeBreakableWalls(room, grid, state, { ...attack, ...tileToWorld(1, 3) }).hits).toEqual([]);
    const withProp = RoomSpecSchema.parse({
      ...room, props: [{ id: 'cover', propId: 'pillar', x: 2, y: 2 }],
    });
    expect(strikeBreakableWalls(withProp, buildSolidGrid(withProp), state, attack).hits).toEqual([]);
  });

  it('rejects nonfinite and negative attack parameters', () => {
    const state = createTerrainState();
    const grid = buildSolidGrid(room);
    for (const field of ['x', 'y', 'facing', 'range', 'arc', 'damage'] as const) {
      expect(strikeBreakableWalls(room, grid, state, { ...attack, [field]: NaN })).toEqual({ state, hits: [], armed: [] });
    }
    expect(strikeBreakableWalls(room, grid, state, { ...attack, range: -1 }).hits).toEqual([]);
    expect(strikeBreakableWalls(room, grid, state, { ...attack, arc: -1 }).hits).toEqual([]);
  });

  it('resolves world-coordinate movement effects including rubble left by destroyed walls', () => {
    for (const [col, row, expected] of [[3, 4, 0.65], [4, 4, 1.25], [5, 4, 1], [6, 4, 1], [1, 1, 1]]) {
      const position = tileToWorld(col!, row!);
      expect(terrainSpeedMultiplier(room, position.x, position.y)).toBe(expected);
    }
    const wall = tileToWorld(3, 2);
    expect(terrainSpeedMultiplier(room, wall.x, wall.y)).toBe(1);
    expect(terrainSpeedMultiplier(room, wall.x, wall.y, ['3,2'])).toBe(0.65);
  });

  it('allows ordinary circle movement across ramps and bridges without bypassing walls', () => {
    const grid = buildSolidGrid(room);
    const start = tileToWorld(4, 4);
    const moved = moveCircle(grid, start.x, start.y, PLAYER_RADIUS, 3 * TILE_SIZE, 0);
    expect(moved.x).toBeCloseTo(start.x + 3 * TILE_SIZE);
    expect(moved.blockedX).toBe(false);
    const spawn = tileToWorld(1, 2);
    const blocked = moveCircle(grid, spawn.x, spawn.y, PLAYER_RADIUS, 6 * TILE_SIZE, 0);
    expect(blocked.x).toBeLessThan(3 * TILE_SIZE);
    expect(blocked.blockedX).toBe(true);
  });
});
