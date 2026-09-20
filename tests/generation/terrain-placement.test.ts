/**
 * The generator's half of docs/design/TILES.md: every room it produces must pass
 * `validateRoomSafety` (§5 S1/S2/S4/S8) with the combat-facing tiles switched on, and two runs
 * of the same seed must be byte-identical (co-op determinism).
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomSpecSchema, type RoomSpec } from '../../src/shared/contracts';
import { TERRAIN_DENSITIES, TERRAIN_LAYOUT_IDS, TILE_CHARS } from '../../src/shared/registry';
import { validateRoomSafety } from '../../src/shared/terrain';
import {
  applyBiomeTerrain, buildRoom, deriveBiomeBriefs, generateFloorPlan, DEFAULT_BIOME_BRIEFS,
} from '../../src/shared/floorgen';
import type { BiomeTerrain } from '../../src/shared/floors';
import { compileWorldRecipe } from '../../src/server/generation/compiler';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const recipe = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
const LEGAL = new Set<string>(TILE_CHARS);

/** The combat-facing feature sets a room may ask for, four at a time (the schema's cap). */
const COMBAT_TERRAINS: BiomeTerrain[] = [
  { features: ['canisters', 'pits', 'vents', 'rubble'], layout: 'scattered', density: 'dense' },
  { features: ['canisters', 'pits', 'bridges', 'breakable_walls'], layout: 'crossroads', density: 'balanced' },
  { features: ['vents', 'pits', 'hazard_floor'], layout: 'barricades', density: 'sparse' },
];

describe('terrain placement keeps every generated room safe', () => {
  it('passes validateRoomSafety over a thousand floors rooms, and repeats byte for byte', () => {
    let rooms = 0;
    let canisterRooms = 0;
    let pitRooms = 0;
    let ventRooms = 0;
    for (let s = 0; rooms < 1000; s++) {
      const seed = `placement-${s}`;
      const brief = DEFAULT_BIOME_BRIEFS[s % DEFAULT_BIOME_BRIEFS.length]!;
      const plan = generateFloorPlan(brief, s % 5, seed);
      const terrain = COMBAT_TERRAINS[s % COMBAT_TERRAINS.length]!;
      for (const planned of plan.rooms) {
        if (rooms >= 1000) break;
        const built = buildRoom(plan, planned.id, brief, seed);
        const ask = { ...terrain, features: [...terrain.features] };
        const tiles = applyBiomeTerrain(built, ask, seed);
        expect(tiles).toEqual(applyBiomeTerrain(built, { ...terrain, features: [...terrain.features] }, seed));
        for (const ch of tiles.join('')) expect(LEGAL.has(ch), `illegal tile '${ch}' in ${seed}/${planned.id}`).toBe(true);
        // A BuiltRoom is not yet a RoomSpec (runtime.ts adds the addressing); the safety check
        // only reads tiles, doors, props, encounters, focus and relays, so shape it by hand.
        const room = {
          ...built, tiles, relics: [], props: built.props, encounters: built.encounters,
          exits: built.doors.map((door) => ({ x: door.x, y: door.y, toRoomIndex: 0, entry: door.entry })),
        } as unknown as RoomSpec;
        expect(validateRoomSafety(room), `${seed}/${planned.id}`).toEqual([]);
        if (tiles.join('').includes('*')) canisterRooms++;
        if (tiles.join('').includes('o')) pitRooms++;
        if (tiles.join('').includes('^')) ventRooms++;
        rooms++;
      }
    }
    // The fuzz is worthless if the feature never actually lands.
    expect(canisterRooms).toBeGreaterThan(50);
    expect(pitRooms).toBeGreaterThan(50);
    expect(ventRooms).toBeGreaterThan(50);
  });

  it('passes validateRoomSafety over compiled legacy rooms across layouts and densities', () => {
    let canisterRooms = 0;
    for (const layout of TERRAIN_LAYOUT_IDS) {
      for (const density of TERRAIN_DENSITIES) {
        for (let seed = 0; seed < 12; seed++) {
          const compiled = compileWorldRecipe({
            ...recipe,
            rooms: recipe.rooms.map((room) => ({
              ...room, hazards: true,
              terrain: { features: ['canisters', 'pits', 'vents', 'breakable_walls'], layout, density },
            })),
          }, { plannedRoomCount: 3, seed });
          for (const room of compiled.rooms) {
            expect(validateRoomSafety(room), `${layout}/${density}/${seed}/${room.index}`).toEqual([]);
            if ('*o^'.split('').every((ch) => room.tiles.join('').includes(ch))) canisterRooms++;
          }
        }
      }
    }
    expect(canisterRooms).toBeGreaterThan(20);
  });

  it('reports the rules a hand-broken room violates instead of throwing', () => {
    const tiles = [
      '##################',
      '#P*..............#',
      '#................#',
      '#......**........#',
      '#................#',
      '#......~.........#',
      '#................#',
      '##############X###',
    ];
    const room = RoomSpecSchema.parse({
      id: 'broken', index: 0, name: 'Broken', description: '', width: 18, height: 8,
      tiles, props: [], encounters: [], relics: [], attributions: [], isFinal: false,
      exits: [{ x: 14, y: 7, toRoomIndex: 1, direction: 'south' }],
    });
    const problems = validateRoomSafety(room as RoomSpec);
    expect(problems.some((p) => p.startsWith('S4'))).toBe(true);
    expect(problems.some((p) => p.includes('orthogonally adjacent'))).toBe(true);
  });
});
