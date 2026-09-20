import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent,
} from '../../src/shared/contracts';
import { TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { ANCHOR_DISCHARGE_MS, ANCHOR_PULSE_WARNING_MS } from '../../src/shared/finale';
import { CUSTODIAN_PATTERNS, custodianMaxHp, resolveCustodian } from '../../src/shared/custodian';
import { createSimulation, type Simulation } from '../../src/sim';
import { fightCustodian } from './finaleBot';

const fixture = WorldFixtureSchema.parse(fixtureJson);
const playerId = 'operative';
const relays = [{ x: 5, y: 3 }, { x: 16, y: 3 }, { x: 17, y: 11 }];

const CREW = [playerId, 'op-b', 'op-c'];

function setup(crew: string[] = [playerId]) {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  tiles[7]![13] = 'A';
  const room = RoomSpecSchema.parse({
    id: 'final-arena', index: 2, name: 'The final circuit', description: '',
    width: 26, height: 16, tiles: tiles.map((row) => row.join('')), props: [], exits: [],
    encounters: [{ id: 'custodian', enemyId: 'guardian', x: 10, y: 7, count: 1 }],
    isFinal: true, attributions: [], anchorRelays: relays,
  });
  const sim = createSimulation();
  for (const id of crew) sim.addPlayer({ id, displayName: id === playerId ? 'Operative' : id, classId: 'beacon' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'finale-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [fixture.rooms[0], fixture.rooms[1], room], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Test circuit', lines: [] },
  }));
  sim.enterRoom(2);
  return sim;
}

/** The operative the tests drive; a crew may hold others, and ids are not sorted by role. */
function me(sim: Simulation) {
  return sim.getSnapshot().players.find((player) => player.id === playerId)!;
}

function tick(sim: Simulation, partial: Partial<PlayerIntent> = {}): GameEvent[] {
  const player = me(sim);
  sim.applyIntent({
    playerId, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: player.x + 100, aimY: player.y,
    attack: false, dash: false, ability: null, interact: false, ...partial,
  });
  return sim.step();
}

function walk(sim: Simulation, target: { x: number; y: number }, hold = false) {
  for (let i = 0; i < 900; i++) {
    const player = me(sim);
    const d = Math.hypot(target.x - player.x, target.y - player.y);
    if (d <= 5) return;
    tick(sim, { moveX: (target.x - player.x) / d, moveY: (target.y - player.y) / d, interact: hold });
  }
  throw new Error('could not reach objective');
}

/**
 * The Custodian now has 1200 health, three distinct phases and a relay shield, so the test
 * operative has to play it: `finaleBot` dodges telegraphs, steps off hazard tiles and holds a
 * relay in phase 3. It throws if the fight is not winnable, which is the point of the check.
 */
function fight(sim: Simulation, crew: string[] = [playerId]) {
  const phases = new Set<number>();
  const result = fightCustodian(sim, crew);
  for (const event of result.events) if (event.type === 'boss_phase_changed') phases.add(event.phase);
  if (!result.killed) throw new Error('Custodian survived the test fight');
  return { phases, events: result.events };
}

function activate(sim: Simulation, index: number) {
  walk(sim, sim.getSnapshot().anchor!.ritual!.relays[index]!);
  tick(sim, { interact: true });
}

