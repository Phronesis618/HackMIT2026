/**
 * A8 — the collapse escape over real terrain.
 *
 * The walk back to the portal (src/sim/escape.ts) was only ever exercised in empty arenas. The
 * rooms the crew retreats through now hold pits, vents, hazard floor, canisters and low cover,
 * and the collapse opens every door but does not clear a lane. Two things have to hold:
 *
 *  - the route stays passable WITHOUT dashing (a dash crosses pits; walking must not have to),
 *  - the room itself must not kill the crew on the way out.
 *
 * Both are checked on a legacy three-room world with the terrain painted by hand, and on a
 * floors world whose biome briefs ask for all five combat tiles at once.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { tileToWorld } from '../../src/shared/conventions';
import { FLOOR_ENTRANCE_ROOM_ID } from '../../src/shared/floors';
import { DANGEROUS_TILES } from '../../src/shared/registry';
import { isTerrainDamageSource } from '../../src/shared/terrain';
import { buildSolidGrid, circleHitsSolid } from '../../src/sim/collision';
import { chaseWaypoint } from '../../src/sim/combat';
import { createSimulation, type Simulation } from '../../src/sim';
import { fightCustodian } from './finaleBot';
import { FloorsBot, floorsWorld, makeProvider, steerIntent } from './floorsBot';

// These tests exercise the sim's own derivation, so the fixture's authored laws / look /
// custodian are stripped, exactly as tests/sim/finale-escape.test.ts does.
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };
const relays = [{ x: 5, y: 3 }, { x: 16, y: 3 }, { x: 17, y: 11 }];
const CREW = ['op-a', 'op-b', 'op-c'];

/** The five combat tiles of docs/design/TILES.md, in one room. */
const TERRAIN_CHARS = ['o', '^', '~', '*', '-'] as const;

/**
 * A retreat room: the corridor the crew came down, now with the way blocked. The pit column
 * closes the straight line along row 7, so the walk back has to find its way around it on foot.
 */
function paintTerrain(tiles: string[][]): void {
  for (const y of [5, 6, 7]) tiles[y]![10] = 'o';   // pit: solid to boots, open to a dash
  for (const y of [6, 7, 8]) tiles[y]![14] = '-';   // low cover
  for (const y of [7, 8]) tiles[y]![18] = '~';      // hazard floor
  tiles[6]![20] = '^';                              // vent
  tiles[9]![8] = '*';                               // canister
}

function arena(index: number): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  if (index < 2) tiles[7]![24] = 'X';
  if (index > 0) tiles[7]![1] = 'X';
  if (index === 2) tiles[7]![13] = 'A';
  if (index < 2) paintTerrain(tiles); // only the rooms the crew retreats through
  const exits = [
    ...(index > 0 ? [{ x: 1, y: 7, toRoomIndex: index - 1, direction: 'west' as const }] : []),
    ...(index < 2 ? [{ x: 24, y: 7, toRoomIndex: index + 1, direction: 'east' as const }] : []),
  ];
  return RoomSpecSchema.parse({
    id: `escape-terrain-${index}`, index, name: `Arena ${index}`, description: '', width: 26, height: 16,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [],
    encounters: index === 2 ? [{ id: 'custodian', enemyId: 'guardian', x: 10, y: 7, count: 1 }] : [],
    exits,
    isFinal: index === 2, ...(index === 2 ? { anchorRelays: relays } : {}),
  });
}

function setup(): Simulation {
  const sim = createSimulation();
  for (const id of CREW) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'escape-terrain', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [arena(0), arena(1), arena(2)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Escape over terrain', lines: [] },
  }));
  sim.enterRoom(2);
  return sim;
}

function tick(sim: Simulation, partial: Partial<PlayerIntent> | ((id: string) => Partial<PlayerIntent>) = {}): GameEvent[] {
  for (const id of CREW) {
    const player = sim.getSnapshot().players.find((candidate) => candidate.id === id)!;
    sim.applyIntent({
      playerId: id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
      attack: false, dash: false, ability: null, interact: false,
      ...(typeof partial === 'function' ? partial(id) : partial),
    });
  }
  const events = sim.step();
  const exit = events.find((event) => event.type === 'exit_reached');
  if (exit?.type === 'exit_reached') events.push(...sim.enterRoom(exit.toRoomIndex));
  return events;
}

