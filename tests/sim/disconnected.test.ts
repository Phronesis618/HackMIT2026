/**
 * A11 — a co-op seat whose client has gone away.
 *
 * The server holds the seat for 30 s so a reload comes back as the same operative. Until now
 * the body stood in the room unmarked: enemies still fought it, and because it counted as a
 * living operative the run would not collapse when the only PRESENT player went down
 * (docs/QA_COOP.md, "Ghost seats are invisible as such").
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);

/** 16x10 arena. 'P' at (5,4); the seat east of it lands on a hazard tile when `burn` is set. */
function arena(index = 0, isFinal = false, burn = false, encounters: unknown[] = []): RoomSpec {
  const tiles: string[][] = Array.from({ length: 10 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x === 0 || x === 15 || y === 0 || y === 9 ? '#' : '.')));
  tiles[4]![5] = 'P';
  if (burn) tiles[4]![6] = '~';
  if (isFinal) tiles[7]![13] = 'A';
  else tiles[1]![14] = 'X';
  return RoomSpecSchema.parse({
    id: `ghost-arena-${index}`, index, name: 'Ghost arena', description: '', width: 16, height: 10,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [], relics: [], encounters,
    exits: isFinal ? [] : [{ x: 14, y: 1, toRoomIndex: index + 1, direction: 'east' }],
    isFinal,
  });
}

function expedition(crew: string[], room: RoomSpec): Simulation {
  const sim = createSimulation();
  for (const id of crew) sim.addPlayer({ id, displayName: id, classId: 'bastion' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'ghost-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [room, arena(1), arena(2, true)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Ghost seats', lines: [] },
  }));
  sim.enterRoom(0);
  return sim;
}

const idle = (sim: Simulation, id: string): PlayerIntent => {
  const player = sim.getSnapshot().players.find((candidate) => candidate.id === id)!;
  return {
    playerId: id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
    attack: false, dash: false, ability: null, interact: false,
  };
};

describe('a seat with nobody behind it', () => {
  it('is marked in the snapshot, and only while it is away', () => {
    const sim = expedition(['a-host', 'b-guest'], arena());
    const seat = (id: string) => sim.getSnapshot().players.find((player) => player.id === id)!;
    // Absent means present: a legacy or solo snapshot carries no such field at all.
    expect('connected' in seat('a-host')).toBe(false);

    sim.setPlayerConnected('b-guest', false);
    expect(seat('b-guest').connected).toBe(false);
    expect('connected' in seat('a-host')).toBe(false);
    expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);

    sim.setPlayerConnected('b-guest', true);
    expect('connected' in seat('b-guest')).toBe(false);
    sim.setPlayerConnected('nobody', false); // an unknown id is ignored
  });

  it('is not a target: the room goes quiet until somebody comes back', () => {
    const crew = ['a-away'];
    const sim = expedition(crew, arena(0, false, false, [{ id: 'husk', enemyId: 'husk', x: 8, y: 4, count: 1 }]));
    sim.setPlayerConnected('a-away', false);
    const quiet: GameEvent[] = [];
    for (let i = 0; i < 400; i++) {
      sim.applyIntent(idle(sim, 'a-away'));
      quiet.push(...sim.step());
    }
    expect(quiet.filter((event) => event.type === 'enemy_telegraphed')).toEqual([]);
    expect(quiet.filter((event) => event.type === 'player_damaged')).toEqual([]);
    expect(sim.getSnapshot().enemies[0]!.state).toBe('idle');
    expect(sim.getSnapshot().players[0]!.hp).toBe(sim.getSnapshot().players[0]!.maxHp);

    // ...and the moment the client is back, the husk has an opinion again.
    sim.setPlayerConnected('a-away', true);
    const loud: GameEvent[] = [];
    for (let i = 0; i < 400; i++) {
      sim.applyIntent(idle(sim, 'a-away'));
      loud.push(...sim.step());
    }
    expect(loud.some((event) => event.type === 'enemy_telegraphed')).toBe(true);
    expect(sim.getSnapshot().players[0]!.hp).toBeLessThan(sim.getSnapshot().players[0]!.maxHp);
  });

  it('does not keep a run alive after the last present operative goes down', () => {
    // 'a-ghost' spawns on 'P'; 'b-present' lands one tile east, on the hazard tile, and burns.
    const collapseAfter = (disconnectGhost: boolean): GameEvent[] => {
      const sim = expedition(['a-ghost', 'b-present'], arena(0, false, true));
      if (disconnectGhost) sim.setPlayerConnected('a-ghost', false);
      const events: GameEvent[] = [];
      for (let i = 0; i < 3000 && sim.getPhase() === 'expedition'; i++) {
        for (const id of ['a-ghost', 'b-present']) sim.applyIntent(idle(sim, id));
        events.push(...sim.step());
      }
      expect(events.some((event) => event.type === 'player_downed' && event.playerId === 'b-present')).toBe(true);
      return events;
    };

    // Today's behaviour with everyone present: the untouched operative keeps the run going.
    const together = collapseAfter(false);
    expect(together.filter((event) => event.type === 'run_ended')).toEqual([]);

    // With nobody behind the other seat, the run is over: the crew really is down.
    const alone = collapseAfter(true);
    expect(alone.filter((event) => event.type === 'run_ended')).toEqual([
      expect.objectContaining({ type: 'run_ended', outcome: 'collapsed' }),
    ]);
  });
});
