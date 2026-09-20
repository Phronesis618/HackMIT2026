import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { tileToWorld } from '../../src/shared/conventions';
import { createSimulation, type Simulation } from '../../src/sim';
import { fightCustodian } from './finaleBot';

const { laws: _laws, look: _look, custodian: _custodian, ...recipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = WorldFixtureSchema.parse(fixtureJson);
const crew = ['op-a', 'op-b', 'op-c'];

function arena(index: number): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  if (index === 0) tiles[7]![6] = '~';
  if (index < 2) tiles[7]![24] = 'X';
  if (index > 0) tiles[7]![1] = 'X';
  if (index === 2) tiles[7]![13] = 'A';
  return RoomSpecSchema.parse({
    id: `bughunt-extraction-${index}`, index, name: `Arena ${index}`, description: '',
    width: 26, height: 16, tiles: tiles.map((row) => row.join('')), props: [], attributions: [],
    encounters: index === 2 ? [{ id: 'custodian', enemyId: 'guardian', x: 10, y: 7, count: 1 }] : [],
    exits: [
      ...(index > 0 ? [{ x: 1, y: 7, toRoomIndex: index - 1, direction: 'west' }] : []),
      ...(index < 2 ? [{ x: 24, y: 7, toRoomIndex: index + 1, direction: 'east' }] : []),
    ],
    isFinal: index === 2,
    ...(index === 2 ? { anchorRelays: [{ x: 5, y: 3 }, { x: 16, y: 3 }, { x: 17, y: 11 }] } : {}),
  });
}

function tick(sim: Simulation, partial: Partial<PlayerIntent> = {}): GameEvent[] {
  for (const playerId of crew) {
    const player = sim.getSnapshot().players.find((p) => p.id === playerId)!;
    sim.applyIntent({
      playerId, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
      attack: false, dash: false, ability: null, interact: false, ...partial,
    });
  }
  const events = sim.step();
  const exit = events.find((event) => event.type === 'exit_reached');
  if (exit?.type === 'exit_reached') events.push(...sim.enterRoom(exit.toRoomIndex));
  return events;
}

function walk(sim: Simulation, target: { x: number; y: number }, reach = 6): GameEvent[] {
  const events: GameEvent[] = [];
  const roomIndex = sim.getSnapshot().roomIndex;
  for (let i = 0; i < 1200; i++) {
    const player = sim.getSnapshot().players[0]!;
    const d = Math.hypot(target.x - player.x, target.y - player.y);
    if (d <= reach || sim.getSnapshot().roomIndex !== roomIndex) return events;
    events.push(...tick(sim, { moveX: (target.x - player.x) / d, moveY: (target.y - player.y) / d }));
  }
  throw new Error('Could not reach objective');
}

describe('extraction is safe after the collapse', () => {
  it('stops room hazards while the crew chooses what to carry home', () => {
    const sim = createSimulation();
    for (const id of crew) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
    sim.setWorld(PreparedWorldSchema.parse({
      worldId: 'escape-test', createdAt: 0, recipe, art: fixture.art,
      rooms: [arena(0), arena(1), arena(2)], plannedRoomCount: 3,
      provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
      receipt: { worldTitle: recipe.title, source: 'fixture', headline: 'Extraction safety regression', lines: [] },
    }));
    sim.enterRoom(2);
    const fight = fightCustodian(sim, crew);
    expect(fight.killed).toBe(true);
    const events = [...fight.events];
    for (let relay = 0; relay < 3; relay++) {
      events.push(...walk(sim, sim.getSnapshot().anchor!.ritual!.relays[relay]!));
      events.push(...tick(sim, { interact: true }), ...tick(sim));
    }
    events.push(...walk(sim, sim.getSnapshot().anchor!, 30));
    events.push(...tick(sim, { interact: true }));
    for (let i = 0; i < 200 && sim.getSnapshot().anchor!.ritual!.stage === 'discharging'; i++) events.push(...tick(sim));
    expect(events.filter((event) => event.type === 'anchor_planted')).toHaveLength(1);
    expect(sim.getSnapshot().collapse!.stage).toBe('collapse');
    events.push(...walk(sim, tileToWorld(1, 7), 10));
    events.push(...walk(sim, tileToWorld(1, 7), 10));
    events.push(...tick(sim));
    expect(sim.getSnapshot().collapse!.stage).toBe('extraction');
    expect(sim.getSnapshot().collapse!.offer.length).toBeGreaterThan(0);
    const before = sim.getSnapshot().players.map((p) => p.hp);
    const extraction: GameEvent[] = [];
    for (let i = 0; i < 300; i++) extraction.push(...tick(sim));
    expect(extraction.filter((event) => event.type === 'player_damaged')).toEqual([]);
    expect(sim.getSnapshot().players.map((p) => p.hp)).toEqual(before);
    for (let i = 0; i < 1000 && sim.getPhase() === 'expedition'; i++) extraction.push(...tick(sim));
    expect(extraction).toContainEqual(expect.objectContaining({ type: 'run_ended', outcome: 'anchored' }));
    expect(extraction.filter((event) => event.type === 'relic_carried')).toHaveLength(1);
  });
});
