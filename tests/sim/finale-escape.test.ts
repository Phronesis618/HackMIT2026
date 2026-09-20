/**
 * The collapse and the extraction: the walk back to the portal after the Anchor discharges, the
 * `stranded` fail state, the co-op rules, and the one thing the crew carries out.
 * Spec: docs/design/BOSS_FINALE.md §6, §7, §8.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { anchorDischargeMs, anchorInstruction, preActivatedRelays, relicsRead } from '../../src/shared/finale';
import { createChronicleState, reduceChronicle } from '../../src/chronicle';
import { createSimulation, type Simulation } from '../../src/sim';
import {
  BLEED_OUT_MS, COLLAPSE_RING_MAX, LAST_STAND_HP, LAST_STAND_MS, PEDESTAL_HOLD_MS, buildOffer,
  collapseMs, createCollapse, enterExtraction, leaveRoom, planEscape, ROOM_LOST_DELAY_MS, stepCollapse, stepExtraction,
  type EscapeContext, type EscapePlayer,
} from '../../src/sim/escape';
import { fightCustodian } from './finaleBot';

// These tests exercise the sim's own derivation (seeded patterns, default names, offline laws),
// so the fixture's authored laws / look / custodian are stripped here.
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };
const relays = [{ x: 5, y: 3 }, { x: 16, y: 3 }, { x: 17, y: 11 }];
const CREW = ['op-a', 'op-b', 'op-c'];

/** A legacy three-room world whose final arena has a door back the way the crew came. */
function arena(index: number): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  if (index < 2) tiles[7]![24] = 'X';
  if (index > 0) tiles[7]![1] = 'X';
  if (index === 2) tiles[7]![13] = 'A';
  const exits = [
    ...(index > 0 ? [{ x: 1, y: 7, toRoomIndex: index - 1, direction: 'west' as const }] : []),
    ...(index < 2 ? [{ x: 24, y: 7, toRoomIndex: index + 1, direction: 'east' as const }] : []),
  ];
  return RoomSpecSchema.parse({
    id: `escape-${index}`, index, name: `Arena ${index}`, description: '', width: 26, height: 16,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [],
    encounters: index === 2 ? [{ id: 'custodian', enemyId: 'guardian', x: 10, y: 7, count: 1 }] : [],
    exits,
    isFinal: index === 2, ...(index === 2 ? { anchorRelays: relays } : {}),
  });
}

function setup(crew: string[] = [CREW[0]!]): Simulation {
  const sim = createSimulation();
  for (const id of crew) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'escape-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [arena(0), arena(1), arena(2)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Escape route', lines: [] },
  }));
  sim.enterRoom(2);
  return sim;
}

function tick(sim: Simulation, crew: string[], partial: Partial<PlayerIntent> = {}): GameEvent[] {
  for (const id of crew) {
    const player = sim.getSnapshot().players.find((candidate) => candidate.id === id)!;
    sim.applyIntent({
      playerId: id, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
      attack: false, dash: false, ability: null, interact: false, ...partial,
    });
  }
  const events = sim.step();
  // Legacy worlds: the session walks the crew through a door the sim reports.
  const exit = events.find((event) => event.type === 'exit_reached');
  if (exit?.type === 'exit_reached') events.push(...sim.enterRoom(exit.toRoomIndex));
  return events;
}

function walk(sim: Simulation, crew: string[], target: { x: number; y: number }, reach = 6): GameEvent[] {
  const events: GameEvent[] = [];
  const startRoom = sim.getSnapshot().roomIndex;
  for (let i = 0; i < 1200; i++) {
    const player = sim.getSnapshot().players.find((candidate) => candidate.id === crew[0]!)!;
    const d = Math.hypot(target.x - player.x, target.y - player.y);
    if (d <= reach || sim.getSnapshot().roomIndex !== startRoom || sim.getPhase() !== 'expedition') return events;
    events.push(...tick(sim, crew, { moveX: (target.x - player.x) / d, moveY: (target.y - player.y) / d }));
  }
  throw new Error('could not reach the objective');
}

