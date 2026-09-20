/**
 * Floor runtime (F1b): derived briefs, lazy deterministic RoomSpecs, door twins, terrain safety.
 * Every fixture is played as a floors world; full worlds are 160 rooms each.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomSpecSchema, WorldFixtureSchema, type RoomSpec, type WorldFixture } from '../../../src/shared/contracts';
import { BiomeBriefListSchema, ROOM_BUDGETS, type RoomAddress, type WorldFloors } from '../../../src/shared/floors';
import { PROP_INFO } from '../../../src/shared/registry';
import {
  applyBiomeTerrain, buildRoom, createFloorRuntime, deriveBiomeBriefs, flood, generateFloorPlan, planWorldRoute,
  resolveBiomeBriefs, DEFAULT_BIOME_BRIEFS, type FloorRuntime,
} from '../../../src/shared/floorgen';

const dir = path.resolve(__dirname, '../../../fixtures/worlds');
const fixtures: WorldFixture[] = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
  .map((file) => WorldFixtureSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))));
const SEEDS = ['1', 'relay', '9000'];
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;

function floorsFor(fixture: WorldFixture, seed: string): WorldFloors {
  const briefs = deriveBiomeBriefs(fixture.recipe, seed);
  return { seed, briefs, route: planWorldRoute(seed, briefs.map((brief) => brief.id)) };
}
function allRefs(runtime: FloorRuntime): RoomAddress[] {
  return runtime.floors.briefs.flatMap((brief) => runtime.plan(brief.id).rooms.map((room) => ({ biomeId: brief.id, roomId: room.id })));
}
/** Reachable from the spawn with props in place, never through an unbroken 'B'; `hazards` = may step on '~'. */
function safeReach(room: RoomSpec, hazards = false): Set<string> {
  const blocked = new Set<string>();
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    if (!info.blocksMovement) continue;
    for (let dy = 0; dy < info.footprint.h; dy++) for (let dx = 0; dx < info.footprint.w; dx++) blocked.add(`${prop.x + dx},${prop.y + dy}`);
  }
  const y = room.tiles.findIndex((row) => row.includes('P'));
  return flood(room.tiles, { x: room.tiles[y]!.indexOf('P'), y }, (ch) => (hazards || ch !== '~') && ch !== 'B', blocked);
}

describe('deriveBiomeBriefs', () => {
  it('yields 8 valid, visibly different briefs for every fixture', () => {
    expect(fixtures).toHaveLength(3);
    for (const fixture of fixtures) {
      const briefs = deriveBiomeBriefs(fixture.recipe, 'seed-a');
      expect(BiomeBriefListSchema.safeParse(briefs).success).toBe(true);
      expect(new Set(briefs.map((brief) => brief.name)).size).toBe(8);
      expect(new Set(briefs.map((brief) => JSON.stringify(brief.layout))).size).toBe(8);
      expect(new Set(briefs.map((brief) => JSON.stringify([brief.motifIds, brief.enemyPool]))).size).toBeGreaterThanOrEqual(7);
      expect(new Set(briefs.map((brief) => brief.motifIds.join())).size).toBeGreaterThanOrEqual(5);
      // The world's own blueprints bookend the run.
      expect(briefs[0]!.name).toBe(fixture.recipe.rooms[0]!.name);
      expect(briefs[7]!.name).toBe(fixture.recipe.rooms.at(-1)!.name);
      expect(briefs.every((brief) => !brief.enemyPool.includes('guardian') && !brief.propPool.includes('anchor_pedestal'))).toBe(true);
    }
  });
  it('is deterministic per seed and varies across seeds', () => {
    const recipe = fixtures[0]!.recipe;
    expect(deriveBiomeBriefs(recipe, 's')).toEqual(deriveBiomeBriefs(recipe, 's'));
    expect(deriveBiomeBriefs(recipe, 's')).not.toEqual(deriveBiomeBriefs(recipe, 't'));
  });
  it('works for a one-room recipe with only a guardian', () => {
    const recipe = { ...fixtures[0]!.recipe, rooms: [{ ...fixtures[0]!.recipe.rooms[2]!, enemyIds: ['guardian' as const], propIds: [] }] };
    expect(BiomeBriefListSchema.safeParse(deriveBiomeBriefs(recipe, 'solo')).success).toBe(true);
  });
  it('resolveBiomeBriefs prefers a valid model-written set and ignores an invalid one', () => {
    const recipe = fixtures[1]!.recipe;
    const own = DEFAULT_BIOME_BRIEFS.map((brief) => ({ ...brief }));
    expect(resolveBiomeBriefs({ ...recipe, biomes: own }, 's')).toEqual(own);
    expect(resolveBiomeBriefs({ ...recipe, biomes: own.slice(0, 5) }, 's')).toEqual(deriveBiomeBriefs(recipe, 's'));
  });
});

