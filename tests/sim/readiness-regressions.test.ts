import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameEventSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { LORE_READ_MS, PLAYER_RADIUS, TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { ENEMY_PROJECTILE_PATTERN } from '../../src/sim/combat';
import { createSimulation, type Simulation } from '../../src/sim';

// The fixture's own world laws are stripped: these cases measure the base rules, and
// vantage-spire now carries laws the engine really applies (tests/sim/laws.test.ts covers those).
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };
const playerId = 'readiness-player';
const worldId = 'readiness-world';
const huskFragment = fixture.recipe.lore.findIndex((fragment) => fragment.kind === 'remains' && fragment.enemyId === 'husk');

function player(sim: Simulation) {
  return sim.getSnapshot().players[0]!;
}

function step(sim: Simulation, input: Partial<PlayerIntent> = {}): GameEvent[] {
  const p = player(sim);
  sim.applyIntent({
    playerId, seq: sim.getTick(), moveX: 0, moveY: 0, aimX: p.x + 100, aimY: p.y,
    attack: false, dash: false, ability: null, interact: false, ...input,
  });
  const events = sim.step();
  if (sim.getPhase() === 'training') {
    expect(player(sim).hp).toBeGreaterThanOrEqual(1);
    expect(events.some((event) => event.type === 'player_downed')).toBe(false);
  }
  return events;
}

function walkTo(sim: Simulation, target: { x: number; y: number }): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < 600; i++) {
    const p = player(sim);
    const distance = Math.hypot(target.x - p.x, target.y - p.y);
    if (distance < 4) return events;
    events.push(...step(sim, { moveX: (target.x - p.x) / distance, moveY: (target.y - p.y) / distance }));
  }
  throw new Error('Player did not reach the target');
}

function arena(index: number): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  tiles[7]![24] = 'X';
  return RoomSpecSchema.parse({
    id: `readiness-arena-${index}`, index, name: 'Readiness arena', description: '', width: 26, height: 16,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [],
    encounters: [{ id: `husk-${index}`, enemyId: 'husk', x: 11, y: 7, count: 1 }],
    relics: [{ id: `relic-${index}`, x: 5, y: 5, fragmentIndex: 0 }],
    exits: [{ x: 24, y: 7, toRoomIndex: index === 0 ? 1 : 0, direction: 'east' }], isFinal: false,
  });
}

function world() {
  return PreparedWorldSchema.parse({
    worldId, createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [arena(0), arena(1), fixture.rooms[2]!], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Readiness test', lines: [] },
  });
}

function setup(training = false, prepared = true): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: playerId, displayName: 'Tester', classId: 'beacon' });
  if (prepared) sim.setWorld(world());
  if (training) sim.enterTraining();
  else sim.enterRoom(0);
  return sim;
}

function defeatHusk(sim: Simulation): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < 300; i++) {
    const husk = sim.getSnapshot().enemies.find((enemy) => enemy.enemyId === 'husk')!;
    if (husk.hp === 0) return events;
    events.push(...step(sim, { aimX: husk.x, aimY: husk.y, attack: true }));
  }
  throw new Error('Husk was not defeated');
}

function waitForShot(sim: Simulation, ownerEnemyId: string) {
  let telegraphed = false;
  for (let i = 0; i < 300; i++) {
    const before = new Set(sim.getSnapshot().projectiles?.map((bolt) => bolt.id));
    const events = step(sim);
    telegraphed ||= events.some((event) => event.type === 'enemy_telegraphed' && event.enemyId === ownerEnemyId);
    const shot = sim.getSnapshot().projectiles?.find((bolt) => bolt.ownerEnemyId === ownerEnemyId && !before.has(bolt.id));
    if (telegraphed && shot) return shot;
  }
  throw new Error(`No projectile from ${ownerEnemyId}`);
}