/** Beat the Custodian and run the relay ritual, leaving the crew at the moment of discharge. */
function anchorTheWorld(sim: Simulation, crew: string[]): GameEvent[] {
  const events: GameEvent[] = [];
  const fight = fightCustodian(sim, crew);
  events.push(...fight.events);
  if (!fight.killed) throw new Error('the Custodian survived');
  for (let index = 0; index < 3; index++) {
    const ritual = sim.getSnapshot().anchor!.ritual!;
    if (ritual.activeRelay !== index) continue;
    events.push(...walk(sim, crew, ritual.relays[index]!));
    events.push(...tick(sim, crew, { interact: true }));
    events.push(...tick(sim, crew));
  }
  events.push(...walk(sim, crew, sim.getSnapshot().anchor!, 30));
  events.push(...tick(sim, crew, { interact: true }));
  for (let i = 0; i < 200 && sim.getSnapshot().anchor?.ritual?.stage === 'discharging'; i++) events.push(...tick(sim, crew));
  return events;
}

/** A stub context for the parts of the collapse that are pure rules. */
function stubContext(players: EscapePlayer[], crewSize = players.length) {
  const events: GameEvent[] = [];
  const revived: Array<{ id: string; hp: number }> = [];
  const ctx: EscapeContext = {
    worldId: 'w', room: arena(1), roomKey: '1',
    players: () => players,
    crewSize: () => crewSize,
    damagePlayer: (playerId, _source, damage) => {
      const player = players.find((candidate) => candidate.id === playerId);
      if (!player || player.hp <= 0) return false;
      player.hp = Math.max(0, player.hp - damage);
      return true;
    },
    revive: (playerId, hp) => {
      const player = players.find((candidate) => candidate.id === playerId);
      if (player) player.hp = hp;
      revived.push({ id: playerId, hp });
    },
    emit: (event) => { events.push({ ...event, id: `${events.length}`, tick: 0, timeMs: 0 } as GameEvent); },
  };
  return { ctx, events, revived };
}

