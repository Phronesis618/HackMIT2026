/**
 * T4 — '-' low cover. Walkable, so it never blocks a route; opaque to shots, so it is the
 * second answer to our four ranged archetypes (the first being "run at them").
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { PLAYER_MAX_HP, TILE_SIZE, tileToWorld, worldToTile } from '../../src/shared/conventions';
import { COVER_HP, terrainTileAt, terrainTuning } from '../../src/shared/terrain';
import { buildSolidGrid, isSolidAt } from '../../src/sim/collision';
import { clearPath } from '../../src/sim/combat';
import { createTerrainState, damageCover } from '../../src/sim/terrain';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);

function arena(paint: (tiles: string[][]) => void, index = 0, isFinal = false, encounters: unknown[] = []): RoomSpec {
  const tiles: string[][] = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 22 }, (_, x) => (x === 0 || x === 21 || y === 0 || y === 10 ? '#' : '.')));
  tiles[5]![2] = 'P';
  if (isFinal) tiles[8]![19] = 'A';
  else tiles[1]![20] = 'X';
  paint(tiles);
  return RoomSpecSchema.parse({
    id: `cover-arena-${index}`, index, name: 'Cover arena', description: '', width: 22, height: 11,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [], relics: [], encounters,
    exits: isFinal ? [] : [{ x: 20, y: 1, toRoomIndex: 1, direction: 'east' }],
    isFinal,
  });
}

function expedition(room: RoomSpec): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'cover-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [room, arena(() => {}, 1), arena(() => {}, 2, true)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Cover', lines: [] },
  }));
  sim.enterRoom(0);
  return sim;
}

function tick(sim: Simulation, input: Partial<PlayerIntent> = {}): GameEvent[] {
  const player = sim.getSnapshot().players[0]!;
  sim.applyIntent({
    playerId: player.id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
    attack: false, dash: false, ability: null, ...input,
  });
  return sim.step();
}

/** A barricade across the walking line at col 6. */
const wall = (tiles: string[][]) => { for (const y of [4, 5, 6]) tiles[y]![6] = '-'; };