describe('training projectile processing', () => {
  it('moves sentinel bolts, applies collision damage, consumes impacts, and preserves regeneration', () => {
    const sim = setup(true);
    walkTo(sim, tileToWorld(3, 6));
    walkTo(sim, tileToWorld(20, 6));
    const bolt = waitForShot(sim, 'tr-sentinel-0');
    step(sim);
    const moved = sim.getSnapshot().projectiles!.find((shot) => shot.id === bolt.id)!;
    expect(moved.x).toBeCloseTo(bolt.x + bolt.vx * TICK_MS / 1000);
    expect(moved.y).toBeCloseTo(bolt.y + bolt.vy * TICK_MS / 1000);

    let impact: Extract<GameEvent, { type: 'player_damaged' }> | undefined;
    for (let i = 0; i < 100 && !impact; i++) {
      const before = sim.getSnapshot().projectiles!.find((shot) => shot.id === bolt.id);
      const hpBefore = player(sim).hp;
      const events = step(sim);
      impact = events.find((event): event is Extract<GameEvent, { type: 'player_damaged' }> =>
        event.type === 'player_damaged' && event.sourceEnemyId === bolt.ownerEnemyId);
      if (impact) {
        expect(impact.remainingHp).toBeLessThan(hpBefore);
        expect(before).toBeDefined();
        expect(Math.hypot(
          before!.x + before!.vx * TICK_MS / 1000 - player(sim).x,
          before!.y + before!.vy * TICK_MS / 1000 - player(sim).y,
        )).toBeLessThanOrEqual(bolt.radius + PLAYER_RADIUS);
        expect(sim.getSnapshot().projectiles!.some((shot) => shot.id === bolt.id)).toBe(false);
      }
    }
    expect(impact).toMatchObject({ amount: 7 });
    const woundedHp = player(sim).hp;
    expect(woundedHp).toBe(impact!.remainingHp);
    for (let i = 0; i < 60; i++) step(sim);
    expect(player(sim).hp).toBeGreaterThan(woundedHp);
    for (let i = 0; i < 1200; i++) step(sim);
    expect(sim.getPhase()).toBe('training');
  });

  it('expires unobstructed sentinel bolts at their configured lifetime even without a target', () => {
    const sim = setup(true);
    walkTo(sim, tileToWorld(20, 8));
    const bolt = waitForShot(sim, 'tr-sentinel-0');
    sim.removePlayer(playerId);
    const lifetimeTicks = Math.ceil(ENEMY_PROJECTILE_PATTERN.sentinel!.life / TICK_MS);
    for (let i = 0; i < lifetimeTicks - 2; i++) sim.step();
    expect(sim.getSnapshot().projectiles!.some((shot) => shot.id === bolt.id)).toBe(true);
    sim.step();
    expect(sim.getSnapshot().projectiles!.some((shot) => shot.id === bolt.id)).toBe(false);
  });

  it('steers a warden bolt toward a moving trainee at its bounded turn rate', () => {
    const sim = setup(true);
    walkTo(sim, tileToWorld(20, 8));
    const bolt = waitForShot(sim, 'tr-warden-0');
    step(sim, { moveX: 1 });
    const moved = sim.getSnapshot().projectiles!.find((shot) => shot.id === bolt.id)!;
    expect(moved).toBeDefined();
    expect(moved.vx).toBeGreaterThan(bolt.vx);
    expect(Math.hypot(moved.vx, moved.vy)).toBeCloseTo(ENEMY_PROJECTILE_PATTERN.warden!.speed);
    const turn = Math.atan2(moved.vy, moved.vx) - Math.atan2(bolt.vy, bolt.vx);
    expect(turn).toBeGreaterThan(0);
    expect(turn).toBeLessThanOrEqual(ENEMY_PROJECTILE_PATTERN.warden!.homingTurnRate! * TICK_MS / 1000 + 1e-7);
    expect(moved.y).not.toBe(bolt.y);
  });
});