describe('the ritual pays for what the crew read', () => {
  it('starts the circuit further along and shortens the discharge, one relic at a time', () => {
    expect([0, 1, 2, 3, 4, 5].map(preActivatedRelays)).toEqual([0, 0, 1, 1, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map(anchorDischargeMs)).toEqual([1600, 1450, 1300, 1150, 1000, 1000]);
    const lore = [
      { kind: 'relic' as const, title: 'a', source: 's', text: 't', roomIndex: 0, enemyId: null },
      { kind: 'remains' as const, title: 'b', source: 's', text: 't', roomIndex: 0, enemyId: 'husk' as const },
      { kind: 'relic' as const, title: 'c', source: 's', text: 't', roomIndex: 1, enemyId: null },
    ];
    expect(relicsRead([0, 1, 2], lore)).toBe(2);
    expect(relicsRead([1], lore)).toBe(0);
  });

  it('says so in one sentence', () => {
    const anchor = {
      x: 0, y: 0, state: 'dormant' as const, progress: 0,
      ritual: {
        stage: 'relays' as const, activeRelay: 2, pulseRadius: 0, pulseWarningMs: 0, dischargeMs: 0,
        relays: [
          { x: 0, y: 0, activated: true }, { x: 0, y: 0, activated: true }, { x: 0, y: 0, activated: false },
        ],
      },
    };
    expect(anchorInstruction(anchor, true)).toContain('2 relays already remember you');
    expect(anchorInstruction(anchor, true)).toContain('Relay 3/3');
  });
});

describe('the collapse', () => {
  it('times itself from the walk back and is generous with it', () => {
    expect(collapseMs(0, false)).toBe(60_000);
    expect(collapseMs(2, false)).toBe(75_000);
    expect(collapseMs(2, true)).toBe(90_000);
    expect(collapseMs(8, false)).toBe(165_000);
    expect(collapseMs(20, false)).toBe(180_000);
    expect(planEscape('2', '0', (key) => key === '2' ? ['1'] : key === '1' ? ['0', '2'] : ['1'])).toEqual(['2', '1', '0']);
    expect(planEscape('2', '0', () => [])).toBeNull();
  });

  it('closes a ring of hazard from the walls, at most three deep', () => {
    // A long route, so the clock outlasts the rings; the operative stands clear of the walls.
    const run = createCollapse({ route: ['8', '7', '6', '5', '4', '3', '2', '1', '0'], portalRoomId: 'escape-0', solo: false });
    const player = { id: 'a', x: 13 * 32, y: 7 * 32, hp: 100 };
    const { ctx } = stubContext([player]);
    for (let i = 0; i < Math.ceil(80_000 / TICK_MS); i++) stepCollapse(run, ctx);
    expect(run.ringDepth).toBe(COLLAPSE_RING_MAX);
    expect(player.hp).toBe(100);
    // Standing in the ring costs 10 every 600 ms, and only inside it.
    player.x = 32;
    player.y = 32;
    for (let i = 0; i < Math.ceil(1800 / TICK_MS); i++) stepCollapse(run, ctx);
    expect(player.hp).toBeLessThan(100);
  });

  it('gives a solo operative one last stand and strands them on the second fall', () => {
    const run = createCollapse({ route: ['1', '0'], portalRoomId: 'escape-0', solo: true });
    const players = [{ id: 'a', x: 200, y: 200, hp: 0 }];
    const { ctx } = stubContext(players, 1);
    let outcome: string | null = null;
    for (let i = 0; i < Math.ceil(LAST_STAND_MS / TICK_MS) + 2 && outcome === null; i++) outcome = stepCollapse(run, ctx);
    expect(players[0]!.hp).toBe(LAST_STAND_HP);
    expect(outcome).toBeNull();
    players[0]!.hp = 0;
    for (let i = 0; i < Math.ceil(BLEED_OUT_MS / TICK_MS) + 2 && outcome === null; i++) outcome = stepCollapse(run, ctx);
    expect(outcome).toBe('stranded');
  });

  it('strands a downed crew after the bleed-out, and strands anyone who runs out of clock', () => {
    const wipe = createCollapse({ route: ['1', '0'], portalRoomId: 'escape-0', solo: false });
    const { ctx } = stubContext([{ id: 'a', x: 200, y: 200, hp: 0 }, { id: 'b', x: 200, y: 200, hp: 0 }]);
    let outcome: string | null = null;
    for (let i = 0; i < Math.ceil(BLEED_OUT_MS / TICK_MS) + 2 && outcome === null; i++) outcome = stepCollapse(wipe, ctx);
    expect(outcome).toBe('stranded');

    const clock = createCollapse({ route: ['1', '0'], portalRoomId: 'escape-0', solo: false });
    const alive = stubContext([{ id: 'a', x: 200, y: 200, hp: 100 }]);
    let late: string | null = null;
    for (let i = 0; i < Math.ceil(clock.totalMs / TICK_MS) + 2 && late === null; i++) late = stepCollapse(clock, alive.ctx);
    expect(late).toBe('stranded');
    expect(clock.remainingMs).toBe(0);
  });
});

describe('a wrong turn during the collapse', () => {
  it('never fails the route room behind a crew that stepped into a side room', () => {
    const run = createCollapse({ route: ['2', '1', '0'], portalRoomId: 'room-0', solo: true });
    const { ctx, events } = stubContext([{ id: 'a', x: 200, y: 200, hp: 100 }]);
    leaveRoom(run, '1', 'room-1', 'side');
    for (let i = 0; i < Math.ceil(ROOM_LOST_DELAY_MS / TICK_MS) + 2; i++) stepCollapse(run, ctx);
    expect(run.lostRoomIds).toEqual([]);
    // The side room itself goes once the crew walks back out of it, and the route room goes
    // when they leave it toward the portal.
    leaveRoom(run, 'side', 'room-side', '1');
    leaveRoom(run, '1', 'room-1', '0');
    for (let i = 0; i < Math.ceil(ROOM_LOST_DELAY_MS / TICK_MS) + 2; i++) stepCollapse(run, ctx);
    expect(run.lostRoomIds).toEqual(['room-side', 'room-1']);
    expect(events.filter((event) => event.type === 'room_lost')).toHaveLength(2);
  });
});

describe('the extraction', () => {
  it('offers only things that really happened, relics first', () => {
    const lore = [
      { kind: 'relic' as const, title: 'Tide gauge note', source: 'scratched into a gauge', text: 't', roomIndex: 0, enemyId: null },
      { kind: 'remains' as const, title: 'Warden lamp', source: 'from a lamp', text: 't', roomIndex: 0, enemyId: 'warden' as const },
      { kind: 'relic' as const, title: 'Stores ledger', source: 'cage B', text: 't', roomIndex: 1, enemyId: null },
    ];
    const at = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const log = { title: 'Custodian log', detail: 'The Ledger: Ring Bloom. 40 seconds.' };
    const full = buildOffer({ lore, discovered: [0, 1, 2], custodianLog: log, at });
    expect(full.map((card) => card.key)).toEqual(['relic:2', 'relic:0', 'remains:1']);
    // A crew that read nothing gets exactly one choice, which is itself a statement.
    const bare = buildOffer({ lore, discovered: [], custodianLog: log, at });
    expect(bare.map((card) => card.key)).toEqual(['custodian_log']);
    expect(buildOffer({ lore, discovered: [], custodianLog: null, at })).toEqual([]);
  });

  it('locks on a solo hold, on a co-op majority, and by itself when the twenty seconds are up', () => {
    const lore: never[] = [];
    const at = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }];
    const log = { title: 'Custodian log', detail: 'detail' };
    const solo = createCollapse({ route: ['1', '0'], portalRoomId: 'escape-0', solo: true });
    const alone = [{ id: 'a', x: 0, y: 0, hp: 100 }];
    const soloCtx = stubContext(alone, 1);
    enterExtraction(solo, buildOffer({ lore, discovered: [], custodianLog: log, at }), soloCtx.ctx);
    let chosen = null;
    for (let i = 0; i < Math.ceil(PEDESTAL_HOLD_MS / TICK_MS) + 1 && chosen === null; i++) chosen = stepExtraction(solo, soloCtx.ctx);
    expect(chosen?.key).toBe('custodian_log');
    expect(solo.chosenKey).toBe('custodian_log');

    const crew = createCollapse({ route: ['1', '0'], portalRoomId: 'escape-0', solo: false });
    const three = [
      { id: 'a', x: 0, y: 0, hp: 100 }, { id: 'b', x: 0, y: 0, hp: 100 }, { id: 'c', x: 400, y: 0, hp: 0 },
    ];
    const crewCtx = stubContext(three);
    enterExtraction(crew, buildOffer({ lore, discovered: [], custodianLog: log, at }), crewCtx.ctx);
    // Everyone who was down stands up at the pedestals: nobody watches the ending from the floor.
    expect(three[2]!.hp).toBe(40);
    three[2]!.x = 400;
    expect(stepExtraction(crew, crewCtx.ctx)?.key).toBe('custodian_log');

    const idle = createCollapse({ route: ['1', '0'], portalRoomId: 'escape-0', solo: false });
    const away = stubContext([{ id: 'a', x: 900, y: 900, hp: 100 }, { id: 'b', x: 900, y: 900, hp: 100 }]);
    enterExtraction(idle, buildOffer({ lore, discovered: [], custodianLog: log, at }), away.ctx);
    let late = null;
    for (let i = 0; i < Math.ceil(21_000 / TICK_MS) && late === null; i++) late = stepExtraction(idle, away.ctx);
    expect(late?.key).toBe('custodian_log');
  });
});

