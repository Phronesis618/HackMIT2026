/**
 * T0 — '~' hazard floor is real: it burns whoever stands on it, enemies included.
 * Exact numbers from docs/design/TILES.md §2 plus the demo-safety call (players at 50%).
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { TICK_MS } from '../../src/shared/conventions';
import {
  HAZARD_DAMAGE, HAZARD_INTERVAL_MS, TERRAIN_DAMAGE_SOURCE, TERRAIN_ELITE_DAMAGE_SCALE,
  TERRAIN_PLAYER_DAMAGE_SCALE, terrainTuning,
} from '../../src/shared/terrain';
import { createHazardClock, stepHazardTiles } from '../../src/sim/hazards';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);

/**
 * 16x10 arena. A three-tile hazard band at (5..7, 4) sits on the walking line from the spawn,
 * and a husk pen at (11,4) is a single hazard tile walled in on every side, so the enemy in it
 * cannot walk off the fire and its burn is exactly on the clock.
 */
function hazardArena(index = 0, isFinal = false): RoomSpec {
  const tiles: string[][] = Array.from({ length: 10 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x === 0 || x === 15 || y === 0 || y === 9 ? '#' : '.')));
  tiles[4]![2] = 'P';
  for (const x of [5, 6, 7]) tiles[4]![x] = '~';
  for (const [x, y] of [[10, 3], [10, 4], [10, 5], [11, 3], [11, 5], [12, 3], [12, 4], [12, 5]] as const) tiles[y]![x] = '#';
  tiles[4]![11] = '~';
  if (isFinal) tiles[7]![13] = 'A';
  else tiles[1]![14] = 'X';
  return RoomSpecSchema.parse({
    id: `hazard-arena-${index}`, index, name: 'Hazard arena', description: '', width: 16, height: 10,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [], relics: [],
    encounters: isFinal ? [] : [{ id: `pen-${index}`, enemyId: 'husk', x: 11, y: 4, count: 1 }],
    exits: isFinal ? [] : [{ x: 14, y: 1, toRoomIndex: 1, direction: 'east' }],
    isFinal,
  });
}

function expedition(rooms: RoomSpec[] = [hazardArena(0), hazardArena(1), hazardArena(2, true)]): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'hazard-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms, plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Hazards', lines: [] },
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

const playerTile = (sim: Simulation) => Math.floor(sim.getSnapshot().players[0]!.x / 32);
const hp = (sim: Simulation) => sim.getSnapshot().players[0]!.hp;
const enemyHp = (sim: Simulation) => sim.getSnapshot().enemies[0]!.hp;

describe('hazard tiles, as pure rules', () => {
  it('burns on a fixed interval and never while dashing', () => {
    const tuning = terrainTuning();
    const room = hazardArena();
    const clock = createHazardClock();
    const on = { x: 5 * 32 + 16, y: 4 * 32 + 16, kind: 'enemy' as const, immune: false };
    let elapsed = 0;
    let hits = 0;
    while (elapsed < HAZARD_INTERVAL_MS - TICK_MS) {
      elapsed += TICK_MS;
      hits += stepHazardTiles(room, [], elapsed, on, clock, tuning).length;
    }
    expect(hits).toBe(0);
    expect(stepHazardTiles(room, [], elapsed + TICK_MS, on, clock, tuning))
      .toEqual([{ source: TERRAIN_DAMAGE_SOURCE.hazard, damage: HAZARD_DAMAGE }]);
    // Leaving the tile resets the clock: you cannot bank progress towards a burn.
    stepHazardTiles(room, [], 0, { ...on, x: 4 * 32 + 16 }, clock, tuning);
    expect(clock.hazardMs).toBe(0);
    for (let i = 0; i < 200; i++) expect(stepHazardTiles(room, [], i * TICK_MS, { ...on, immune: true }, clock, tuning)).toEqual([]);
  });

  it('halves the number for players and for elites, and leaves ordinary enemies at full', () => {
    const tuning = terrainTuning();
    const room = hazardArena();
    const at = { x: 5 * 32 + 16, y: 4 * 32 + 16, immune: false };
    const run = (subject: Parameters<typeof stepHazardTiles>[3]) => {
      const clock = createHazardClock();
      for (let elapsed = TICK_MS; elapsed <= HAZARD_INTERVAL_MS; elapsed += TICK_MS) {
        const hits = stepHazardTiles(room, [], elapsed, subject, clock, tuning);
        if (hits.length > 0) return hits[0]!.damage;
      }
      return 0;
    };
    expect(run({ ...at, kind: 'enemy', enemyId: 'husk' })).toBe(HAZARD_DAMAGE);
    expect(run({ ...at, kind: 'enemy', enemyId: 'guardian' })).toBe(HAZARD_DAMAGE * TERRAIN_ELITE_DAMAGE_SCALE);
    expect(run({ ...at, kind: 'player' })).toBe(HAZARD_DAMAGE * TERRAIN_PLAYER_DAMAGE_SCALE);
  });

  it('interpolates inside the clamped intensity band, with 0.5 exactly on the baseline', () => {
    expect(terrainTuning(0)).toMatchObject({ hazardIntervalMs: 800, hazardDamage: 6 });
    expect(terrainTuning(0.5)).toMatchObject({ hazardIntervalMs: HAZARD_INTERVAL_MS, hazardDamage: HAZARD_DAMAGE });
    expect(terrainTuning(1)).toMatchObject({ hazardIntervalMs: 450, hazardDamage: 11 });
    // Out of range and nonsense clamp rather than throw: the model supplies this number.
    expect(terrainTuning(-4)).toEqual(terrainTuning(0));
    expect(terrainTuning(9)).toEqual(terrainTuning(1));
    expect(terrainTuning(Number.NaN)).toEqual(terrainTuning(0.5));
  });
});