/** Walk the crew to a point, routing around whatever is in the way. Never dashes. */
function walk(sim: Simulation, target: { x: number; y: number }, reach = 6): GameEvent[] {
  const events: GameEvent[] = [];
  const startRoom = sim.getSnapshot().roomIndex;
  for (let i = 0; i < 2000; i++) {
    const snapshot = sim.getSnapshot();
    const lead = snapshot.players.find((candidate) => candidate.hp > 0);
    if (!lead) throw new Error('the crew is down');
    if (Math.hypot(target.x - lead.x, target.y - lead.y) <= reach
      || snapshot.roomIndex !== startRoom || sim.getPhase() !== 'expedition') return events;
    const room = sim.getWorld()!.rooms[snapshot.roomIndex!]!;
    events.push(...tick(sim, (id) => {
      const me = snapshot.players.find((candidate) => candidate.id === id)!;
      return steerIntent(room, snapshot, me, id === lead.id ? target : lead, false);
    }));
  }
  throw new Error('could not reach the objective on foot');
}

/** Beat the Custodian and run the relay ritual, leaving the crew at the moment of discharge. */
function anchorTheWorld(sim: Simulation): GameEvent[] {
  const events: GameEvent[] = [];
  const fight = fightCustodian(sim, CREW);
  events.push(...fight.events);
  if (!fight.killed) throw new Error('the Custodian survived');
  for (let index = 0; index < 3; index++) {
    const ritual = sim.getSnapshot().anchor!.ritual!;
    if (ritual.activeRelay !== index) continue;
    events.push(...walk(sim, ritual.relays[index]!));
    events.push(...tick(sim, { interact: true }));
    events.push(...tick(sim));
  }
  events.push(...walk(sim, sim.getSnapshot().anchor!, 30));
  events.push(...tick(sim, { interact: true }));
  for (let i = 0; i < 200 && sim.getSnapshot().anchor?.ritual?.stage === 'discharging'; i++) events.push(...tick(sim));
  return events;
}

/** Nothing the room did may take an operative's last point of health, and nobody may dash. */
function assertWalkedOutAlive(events: GameEvent[]): void {
  const killedByTheRoom = events.filter((event) =>
    event.type === 'player_damaged' && isTerrainDamageSource(event.sourceEnemyId ?? '') && event.remainingHp === 0);
  expect(killedByTheRoom).toEqual([]);
  expect(events.filter((event) => event.type === 'player_dashed')).toEqual([]);
}

describe('what the walk back turned up', () => {
  it('routes a wide body down a two-tile corridor instead of standing still in it', () => {
    // Two open rows between two walls: every tile centre is 16 px from a wall, so a radius-18
    // body has no legal centre anywhere in the corridor even though it fits (64 px of clearance).
    const tiles = [
      '############',
      '############',
      '#P........X#',
      '#..........#',
      '############',
      '############',
    ];
    const room = RoomSpecSchema.parse({
      id: 'corridor', index: 0, name: 'Corridor', description: '', width: 12, height: 6,
      tiles, props: [], attributions: [], relics: [], encounters: [],
      exits: [{ x: 10, y: 2, toRoomIndex: 1, direction: 'east' as const }], isFinal: false,
    });
    const grid = buildSolidGrid(room);
    const from = tileToWorld(1, 2);
    const to = tileToWorld(10, 3);
    expect(circleHitsSolid(grid, from.x, from.y, 18)).toBe(true); // no legal centre, as promised
    const waypoint = chaseWaypoint(grid, from, to, 18);
    expect(waypoint).not.toEqual(from); // it used to give up here and never move again
    expect(waypoint.x).toBeGreaterThan(from.x);
    // A body that does fit the tile centres routes the same way.
    expect(chaseWaypoint(grid, from, to, 12).x).toBeGreaterThan(from.x);
  });
});