describe('combat and lore event origin', () => {
  it.each([false, true])('keeps training combat events without expedition drops (prepared world: %s)', (prepared) => {
    const sim = setup(true, prepared);
    const events = walkTo(sim, tileToWorld(13, 8));
    events.push(...defeatHusk(sim));
    expect(events.some((event) => event.type === 'player_attacked')).toBe(true);
    expect(events.some((event) => event.type === 'enemy_damaged')).toBe(true);
    expect(events.filter((event) => event.type === 'enemy_defeated')).toEqual([
      expect.objectContaining({ enemyId: 'tr-husk-0', byPlayerId: playerId, worldId: null }),
    ]);
    expect(sim.getSnapshot().loreNodes).toEqual([]);
    expect(sim.getSnapshot().discoveredLore).toEqual([]);
    expect(events.some((event) => event.type === 'lore_discovered')).toBe(false);
    for (const event of events) expect(GameEventSchema.parse(event)).toEqual(event);

    if (prepared) {
      sim.returnToHeadquarters();
      sim.enterRoom(0);
      defeatHusk(sim);
      expect(sim.getSnapshot().loreNodes).toContainEqual(expect.objectContaining({ kind: 'remains', fragmentIndex: huskFragment }));
    }
  });

  it('attributes expedition kills, remains, and relic discoveries to the actual world', () => {
    const sim = setup();
    const events = defeatHusk(sim);
    const remains = sim.getSnapshot().loreNodes!.find((node) => node.kind === 'remains')!;
    events.push(...walkTo(sim, remains));
    events.push(...walkTo(sim, tileToWorld(5, 5)));
    for (let i = 0; i < Math.ceil(LORE_READ_MS / TICK_MS) + 1; i++) events.push(...step(sim, { interact: true }));
    expect(events.filter((event) => event.type === 'enemy_defeated')).toEqual([
      expect.objectContaining({ worldId, byPlayerId: playerId, enemyId: 'husk-0-0' }),
    ]);
    expect(events.filter((event) => event.type === 'lore_discovered')).toEqual([
      expect.objectContaining({ worldId, playerId, kind: 'remains', fragmentIndex: huskFragment }),
      expect.objectContaining({ worldId, playerId, kind: 'relic', fragmentIndex: 0 }),
    ]);
    for (const event of events) expect(GameEventSchema.parse(event)).toEqual(event);
  });
});

describe('lore revisits', () => {
  it('consumes stale remains without rediscovery and allows discovery again on a fresh run', () => {
    const sim = setup();
    const events = defeatHusk(sim);
    const firstDrop = sim.getSnapshot().loreNodes!.find((node) => node.kind === 'remains')!;
    expect(firstDrop).toMatchObject({ fragmentIndex: huskFragment, state: 'sealed' });
    expect(sim.getSnapshot().discoveredLore).toEqual([]);
    events.push(...sim.enterRoom(1));
    expect(sim.getRoom().index).toBe(1);
    events.push(...defeatHusk(sim));
    const secondDrop = sim.getSnapshot().loreNodes!.find((node) => node.kind === 'remains')!;
    expect(secondDrop).toMatchObject({ fragmentIndex: huskFragment, state: 'sealed' });
    events.push(...walkTo(sim, secondDrop));
    expect(events.filter((event) => event.type === 'lore_discovered')).toHaveLength(1);
    events.push(...sim.enterRoom(0));
    expect(sim.getRoom().index).toBe(0);
    expect(sim.getSnapshot().loreNodes).toContainEqual(firstDrop);
    events.push(...walkTo(sim, firstDrop));
    expect(sim.getSnapshot().loreNodes!.some((node) => node.kind === 'remains')).toBe(false);
    expect(events.filter((event) => event.type === 'lore_discovered')).toHaveLength(1);
    expect(sim.getSnapshot().discoveredLore).toEqual([huskFragment]);

    sim.returnToHeadquarters();
    expect(sim.getSnapshot().discoveredLore).toEqual([]);
    sim.enterRoom(0);
    const freshEvents = defeatHusk(sim);
    const freshDrop = sim.getSnapshot().loreNodes!.find((node) => node.kind === 'remains')!;
    expect(freshDrop).toMatchObject({ fragmentIndex: huskFragment, state: 'sealed' });
    freshEvents.push(...walkTo(sim, freshDrop));
    expect(freshEvents.filter((event) => event.type === 'lore_discovered')).toEqual([
      expect.objectContaining({ worldId, fragmentIndex: huskFragment }),
    ]);
  });
});
