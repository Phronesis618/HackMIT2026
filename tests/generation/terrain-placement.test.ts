/**
 * The generator's half of docs/design/TILES.md: every room it produces must pass
 * `validateRoomSafety` (§5 S1/S2/S4/S8) with the combat-facing tiles switched on, and two runs
 * of the same seed must be byte-identical (co-op determinism).
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomSpecSchema, type RoomSpec } from '../../src/shared/contracts';
import { ENEMY_INFO, PROP_INFO, TERRAIN_DENSITIES, TERRAIN_LAYOUT_IDS, TILE_CHARS } from '../../src/shared/registry';
import { validateRoomSafety } from '../../src/shared/terrain';
import {
  applyBiomeTerrain, bodyFits, bodyFootprint, buildRoom, deriveBiomeBriefs, generateFloorPlan, DEFAULT_BIOME_BRIEFS,
} from '../../src/shared/floorgen';
import type { BiomeTerrain } from '../../src/shared/floors';
import { compileWorldRecipe } from '../../src/server/generation/compiler';
import { loadWorldFixtures } from '../../src/server/generation/fixtureService';

const fixtures = loadWorldFixtures(path.resolve(__dirname, '../../fixtures/worlds'));
const recipe = fixtures.find((fixture) => fixture.fixtureId === 'vantage-spire')!.recipe;
const LEGAL = new Set<string>(TILE_CHARS);

/** The combat-facing feature sets a room may ask for, four at a time (the schema's cap). */
const COMBAT_TERRAINS: BiomeTerrain[] = [
  { features: ['canisters', 'pits', 'vents', 'cover'], layout: 'scattered', density: 'dense' },
  { features: ['canisters', 'pits', 'bridges', 'breakable_walls'], layout: 'crossroads', density: 'balanced' },
  { features: ['vents', 'cover', 'pits', 'hazard_floor'], layout: 'barricades', density: 'sparse' },
];

describe('terrain placement keeps every generated room safe', () => {
  it('passes validateRoomSafety over a thousand floors rooms, and repeats byte for byte', () => {
    let rooms = 0;
    let canisterRooms = 0;
    let pitRooms = 0;
    let ventRooms = 0;
    let coverRooms = 0;
    let wideBodies = 0;
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
        // A27: terrain is stamped AFTER the encounters are placed, so a pit or a canister could
        // land inside a Warden's or a Guardian's body and leave it standing in geometry. Every
        // wide body still fits where it stands once the room is finished.
        const blocked = new Set<string>();
        for (const prop of built.props) {
          const info = PROP_INFO[prop.propId];
          if (!info.blocksMovement) continue;
          for (let dy = 0; dy < info.footprint.h; dy++) for (let dx = 0; dx < info.footprint.w; dx++) blocked.add(`${prop.x + dx},${prop.y + dy}`);
        }
        for (const encounter of built.encounters) {
          const footprint = bodyFootprint(ENEMY_INFO[encounter.enemyId].radius);
          if (footprint.length === 0) continue;
          wideBodies++;
          expect(
            bodyFits(tiles, encounter.x, encounter.y, footprint, blocked),
            `${seed}/${planned.id}: ${encounter.enemyId} at ${encounter.x},${encounter.y} is crushed by terrain\n${tiles.join('\n')}`,
          ).toBe(true);
        }
        if (tiles.join('').includes('*')) canisterRooms++;
        if (tiles.join('').includes('o')) pitRooms++;
        if (tiles.join('').includes('^')) ventRooms++;
        if (tiles.join('').includes('-')) coverRooms++;
        rooms++;
      }
    }
    // The fuzz is worthless if the feature never actually lands.
    expect(wideBodies).toBeGreaterThan(50);
    expect(canisterRooms).toBeGreaterThan(50);
    expect(pitRooms).toBeGreaterThan(50);
    expect(ventRooms).toBeGreaterThan(50);
    expect(coverRooms).toBeGreaterThan(50);
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
              terrain: { features: ['canisters', 'pits', 'vents', 'cover'], layout, density },
            })),
          }, { plannedRoomCount: 3, seed });
          for (const room of compiled.rooms) {
            expect(validateRoomSafety(room), `${layout}/${density}/${seed}/${room.index}`).toEqual([]);
            if ('*o^-'.split('').every((ch) => room.tiles.join('').includes(ch))) canisterRooms++;
          }
        }
      }
    }
    expect(canisterRooms).toBeGreaterThan(20);
  });

  it('honours layout and hazardBias as placement hints, never as safety overrides', () => {
    const brief = DEFAULT_BIOME_BRIEFS[2]!;
    const plan = generateFloorPlan(brief, 1, 'bias');
    const base = { features: ['vents', 'cover', 'pits'], density: 'dense' } as const;
    const place = (built: ReturnType<typeof buildRoom>, extra: Partial<BiomeTerrain>) =>
      applyBiomeTerrain(built, { ...base, layout: 'scattered', features: [...base.features], ...extra } as BiomeTerrain, 'bias');
    const safety = (built: ReturnType<typeof buildRoom>, tiles: string[]) => validateRoomSafety({
      ...built, tiles, relics: [],
      exits: built.doors.map((door) => ({ x: door.x, y: door.y, toRoomIndex: 0, entry: door.entry })),
    } as unknown as RoomSpec);
    // Damaging terrain lands in a minority of rooms, so find one that rolled loud under both
    // biases before comparing where it put its vents.
    let compared = false;
    for (const planned of plan.rooms) {
      const built = buildRoom(plan, planned.id, brief, 'bias');
      const edges = place(built, { hazardBias: 'edges' });
      const centre = place(built, { hazardBias: 'centre' });
      for (const tiles of [edges, centre, place(built, { layout: 'arena' }), place(built, { layout: 'gauntlet' })]) {
        expect(safety(built, tiles), `${planned.id}`).toEqual([]);
      }
      if (!edges.join('').includes('^') || !centre.join('').includes('^')) continue;
      const spread = (tiles: string[]) => {
        const at = tiles.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === '^' ? [{ x, y }] : [])));
        const cy = (built.height - 1) / 2;
        return at.reduce((sum, cell) => sum + Math.abs(cell.y - cy), 0) / at.length;
      };
      expect(edges).not.toEqual(centre);
      expect(spread(edges)).toBeGreaterThanOrEqual(spread(centre));
      compared = true;
      break;
    }
    expect(compared).toBe(true);
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
