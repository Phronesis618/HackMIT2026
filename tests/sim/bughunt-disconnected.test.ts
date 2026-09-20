import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent,
} from '../../src/shared/contracts';
import { type ClassId } from '../../src/shared/registry';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);

function setup(classId: ClassId = 'bastion', hazard = false, sentinel = false, exitX = 18): Simulation {
  const tiles: string[][] = Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 20 }, (_, x) => x === 0 || x === 19 || y === 0 || y === 11 ? '#' : '.'));
  tiles[5]![5] = 'P';
  tiles[5]![exitX] = 'X';
  if (hazard) tiles[5]![6] = '~';
  const room = RoomSpecSchema.parse({
    id: 'disconnected-arena', index: 0, name: 'Disconnected arena', description: '',
    width: 20, height: 12, tiles: tiles.map((row) => row.join('')),
    props: [], attributions: [], isFinal: false,
    encounters: sentinel ? [{ id: 'sentinel', enemyId: 'sentinel', x: 10, y: 5, count: 1 }] : [],
    exits: [{ x: exitX, y: 5, toRoomIndex: 1, direction: 'east' }],
  });
  const sim = createSimulation({ deriveLaws: false });
  for (const id of ['a-present', 'b-away']) sim.addPlayer({ id, displayName: id, classId });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'bughunt-disconnected', createdAt: 0,
    recipe: { ...fixture.recipe, laws: [] }, art: fixture.art,
    rooms: [room], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Disconnect regression', lines: [] },
  }));
  sim.enterRoom(0);
  return sim;
}

function input(sim: Simulation, playerId: string, partial: Partial<PlayerIntent> = {}): void {
  const player = sim.getSnapshot().players.find((p) => p.id === playerId)!;
  sim.applyIntent({
    playerId, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
    attack: false, dash: false, ability: null, interact: false, ...partial,
  });
}

function frames(sim: Simulation, count: number): GameEvent[] {
  return Array.from({ length: count }, () => sim.step()).flat();
}

describe('disconnected operatives cannot participate in combat', () => {
  it('preserves an offline body standing on a hazard and resumes damage on reconnect', () => {
    const sim = setup('bastion', true);
    const away = () => sim.getSnapshot().players.find((p) => p.id === 'b-away')!;
    const hp = away().hp;
    sim.setPlayerConnected('b-away', false);
    const offline = frames(sim, 300);
    expect(offline.filter((event) => event.type === 'player_damaged' && event.playerId === 'b-away')).toEqual([]);
    expect(away().hp).toBe(hp);
    sim.setPlayerConnected('b-away', true);
    expect(frames(sim, 60)).toContainEqual(expect.objectContaining({ type: 'player_damaged', playerId: 'b-away' }));
    expect(away().hp).toBeLessThan(hp);
  });

  it.each(['bastion', 'shade', 'beacon', 'weaver'] as const)('discards queued and subsequent %s actions while disconnected', (classId) => {
    const sim = setup(classId);
    const away = () => sim.getSnapshot().players.find((p) => p.id === 'b-away')!;
    const before = away();
    input(sim, 'b-away', { moveX: 1, ability: 'q' });
    sim.setPlayerConnected('b-away', false);
    const events = sim.step();
    input(sim, 'b-away', { moveY: 1, attack: true, dash: true });
    events.push(...frames(sim, 15));
    expect(events.filter((event) => 'playerId' in event && event.playerId === 'b-away')).toEqual([]);
    expect(away()).toMatchObject({ x: before.x, y: before.y, vx: 0, vy: 0 });
    sim.setPlayerConnected('b-away', true);
    input(sim, 'b-away', { moveX: 1, ability: 'q' });
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'ability_used', playerId: 'b-away' }));
  });

  it('lets projectiles pass through the offline body to the present operative', () => {
    const sim = setup('bastion', false, true);
    sim.setPlayerConnected('b-away', false);
    const events = frames(sim, 180);
    expect(events.some((event) => event.type === 'enemy_telegraphed')).toBe(true);
    expect(events.filter((event) => event.type === 'player_damaged' && event.playerId === 'b-away')).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'player_damaged', playerId: 'a-present' }));
    expect(sim.getSnapshot().players.find((p) => p.id === 'b-away')!.hp).toBe(100);
  });

  it('does not take the crew through a door while disconnected', () => {
    const sim = setup('bastion', false, false, 6);
    sim.setPlayerConnected('b-away', false);
    expect(frames(sim, 2).filter((event) => event.type === 'exit_reached')).toEqual([]);
    sim.setPlayerConnected('b-away', true);
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'exit_reached', playerId: 'b-away' }));
  });
});