describe('the collapse escape, over terrain', () => {
  it('walks a legacy three-room world back to the portal past pits, vents, fire, canisters and cover', () => {
    const sim = setup();
    anchorTheWorld(sim);
    expect(sim.getSnapshot().collapse).toMatchObject({ stage: 'collapse', portalRoomId: 'escape-terrain-0' });

    // The rooms on the way back really do hold all five combat tiles.
    for (const index of [0, 1]) {
      const tiles = sim.getWorld()!.rooms[index]!.tiles.join('');
      for (const char of TERRAIN_CHARS) expect(tiles, `room ${index} has no '${char}'`).toContain(char);
    }

    const escape: GameEvent[] = [];
    const backDoor = tileToWorld(1, 7);
    escape.push(...walk(sim, backDoor, 10));
    expect(sim.getSnapshot().roomIndex).toBe(1);
    escape.push(...walk(sim, backDoor, 10));
    expect(sim.getSnapshot().roomIndex).toBe(0);
    escape.push(...tick(sim));
    expect(sim.getSnapshot().collapse!.stage).toBe('extraction');
    expect(sim.getSnapshot().players.every((player) => player.hp > 0)).toBe(true);
    assertWalkedOutAlive(escape);
    // The terrain costs time, not the run: a crew on foot still arrives with most of the clock.
    expect(sim.getSnapshot().collapse!.remainingMs / sim.getSnapshot().collapse!.totalMs).toBeGreaterThan(0.3);
  }, 120_000);

  it('walks a floors world back to the biome entrance with every combat tile turned on', () => {
    const world = floorsWorld('a8-escape', (briefs) => {
      for (const brief of briefs) {
        brief.hazards = true;
        // All five combat tiles, at the middle of the intensity band rather than the top of it:
        // A27 made wide enemies real (a Warden or Guardian used to be droppable into geometry it
        // could never leave, where it stood still and hurt nobody), and five biomes of maximum
        // terrain on top of that is not a walk out, it is a wipe. Every tile below still appears.
        brief.terrain = { features: ['pits', 'vents', 'canisters', 'cover'], layout: 'gauntlet', density: 'dense', intensity: 0.4 };
      }
    });
    const sim = createSimulation();
    for (const id of CREW) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
    for (const id of CREW) sim.unlockAbility(id);
    sim.setHostPlayerId(CREW[0]!);
    sim.setWorld(world);
    const bot = new FloorsBot(sim, makeProvider(world), CREW);
    bot.events.push(...sim.enterRoom(0));

    for (let tier = 0; tier < 5; tier++) {
      expect(bot.floor().tier).toBe(tier);
      bot.travel(bot.plan().exitId);
      if (tier === 4) break;
      bot.useFocus();
      const options = bot.floor().biomeChoice!.options;
      const depth = (biomeId: string) => {
        const plan = bot.provider.plan(biomeId);
        return plan.rooms.find((room) => room.id === plan.exitId)!.depth;
      };
      sim.chooseBiome(CREW[0]!, [...options].sort((a, b) => depth(a) - depth(b))[0]!);
      bot.tick();
    }

    // Anchor the world, which starts the collapse.
    for (let relay = 0; relay < 3; relay++) {
      const ritual = bot.snapshot().anchor!.ritual!;
      expect(ritual.activeRelay).toBe(relay);
      bot.walkTo(ritual.relays[relay]!, { reach: 10 });
      bot.tick(() => ({ interact: true }));
      bot.tick();
    }
    bot.walkTo(bot.snapshot().anchor!, { reach: 30 });
    bot.tick(() => ({ interact: true }));
    for (let i = 0; i < 200 && bot.snapshot().anchor!.ritual!.stage === 'discharging'; i++) bot.tick();
    expect(bot.snapshot().collapse).toMatchObject({ stage: 'collapse' });

    // Every room of the last biome is walked back through; they are full of terrain.
    const biomeId = bot.floor().biomeId;
    const tiles = bot.provider.plan(biomeId).rooms
      .map((room) => bot.provider.getRoom({ biomeId, roomId: room.id }).tiles.join('')).join('');
    for (const char of TERRAIN_CHARS) expect(tiles, `the finale biome has no '${char}'`).toContain(char);
    expect([...tiles].some((char) => DANGEROUS_TILES.has(char))).toBe(true);

    const before = bot.events.length;
    bot.travel(FLOOR_ENTRANCE_ROOM_ID);
    bot.tick(); // the timer stops on the first tick inside the entrance room
    expect(bot.snapshot().collapse!.stage).toBe('extraction');
    expect(bot.snapshot().players.every((player) => player.hp > 0)).toBe(true);
    assertWalkedOutAlive(bot.events.slice(before));
  }, 240_000);
});