describe('floor runtime', () => {
  it('builds every room of every fixture world as a valid RoomSpec with twinned doors and safe terrain', () => {
    const terrainChars = new Set<string>();
    let roomCount = 0;
    fixtures.forEach((fixture, i) => {
      const runtime = createFloorRuntime(floorsFor(fixture, SEEDS[i]!), { recipe: fixture.recipe });
      const finals: string[] = [];
      for (const ref of allRefs(runtime)) {
        const room = runtime.getRoom(ref);
        roomCount++;
        const parsed = RoomSpecSchema.safeParse(JSON.parse(JSON.stringify(room)));
        expect(parsed.success, `${ref.biomeId}/${ref.roomId}`).toBe(true);
        expect(parsed.data).toEqual(room);
        expect(room).toMatchObject({ biomeId: ref.biomeId, roomId: ref.roomId, attributions: [] });
        for (const ch of room.tiles.join('')) if ('B=>:+'.includes(ch)) terrainChars.add(ch);

        // Doors: the neighbour has a twin leading back, facing the other way; arrival = the twin's entry.
        expect(room.exits.map((exit) => exit.toRoomId).sort()).toEqual(runtime.neighbours(ref).map((n) => n.ref.roomId).sort());
        const reach = safeReach(room);
        for (const exit of room.exits) {
          const target = { biomeId: ref.biomeId, roomId: exit.toRoomId! };
          const twin = runtime.getRoom(target).exits.find((candidate) => candidate.toRoomId === ref.roomId);
          expect(twin?.direction).toBe(OPPOSITE[exit.direction]);
          expect(runtime.arrivalTile(ref, target)).toEqual(twin!.entry);
          expect(reach.has(`${exit.entry!.x},${exit.entry!.y}`), `${room.id} door entry cut off`).toBe(true);
        }
        expect(reach.has(`${room.focus!.x},${room.focus!.y}`)).toBe(true);
        const wet = safeReach(room, true); // floorgen guarantees encounters are reachable, possibly across hazards
        for (const encounter of room.encounters) expect(wet.has(`${encounter.x},${encounter.y}`), `${room.id} ${encounter.id}`).toBe(true);

        if (room.kind === 'lore') expect(fixture.recipe.lore[room.relics[0]!.fragmentIndex]!.kind).toBe('relic');
        else expect(room.relics).toEqual([]);
        expect(room.isFinal).toBe(runtime.isFinalRoom(ref));
        if (room.isFinal) finals.push(room.id);
        if (room.isFinal) {
          expect(room.anchorRelays).toHaveLength(3);
          expect(room.encounters.some((encounter) => encounter.enemyId === 'guardian' && encounter.role === 'guardian')).toBe(true);
          expect(room.props.some((prop) => prop.propId === 'anchor_pedestal')).toBe(true);
        }
      }
      expect(finals).toHaveLength(1);
      expect(runtime.floors.route.tiers.map((tier) => runtime.plan(tier[0]!).rooms.length)).toEqual([...ROOM_BUDGETS]);
    });
    expect(roomCount).toBe(3 * 160);
    expect([...terrainChars].sort()).toEqual(['+', ':', '=', '>', 'B'].sort());
  });

  it('two runtimes with the same seed give identical RoomSpecs in any build order', () => {
    for (const fixture of fixtures) {
      const floors = floorsFor(fixture, 'same-seed');
      const a = createFloorRuntime(floors, { recipe: fixture.recipe });
      const b = createFloorRuntime(JSON.parse(JSON.stringify(floors)) as WorldFloors, { recipe: fixture.recipe });
      const refs = allRefs(a).filter((_, i) => i % 4 === 0);
      const forward = refs.map((ref) => JSON.stringify(a.getRoom(ref)));
      const backward = [...refs].reverse().map((ref) => JSON.stringify(b.getRoom(ref))).reverse();
      expect(backward).toEqual(forward);
      expect(a.getRoom(refs[0]!)).toBe(a.getRoom(refs[0]!)); // cached
      const other = createFloorRuntime(floorsFor(fixture, 'other-seed'), { recipe: fixture.recipe });
      expect(JSON.stringify(allRefs(other).slice(0, 10).map((ref) => other.getRoom(ref)))).not.toBe(JSON.stringify(allRefs(a).slice(0, 10).map((ref) => a.getRoom(ref))));
    }
  });

  it('exposes the route: entrance, choices, exits, final room', () => {
    const runtime = createFloorRuntime(floorsFor(fixtures[0]!, 'route'));
    const { tiers } = runtime.floors.route;
    expect(runtime.entranceRef()).toEqual({ biomeId: tiers[0]![0], roomId: 'r00' });
    expect(runtime.getRoom(runtime.entranceRef()).kind).toBe('entrance');
    expect(runtime.nextBiomeChoices(tiers[0]![0]!)).toEqual(tiers[1]);
    expect(runtime.nextBiomeChoices(tiers[3]![1]!)).toEqual(tiers[4]);
    expect(runtime.nextBiomeChoices(tiers[4]![0]!)).toEqual([]);
    expect(tiers.map((tier) => runtime.tier(tier[0]!))).toEqual([0, 1, 2, 3, 4]);
    const midExit = runtime.getRoom(runtime.exitRef(tiers[1]![0]!));
    expect(midExit).toMatchObject({ kind: 'exit', feature: 'biome_exit', isFinal: false });
    expect(midExit.encounters.some((encounter) => encounter.role === 'gatekeeper')).toBe(true);
    expect(runtime.isBiomeExit(runtime.exitRef(tiers[1]![0]!))).toBe(true);
    expect(runtime.isFinalRoom(runtime.exitRef(tiers[1]![0]!))).toBe(false);
    expect(runtime.isFinalRoom(runtime.exitRef(tiers[4]![0]!))).toBe(true);
    expect(() => runtime.getRoom({ biomeId: 'nope', roomId: 'r00' })).toThrow();
    expect(() => runtime.getRoom({ biomeId: tiers[0]![0]!, roomId: 'r10' })).toThrow();
    // Without a recipe there are no relics, and rooms are otherwise unchanged.
    const lore = runtime.plan(tiers[0]![0]!).rooms.find((room) => room.kind === 'lore')!;
    expect(runtime.getRoom({ biomeId: tiers[0]![0]!, roomId: lore.id }).relics).toEqual([]);
  });

  it('mapRooms reveals visited rooms and outlines their neighbours', () => {
    const runtime = createFloorRuntime(floorsFor(fixtures[2]!, 'map'));
    const entrance = runtime.entranceRef();
    const neighbours = runtime.neighbours(entrance);
    const map = runtime.mapRooms(entrance.biomeId, ['r00'], ['r00']);
    expect(map).toHaveLength(1 + neighbours.length);
    expect(map.find((room) => room.roomId === 'r00')).toMatchObject({ state: 'visited', kind: 'entrance', cleared: true });
    for (const n of neighbours) expect(map.find((room) => room.roomId === n.ref.roomId)).toMatchObject({ state: 'seen', kind: null, cleared: false });
    expect(runtime.mapRooms(entrance.biomeId, runtime.plan(entrance.biomeId).rooms.map((room) => room.id))).toHaveLength(10);
  });

  // C4: `recipe.biomeRoomLines` is written by the model and used to be read by nothing.
  it('uses the model\'s room line for a biome and kind, and falls back to the derived one', () => {
    const fixture = fixtures[0]!;
    const floors = floorsFor(fixture, 'lines');
    const biomeId = floors.route.tiers[0]![0]!;
    const derived = createFloorRuntime(floors, { recipe: { lore: fixture.recipe.lore } });
    const plan = derived.plan(biomeId);
    const roomOfKind = (kind: string) => plan.rooms.find((room) => room.kind === kind);
    const entranceId = plan.entranceId;

    const lines = [{ biomeId, lines: [{ kind: 'entrance' as const, text: 'The lift doors are jammed open on the ninth floor.' }] }];
    const authored = createFloorRuntime(floors, { recipe: { lore: fixture.recipe.lore, biomeRoomLines: lines } });
    expect(authored.getRoom({ biomeId, roomId: entranceId }).description).toBe(lines[0]!.lines[0]!.text);
    expect(derived.getRoom({ biomeId, roomId: entranceId }).description).not.toBe(lines[0]!.lines[0]!.text);
    expect(derived.getRoom({ biomeId, roomId: entranceId }).description).toContain('door');

    // A kind with no line, and a biome with no lines at all, keep the derived description.
    const other = plan.rooms.find((room) => room.kind === 'combat')!;
    expect(authored.getRoom({ biomeId, roomId: other.id }).description)
      .toBe(derived.getRoom({ biomeId, roomId: other.id }).description);
    const elsewhere = floors.route.tiers[1]![0]!;
    const elsewhereRoom = authored.plan(elsewhere).entranceId;
    expect(authored.getRoom({ biomeId: elsewhere, roomId: elsewhereRoom }).description)
      .toBe(derived.getRoom({ biomeId: elsewhere, roomId: elsewhereRoom }).description);

    // A4: a rest room keeps the once-per-run sentence whoever wrote the rest of the line.
    const rest = roomOfKind('rest');
    if (rest) {
      const restLines = [{ biomeId, lines: [{ kind: 'rest' as const, text: 'Folding cots and a dead kettle.' }] }];
      const withRest = createFloorRuntime(floors, { recipe: { lore: fixture.recipe.lore, biomeRoomLines: restLines } });
      const description = withRest.getRoom({ biomeId, roomId: rest.id }).description;
      expect(description).toContain('Folding cots and a dead kettle.');
      expect(description).toContain('once, and not again');
      expect(derived.getRoom({ biomeId, roomId: rest.id }).description).toContain('once, and not again');
    }
  });

  it('terrain mutator keeps every door reachable on bare rooms across many seeds', () => {
    const terrains = [
      { features: ['breakable_walls', 'bridges', 'rubble', 'conduits'], layout: 'crossroads', density: 'dense' },
      { features: ['bridges'], layout: 'barricades', density: 'dense' },
      { features: ['bridges', 'rubble'], layout: 'scattered', density: 'balanced' },
    ] as const;
    let bridges = 0;
    for (let s = 0; s < 40; s++) {
      const seed = `terrain-${s}`;
      const brief = DEFAULT_BIOME_BRIEFS[s % DEFAULT_BIOME_BRIEFS.length]!;
      const plan = generateFloorPlan(brief, s % 5, seed);
      for (const planned of plan.rooms.filter((_, i) => i % 3 === 0)) {
        const built = buildRoom(plan, planned.id, brief, seed);
        const tiles = applyBiomeTerrain(built, { ...terrains[s % 3]!, features: [...terrains[s % 3]!.features] }, seed);
        expect(tiles).toEqual(applyBiomeTerrain(built, { ...terrains[s % 3]!, features: [...terrains[s % 3]!.features] }, seed));
        if (tiles.join('').includes('=')) bridges++;
        const before = safeReach({ ...built, tiles: built.tiles } as unknown as RoomSpec);
        const after = safeReach({ ...built, tiles } as unknown as RoomSpec);
        for (const id of before) {
          const [x, y] = id.split(',').map(Number) as [number, number];
          if (!'#B'.includes(tiles[y]![x]!)) expect(after.has(id), `${seed} ${planned.id} lost ${id}`).toBe(true);
        }
        expect(tiles.join('').replace(/[B=>:+]/g, '').length).toBeLessThanOrEqual(tiles.join('').length);
        expect(tiles.map((row) => row.length)).toEqual(built.tiles.map((row) => row.length));
      }
    }
    expect(bridges).toBeGreaterThan(20);
  });
});