describe('hazard tiles in the simulation', () => {
  it('costs a standing player exactly half a hazard tick every interval', () => {
    const sim = expedition();
    while (playerTile(sim) < 5) tick(sim, { moveX: 1 });
    const expected = HAZARD_DAMAGE * TERRAIN_PLAYER_DAMAGE_SCALE;
    let previous = hp(sim);
    const burns: number[] = [];
    for (let i = 0; i < Math.ceil((HAZARD_INTERVAL_MS * 3) / TICK_MS) + 4; i++) {
      const events = tick(sim);
      if (hp(sim) === previous) continue;
      expect(previous - hp(sim)).toBe(expected);
      expect(events.some((e) => e.type === 'player_damaged' && e.sourceEnemyId === TERRAIN_DAMAGE_SOURCE.hazard)).toBe(true);
      previous = hp(sim);
      burns.push(sim.getTick());
    }
    expect(burns.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < burns.length; i++) expect(burns[i]! - burns[i - 1]!).toBe(HAZARD_INTERVAL_MS / TICK_MS);
  });

  it('lets a dash cross a three-tile band for free, and does not grant i-frames when it burns', () => {
    const sim = expedition();
    while (playerTile(sim) < 4) tick(sim, { moveX: 1 });
    const before = hp(sim);
    tick(sim, { moveX: 1, dash: true });
    while (playerTile(sim) <= 7) tick(sim, { moveX: 1 });
    expect(hp(sim)).toBe(before);

    const burning = expedition();
    while (playerTile(burning) < 5) tick(burning, { moveX: 1 });
    let burned = false;
    for (let i = 0; i < 60 && !burned; i++) {
      tick(burning);
      burned = burning.getSnapshot().players[0]!.hp < 100;
    }
    expect(burned).toBe(true);
    expect(burning.getSnapshot().players[0]!.invulnerableMs).toBe(0);
  });

  it('kills a husk that cannot leave the fire, on the same clock, and credits the crew', () => {
    const sim = expedition();
    expect(enemyHp(sim)).toBe(30);
    const defeats: GameEvent[] = [];
    let ticks = 0;
    while (enemyHp(sim) > 0 && ticks < 400) {
      defeats.push(...tick(sim).filter((e) => e.type === 'enemy_defeated'));
      ticks++;
    }
    // 30 hp at 8 a burn = four burns; the fourth lands at 4 x 600 ms.
    expect(ticks).toBe((HAZARD_INTERVAL_MS * 4) / TICK_MS);
    expect(defeats).toHaveLength(1);
    expect(defeats[0]).toMatchObject({ type: 'enemy_defeated', byPlayerId: 'tester' });
    expect(sim.getSnapshot().players[0]!.ultCharge).toBeGreaterThan(0);
  });

  it('is deterministic: two simulations fed the same intents agree tick for tick', () => {
    const a = expedition();
    const b = expedition();
    for (let i = 0; i < 260; i++) {
      const input = { moveX: i < 40 ? 1 : i % 7 === 0 ? -1 : 0, moveY: i % 11 === 0 ? 1 : 0, dash: i === 90 };
      const eventsA = tick(a, input);
      const eventsB = tick(b, input);
      expect(eventsA).toEqual(eventsB);
      expect(a.getSnapshot()).toEqual(b.getSnapshot());
    }
    expect(a.getSnapshot().players[0]!.hp).toBeLessThan(100);
  });
});