describe('Custodian and relay finale', () => {
  it('crosses three health phases with recovery windows and validates snapshots', () => {
    const sim = setup(CREW);
    const first = sim.getSnapshot().enemies[0]!;
    expect(first).toMatchObject({ bossPhase: 1, recoveryMs: 0, hp: custodianMaxHp(CREW.length) });
    fightCustodian(sim, CREW, 12_000, { stopWhen: (snapshot) => snapshot.enemies[0]!.bossPhase === 2 });
    const next = sim.getSnapshot().enemies[0]!;
    expect(next.bossPhase).toBe(2);
    expect(next.telegraph).toBeNull();
    expect(next.recoveryMs).toBeGreaterThan(1000);
    expect(next.state).toBe('idle');
    expect(sim.getSnapshot().projectiles).toEqual([]);
    const position = sim.getSnapshot().enemies[0]!;
    for (let i = 0; i < 20; i++) tick(sim);
    expect(sim.getSnapshot().enemies[0]).toMatchObject({ x: position.x, y: position.y, state: 'idle' });
    const { phases } = fight(sim, CREW);
    expect(phases).toEqual(new Set([3]));
    expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);
  });

  it('keeps relays locked during combat, retains each activation, and requires fresh presses in order', () => {
    const sim = setup(CREW);
    walk(sim, tileToWorld(relays[0]!.x, relays[0]!.y));
    tick(sim, { interact: true });
    expect(sim.getSnapshot().anchor!.ritual).toMatchObject({ stage: 'locked', activeRelay: 0 });
    fight(sim, CREW);
    expect(sim.getSnapshot().anchor!.ritual!.stage).toBe('relays');
    activate(sim, 1);
    expect(sim.getSnapshot().anchor!.ritual!.activeRelay).toBe(0);
    activate(sim, 0);
    expect(sim.getSnapshot().anchor!.ritual!.activeRelay).toBe(1);
    walk(sim, sim.getSnapshot().anchor!.ritual!.relays[1]!, true);
    expect(sim.getSnapshot().anchor!.ritual!.activeRelay).toBe(1);
    tick(sim);
    tick(sim, { interact: true });
    expect(sim.getSnapshot().anchor!.ritual!.activeRelay).toBe(2);
    tick(sim);
    expect(sim.getSnapshot().anchor!.progress).toBe(0.5);
    const copied = sim.getSnapshot();
    copied.anchor!.ritual!.relays[0]!.activated = false;
    expect(sim.getSnapshot().anchor!.ritual!.relays[0]!.activated).toBe(true);
  });

  it('reduces the final phase to two patterns and keeps the twelve-bolt ring', () => {
    const sim = setup();
    const picked = resolveCustodian({
      seed: 'finale-test', motifIds: fixture.recipe.motifIds,
      enemyPool: [...new Set(fixture.recipe.rooms.flatMap((room) => room.enemyIds))].filter((id) => id !== 'guardian'),
    }).moves.map((move) => move.patternId);
    fightCustodian(sim, [playerId], 12_000, {
      holdRelays: false,
      stopWhen: (snapshot) => snapshot.enemies.some((enemy) => enemy.bossPhase === 3),
    });
    expect(sim.getSnapshot().enemies[0]!.bossPhase).toBe(3);
    // Hollow Knight's last phase removes moves rather than adding them: the crew's attention is
    // on the relays now, so phase 3 alternates the third pick with the ring.
    const late = fightCustodian(sim, [playerId], 2400, { holdRelays: false });
    const used = late.events.filter((event) => event.type === 'boss_pattern_started')
      .map((event) => event.type === 'boss_pattern_started' ? event.patternId : '');
    expect(used.length).toBeGreaterThan(1);
    expect(new Set(used).size).toBeLessThanOrEqual(2);
    for (const id of used) expect([picked[2], 'ring_bloom']).toContain(id);
    const ring = late.events.find((event) => event.type === 'boss_pattern_started' && event.patternId === 'ring_bloom');
    if (ring) {
      expect(CUSTODIAN_PATTERNS.ring_bloom.damage).toBe(6);
      expect(sim.getSnapshot().projectiles!.length).toBeGreaterThan(0);
    }
  });

  it('requires all relays and a return to the core, then resolves exactly one cinematic victory', () => {
    const sim = setup(CREW);
    const { events } = fight(sim, CREW);
    expect(events.some((event) => event.type === 'run_ended')).toBe(false);
    walk(sim, sim.getSnapshot().anchor!);
    for (let i = 0; i < 190; i++) tick(sim, { interact: true });
    expect(sim.getPhase()).toBe('expedition');
    for (let index = 0; index < 3; index++) activate(sim, index);
    expect(sim.getSnapshot().anchor!.ritual!.stage).toBe('core');
    expect(sim.getSnapshot().anchor!.progress).toBe(0.75);
    walk(sim, sim.getSnapshot().anchor!);
    tick(sim, { interact: true });
    expect(sim.getSnapshot().anchor!.ritual!.stage).toBe('discharging');
    const ending: GameEvent[] = [];
    for (let i = 0; i < Math.ceil(ANCHOR_DISCHARGE_MS / TICK_MS) + 5; i++) ending.push(...tick(sim));
    expect(ending.filter((event) => event.type === 'anchor_planted')).toHaveLength(1);
    expect(ending.filter((event) => event.type === 'run_ended')).toEqual([expect.objectContaining({ outcome: 'anchored' })]);
    expect(sim.getSnapshot().anchor).toMatchObject({ state: 'planted', progress: 1, ritual: { stage: 'complete' } });
    expect(sim.getPhase()).toBe('debrief');
  });

  it('telegraphs pulses before damaging players once per wave and respects dash invulnerability', () => {
    const sim = setup(CREW);
    fight(sim, CREW);
    activate(sim, 0);
    expect(sim.getSnapshot().anchor!.ritual).toMatchObject({ pulseWarningMs: ANCHOR_PULSE_WARNING_MS, pulseRadius: 0 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 250; i++) events.push(...tick(sim));
    expect(events.filter((event) => event.type === 'player_damaged' && event.sourceEnemyId === 'anchor-pulse' && event.playerId === playerId)).toHaveLength(1);

    const dodging = setup();
    fight(dodging);
    activate(dodging, 0);
    let dashed = false;
    const dodgedEvents: GameEvent[] = [];
    for (let i = 0; i < 250; i++) {
      const snapshot = dodging.getSnapshot();
      const player = snapshot.players[0]!;
      const anchor = snapshot.anchor!;
      const d = Math.hypot(player.x - anchor.x, player.y - anchor.y);
      const dash = !dashed && anchor.ritual!.pulseWarningMs === 0 && d - anchor.ritual!.pulseRadius < 24;
      if (dash) dashed = true;
      dodgedEvents.push(...tick(dodging, { dash, aimX: anchor.x, aimY: anchor.y }));
    }
    expect(dashed).toBe(true);
    expect(dodgedEvents.filter((event) => event.type === 'player_damaged' && event.sourceEnemyId === 'anchor-pulse' && event.playerId === playerId)).toHaveLength(0);
  });
});