describe('a whole finale, in the simulation', () => {
  it('walks the crew back to the portal, offers the run, and records what they carried out', () => {
    const sim = setup(CREW);
    const events = anchorTheWorld(sim, CREW);
    expect(sim.getSnapshot().anchor!.ritual!.stage).toBe('collapse');
    const started = sim.getSnapshot().collapse!;
    // Two hops back to room 1, three operatives, so no solo grace.
    expect(started).toMatchObject({ stage: 'collapse', totalMs: 75_000, portalRoomId: 'escape-0', lostRoomIds: [] });
    expect(events.some((event) => event.type === 'collapse_started')).toBe(true);
    expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);

    // The doors are open even though the crew never cleared these rooms on the way back.
    const backDoor = tileToWorld(1, 7);
    events.push(...walk(sim, CREW, backDoor, 10));
    expect(sim.getSnapshot().roomIndex).toBe(1);
    events.push(...walk(sim, CREW, backDoor, 10));
    expect(sim.getSnapshot().roomIndex).toBe(0);
    events.push(...tick(sim, CREW));
    expect(sim.getSnapshot().collapse!.stage).toBe('extraction');
    // Rooms fail behind the crew and cannot be walked back into.
    expect(events.some((event) => event.type === 'room_lost')).toBe(true);
    expect(sim.enterRoom(1)).toEqual([]);
    // A crew that knows the route arrives with most of the clock left (Dread's margin).
    expect(sim.getSnapshot().collapse!.remainingMs / started.totalMs).toBeGreaterThan(0.35);

    const offer = sim.getSnapshot().collapse!.offer;
    expect(offer.length).toBeGreaterThan(0);
    expect(offer.some((card) => card.key === 'custodian_log')).toBe(true);
    events.push(...walk(sim, CREW, offer[0]!, 12));
    for (let i = 0; i < 1400 && sim.getPhase() === 'expedition'; i++) events.push(...tick(sim, CREW));
    expect(sim.getPhase()).toBe('debrief');
    const carried = events.filter((event) => event.type === 'relic_carried');
    expect(carried).toHaveLength(1);
    expect(events.filter((event) => event.type === 'run_ended')).toEqual([expect.objectContaining({ outcome: 'anchored' })]);

    // The choice is a real chronicle event, so the hub wall can show the thing they carried.
    const { created } = reduceChronicle(createChronicleState(), events, {
      now: 1000, players: CREW.map((id) => ({ id, displayName: id })),
      world: { worldId: 'escape-test', title: fixture.recipe.title, provenanceSource: 'fixture', receipt: null },
    });
    const memory = created.filter((record) => record.title.startsWith('Carried out'));
    expect(memory).toHaveLength(1);
    expect(memory[0]!.sourceEventIds).toEqual([carried[0]!.id]);
  }, 60_000);

  it('strands the crew when the clock runs out, and keeps the world anchored anyway', () => {
    const sim = setup(CREW);
    const events = anchorTheWorld(sim, CREW);
    expect(sim.getSnapshot().collapse!.stage).toBe('collapse');
    const total = sim.getSnapshot().collapse!.totalMs;
    for (let i = 0; i < Math.ceil(total / TICK_MS) + 4 && sim.getPhase() === 'expedition'; i++) events.push(...tick(sim, CREW));
    expect(sim.getPhase()).toBe('debrief');
    expect(sim.getSnapshot().anchor!.ritual!.stage).toBe('stranded');
    expect(events.filter((event) => event.type === 'anchor_planted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'relic_carried')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'run_ended')).toEqual([expect.objectContaining({ outcome: 'stranded' })]);
    // The world is saved and the run is honest about it.
    const { created } = reduceChronicle(createChronicleState(), events, {
      now: 1000, players: CREW.map((id) => ({ id, displayName: id })),
      world: { worldId: 'escape-test', title: fixture.recipe.title, provenanceSource: 'fixture', receipt: null },
    });
    expect(created.some((record) => record.kind === 'anchor')).toBe(true);
    expect(created.find((record) => record.kind === 'run_summary')!.summary).toContain('did not get out');
  }, 60_000);

  it('is deterministic: the same intents produce the same finale twice', () => {
    const play = () => {
      const sim = setup(CREW);
      const events = anchorTheWorld(sim, CREW);
      const backDoor = tileToWorld(1, 7);
      events.push(...walk(sim, CREW, backDoor, 10));
      events.push(...walk(sim, CREW, backDoor, 10));
      events.push(...tick(sim, CREW));
      return { snapshot: JSON.stringify(sim.getSnapshot()), events: JSON.stringify(events) };
    };
    const a = play();
    const b = play();
    expect(a.snapshot).toEqual(b.snapshot);
    expect(a.events).toEqual(b.events);
  }, 120_000);
});