describe('cover', () => {
  it('blocks shots and sight but never footsteps', () => {
    const room = arena(wall);
    const grid = buildSolidGrid(room);
    expect(isSolidAt(grid, 6, 5)).toBe(false);
    expect(isSolidAt(grid, 6, 5, 'dash')).toBe(false);
    expect(isSolidAt(grid, 6, 5, 'shots')).toBe(true);
    expect(clearPath(grid, tileToWorld(4, 5), tileToWorld(9, 5))).toBe(false);
    // Walking is the movement layer, and there cover does not exist.
    expect(clearPath(grid, tileToWorld(4, 5), tileToWorld(9, 5), 1, 'solid')).toBe(true);

    const sim = expedition(room);
    for (let i = 0; i < 90; i++) tick(sim, { moveX: 1 });
    const player = sim.getSnapshot().players[0]!;
    expect(player.x).toBeGreaterThan(8 * TILE_SIZE);
    expect(player.hp).toBe(PLAYER_MAX_HP);
  });

  it('denies a sentinel its opening shot and makes it come to the crew', () => {
    /** When the sentinel first commits to a shot, and how far away it was when it did. */
    const shootsAt = (sim: Simulation) => {
      for (let i = 0; i < 600; i++) {
        if (!tick(sim).some((event) => event.type === 'enemy_telegraphed')) continue;
        const snapshot = sim.getSnapshot();
        return { tick: i, range: Math.hypot(snapshot.enemies[0]!.x - snapshot.players[0]!.x, snapshot.enemies[0]!.y - snapshot.players[0]!.y) };
      }
      return { tick: Infinity, range: Infinity };
    };
    const gunner = [{ id: 'gunner', enemyId: 'sentinel', x: 9, y: 5, count: 1 }];
    // A sentinel's range is 280 px and it starts seven tiles away, so with a clean line it opens
    // fire from where it stands. The barricade takes that shot away: it has to give up the range
    // advantage its whole archetype is built on and walk into the crew's half of the room.
    const open = shootsAt(expedition(arena(() => {}, 0, false, gunner)));
    const covered = shootsAt(expedition(arena(wall, 0, false, gunner)));
    expect(open.tick).toBeLessThan(40); // its opening cooldown, then the windup
    expect(open.range).toBeGreaterThan(190); // it stops at 0.7 of its 280 range and fires
    expect(covered.tick).toBeGreaterThan(open.tick * 2);
    expect(covered.range).toBeLessThan(open.range - TILE_SIZE * 2);
  });

  it('still lets a player melee the thing standing on the other side of it', () => {
    // Enemy one tile past the barricade: within TILE_SIZE, so the shot check falls back to the
    // movement layer, where cover is open. Reach over the barricade, not through a wall.
    const sim = expedition(arena(wall, 0, false, [{ id: 'leaner', enemyId: 'husk', x: 7, y: 5, count: 1 }]));
    let damaged: GameEvent | undefined;
    for (let i = 0; i < 200 && !damaged; i++) {
      damaged = tick(sim, { moveX: 1, attack: true, aimX: 999, aimY: 5 * TILE_SIZE + 16 })
        .find((e) => e.type === 'enemy_damaged');
    }
    expect(damaged).toMatchObject({ enemyId: 'leaner-0' });

    // The same geometry with a real wall: nothing lands.
    const walled = expedition(arena((tiles) => { for (const y of [4, 5, 6]) tiles[y]![6] = '#'; },
      0, false, [{ id: 'leaner', enemyId: 'husk', x: 7, y: 5, count: 1 }]));
    let hit: GameEvent | undefined;
    for (let i = 0; i < 120 && !hit; i++) {
      hit = tick(walled, { moveX: 1, attack: true, aimX: 999, aimY: 5 * TILE_SIZE + 16 })
        .find((e) => e.type === 'enemy_damaged');
    }
    expect(hit).toBeUndefined();
  });

  it('shatters into rubble after COVER_HP of damage, and the grid opens', () => {
    const room = arena(wall);
    let state = createTerrainState();
    const shots = Math.ceil(COVER_HP / 7); // a sentinel bolt is 7
    for (let i = 0; i < shots; i++) state = damageCover(room, state, 6, 5, 7, COVER_HP).state;
    expect(state.brokenWalls).toEqual(['6,5']);
    expect(terrainTileAt(room, 6, 5, state.brokenWalls)).toBe(':');
    expect(isSolidAt(buildSolidGrid(room, state.brokenWalls), 6, 5, 'shots')).toBe(false);
    // One short of the pool leaves it standing.
    let almost = createTerrainState();
    for (let i = 0; i < shots - 1; i++) almost = damageCover(room, almost, 6, 5, 7, COVER_HP).state;
    expect(almost.brokenWalls).toEqual([]);
  });

  it('scales its pool with the room intensity, and nothing else does', () => {
    expect(terrainTuning(0).coverHp).toBe(34);
    expect(terrainTuning(0.5).coverHp).toBe(COVER_HP);
    expect(terrainTuning(1).coverHp).toBe(18);
  });

  it('is chipped by real enemy fire in the simulation and reported in the snapshot', () => {
    // The sentinel starts with a clean line; the player walks behind the barricade, so its
    // volley lands on the cover instead.
    const sim = expedition(arena(
      (tiles) => { for (const y of [4, 5, 6]) tiles[y]![8] = '-'; },
      0, false, [{ id: 'gunner', enemyId: 'sentinel', x: 14, y: 5, count: 1 }],
    ));
    for (let i = 0; i < 400; i++) tick(sim, { moveX: i < 120 ? 1 : 0 });
    const damage = sim.getSnapshot().terrain?.coverDamage ?? {};
    expect(Object.keys(damage).length).toBeGreaterThan(0);
    expect(Object.values(damage).every((value) => value > 0 && value <= COVER_HP)).toBe(true);
  });

  /**
   * A19 — cover stops what travels, not what an operative does with their hands. Reviving,
   * reading a relic, planting the Anchor and hitting a relay all go through `canReach` in
   * src/sim/simulation.ts, which reads the movement layer. The two cases driven here are the
   * two that need no boss fight first; the Anchor and its relays share the same predicate.
   */
  describe('reach past a barricade', () => {
    /** Walk right along row 5 until the operative's centre is in `col`, then stand still. */
    const walkToColumn = (sim: Simulation, col: number): void => {
      for (let i = 0; i < 400; i++) {
        if (worldToTile(sim.getSnapshot().players[0]!.x, 0).col === col) return;
        tick(sim, { moveX: 1 });
      }
      throw new Error(`never reached column ${col}`);
    };

    it('lets an operative at the barricade read the relic on the other side of it', () => {
      const room = { ...arena((tiles) => { tiles[5]![5] = '-'; }), relics: [{ id: 'relic-0', x: 6, y: 5, fragmentIndex: 0 }] };
      const sim = expedition(RoomSpecSchema.parse(room));
      walkToColumn(sim, 5);
      const me = sim.getSnapshot().players[0]!;
      const grid = buildSolidGrid(room as RoomSpec);
      // Standing in the cover tile: no line of FIRE to the relic, and a clear line of reach.
      expect(clearPath(grid, me, tileToWorld(6, 5))).toBe(false);
      expect(clearPath(grid, me, tileToWorld(6, 5), 1, 'solid')).toBe(true);
      let read: GameEvent | undefined;
      for (let i = 0; i < 300 && !read; i++) read = tick(sim, { interact: true }).find((e) => e.type === 'lore_discovered');
      expect(read).toMatchObject({ fragmentIndex: 0 });
    });

    it('lets a medic standing in cover pull up the operative burning beside it', () => {
      // Spawn fan-out (src/sim/simulation.ts placePlayers): the first operative lands on 'P',
      // the second 0.9 tiles east, the third 0.9 tiles south. So the middle one burns on the
      // hazard tile, and the medic stands in the cover tile diagonally across from it.
      const room = arena((tiles) => {
        tiles[5]![2] = '.';
        tiles[5]![5] = 'P';
        tiles[5]![6] = '~';
        tiles[6]![5] = '-';
      });
      const sim = createSimulation();
      for (const id of ['a-safe', 'b-victim', 'c-medic']) sim.addPlayer({ id, displayName: id, classId: 'bastion' });
      sim.setWorld(PreparedWorldSchema.parse({
        worldId: 'cover-reach', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
        rooms: [room, arena(() => {}, 1), arena(() => {}, 2, true)], plannedRoomCount: 3,
        provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
        receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Cover', lines: [] },
      }));
      sim.enterRoom(0);
      const seat = (id: string) => sim.getSnapshot().players.find((p) => p.id === id)!;
      const grid = buildSolidGrid(room);
      expect(worldToTile(seat('b-victim').x, seat('b-victim').y)).toEqual({ col: 6, row: 5 });
      expect(worldToTile(seat('c-medic').x, seat('c-medic').y)).toEqual({ col: 5, row: 6 });
      expect(clearPath(grid, seat('c-medic'), seat('b-victim'))).toBe(false); // cover, on the shots layer
      expect(clearPath(grid, seat('c-medic'), seat('b-victim'), 1, 'solid')).toBe(true);

      let downed = false;
      let revived: GameEvent | undefined;
      for (let i = 0; i < 3000 && !revived; i++) {
        // Only the medic ever presses F; the untouched first operative must not do the rescue.
        sim.applyIntent({ playerId: 'c-medic', seq: i, moveX: 0, moveY: 0, aimX: seat('c-medic').x + 1, aimY: seat('c-medic').y, attack: false, dash: false, ability: null, interact: true });
        const events = sim.step();
        downed ||= events.some((e) => e.type === 'player_downed' && e.playerId === 'b-victim');
        revived = events.find((e) => e.type === 'player_revived');
      }
      expect(downed).toBe(true);
      expect(revived).toMatchObject({ playerId: 'b-victim', byPlayerId: 'c-medic' });
    });
  });

  it('is deterministic across two simulations fed the same intents', () => {
    const paint = (tiles: string[][]) => { for (const y of [4, 5, 6]) tiles[y]![8] = '-'; };
    const spec = [{ id: 'gunner', enemyId: 'sentinel', x: 14, y: 5, count: 1 }];
    const a = expedition(arena(paint, 0, false, spec));
    const b = expedition(arena(paint, 0, false, spec));
    for (let i = 0; i < 400; i++) {
      const input = { moveX: i < 120 ? 1 : i % 13 === 0 ? -1 : 0, attack: i % 17 === 0 };
      expect(tick(a, input)).toEqual(tick(b, input));
      expect(a.getSnapshot()).toEqual(b.getSnapshot());
    }
  });
});
