/**
 * T0 — '~' hazard floor is real: it burns whoever stands on it, enemies included.
 * Exact numbers from docs/design/TILES.md T0: a ramping burn, 3/6/9/12/15, enemies at x1.6,
 * elites at half that, reset on step-off or dash, and an environmental kill credits nobody.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { TICK_MS } from '../../src/shared/conventions';
import {
  ENEMY_HAZARD_MUL, ENV_KILL_CREDIT, HAZARD_BASE, HAZARD_INTERVAL_MS, HAZARD_STACK_MAX,
  TERRAIN_DAMAGE_SOURCE, TERRAIN_ELITE_DAMAGE_SCALE, terrainTuning,
} from '../../src/shared/terrain';
import { createHazardClock, stepHazardTiles } from '../../src/sim/hazards';
import { createSimulation, type Simulation } from '../../src/sim';

// The fixture's own world laws are stripped: these cases measure the base rules, and
// vantage-spire now carries laws the engine really applies (tests/sim/laws.test.ts covers those).
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };

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

function expedition(rooms: RoomSpec[] = [hazardArena(0), hazardArena(1), hazardArena(2, true)], recipeExtra: Record<string, unknown> = {}): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'hazard-test', createdAt: 0, recipe: { ...fixture.recipe, ...recipeExtra }, art: fixture.art,
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

/** Every hazard tick one subject takes while standing still on the band for `ms`. */
function burnSequence(subject: Parameters<typeof stepHazardTiles>[3], ms: number): number[] {
  const tuning = terrainTuning();
  const room = hazardArena();
  const clock = createHazardClock();
  const damages: number[] = [];
  for (let elapsed = TICK_MS; elapsed <= ms + 1e-7; elapsed += TICK_MS) {
    for (const hit of stepHazardTiles(room, [], elapsed, subject, clock, tuning)) damages.push(hit.damage);
  }
  return damages;
}

const onBand = { x: 5 * 32 + 16, y: 4 * 32 + 16, immune: false };

describe('hazard tiles, as pure rules', () => {
  it('ramps 3, 6, 9, 12, 15, 15 for a player and resets the moment they step off', () => {
    expect(burnSequence({ ...onBand, kind: 'player' }, HAZARD_INTERVAL_MS * 6)).toEqual([3, 6, 9, 12, 15, 15]);

    const tuning = terrainTuning();
    const room = hazardArena();
    const clock = createHazardClock();
    let elapsed = 0;
    while (elapsed < HAZARD_INTERVAL_MS * 4) {
      elapsed += TICK_MS;
      stepHazardTiles(room, [], elapsed, { ...onBand, kind: 'player' }, clock, tuning);
    }
    expect(clock.hazardStacks).toBe(4);
    // One tick on clean floor is enough: like Asphodel, the stack is not banked.
    stepHazardTiles(room, [], elapsed + TICK_MS, { x: 4 * 32 + 16, y: 4 * 32 + 16, kind: 'player', immune: false }, clock, tuning);
    expect(clock.hazardStacks).toBe(0);
    expect(clock.hazardMs).toBe(0);
  });

  it('weights enemies at x1.6, halves that for elites, and never touches a dash', () => {
    const first = (subject: Parameters<typeof stepHazardTiles>[3]) => burnSequence(subject, HAZARD_INTERVAL_MS)[0];
    expect(first({ ...onBand, kind: 'player' })).toBe(HAZARD_BASE);
    expect(first({ ...onBand, kind: 'enemy', enemyId: 'husk' })).toBe(Math.round(HAZARD_BASE * ENEMY_HAZARD_MUL));
    expect(first({ ...onBand, kind: 'enemy', enemyId: 'guardian' }))
      .toBe(Math.round(HAZARD_BASE * ENEMY_HAZARD_MUL * TERRAIN_ELITE_DAMAGE_SCALE));
    expect(burnSequence({ ...onBand, kind: 'player', immune: true }, HAZARD_INTERVAL_MS * 8)).toEqual([]);
    expect(burnSequence({ ...onBand, kind: 'enemy', enemyId: 'husk' }, HAZARD_INTERVAL_MS * 5))
      .toEqual([5, 10, 14, 19, 24]);
  });

  it('caps the ramp at the stack maximum', () => {
    const damages = burnSequence({ ...onBand, kind: 'player' }, HAZARD_INTERVAL_MS * 9);
    expect(Math.max(...damages)).toBe(HAZARD_BASE * HAZARD_STACK_MAX);
    expect(damages.slice(HAZARD_STACK_MAX)).toEqual(Array(9 - HAZARD_STACK_MAX).fill(HAZARD_BASE * HAZARD_STACK_MAX));
  });

  it('interpolates inside the clamped intensity band, with 0.5 exactly on the baseline', () => {
    expect(terrainTuning(0)).toMatchObject({ hazardIntervalMs: 600, hazardBase: 2, hazardStackMax: 4 });
    expect(terrainTuning(0.5)).toMatchObject({
      hazardIntervalMs: HAZARD_INTERVAL_MS, hazardBase: HAZARD_BASE, hazardStackMax: HAZARD_STACK_MAX,
    });
    expect(terrainTuning(1)).toMatchObject({ hazardIntervalMs: 350, hazardBase: 4, hazardStackMax: 6 });
    // Out of range and nonsense clamp rather than throw: the model supplies this number.
    expect(terrainTuning(-4)).toEqual(terrainTuning(0));
    expect(terrainTuning(9)).toEqual(terrainTuning(1));
    expect(terrainTuning(Number.NaN)).toEqual(terrainTuning(0.5));
  });
});

describe('hazard tiles in the simulation', () => {
  it('burns a standing player on the ramp, on the clock, from terrain:hazard', () => {
    const sim = expedition();
    while (playerTile(sim) < 5) tick(sim, { moveX: 1 });
    let previous = hp(sim);
    const burns: Array<{ tick: number; damage: number }> = [];
    for (let i = 0; i < Math.ceil((HAZARD_INTERVAL_MS * 4) / TICK_MS) + 4; i++) {
      const events = tick(sim);
      if (hp(sim) === previous) continue;
      expect(events.some((e) => e.type === 'player_damaged' && e.sourceEnemyId === TERRAIN_DAMAGE_SOURCE.hazard)).toBe(true);
      burns.push({ tick: sim.getTick(), damage: previous - hp(sim) });
      previous = hp(sim);
    }
    expect(burns.map((b) => b.damage)).toEqual([3, 6, 9, 12]);
    for (let i = 1; i < burns.length; i++) expect(burns[i]!.tick - burns[i - 1]!.tick).toBe(Math.round(HAZARD_INTERVAL_MS / TICK_MS));
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

  it('kills a husk that cannot leave the fire, credits nobody, and pays a reduced reward', () => {
    const sim = expedition();
    expect(enemyHp(sim)).toBe(30);
    const defeats: GameEvent[] = [];
    const clears: GameEvent[] = [];
    let ticks = 0;
    while (ticks < 400 && clears.length === 0) {
      const events = tick(sim);
      defeats.push(...events.filter((e) => e.type === 'enemy_defeated'));
      clears.push(...events.filter((e) => e.type === 'room_cleared'));
      ticks++;
    }
    // 30 hp at 5, 10, 14, 19: the fourth burn kills, 4 x 450 ms after it started standing there.
    expect(ticks).toBe(Math.round((HAZARD_INTERVAL_MS * 4) / TICK_MS));
    expect(defeats).toHaveLength(1);
    // The room did it, so byPlayerId is null: no fabricated kill credit reaches the memory wall.
    expect(defeats[0]).toMatchObject({ type: 'enemy_defeated', byPlayerId: null });
    expect(sim.getSnapshot().players[0]!.ultCharge).toBe(0);
    expect(clears[0]).toMatchObject({ type: 'room_cleared', reward: Math.round(3 * ENV_KILL_CREDIT) });
  });

  it('ignores world laws that scale the CREW\'s damage: first_light does not triple a burn tick', () => {
    const lawful = expedition(undefined, { laws: [{ lawId: 'first_light', name: 'First Light', description: 'The first cut is the deep one.', intensity: 1 }] });
    const plain = expedition();
    for (let i = 0; i < Math.round(HAZARD_INTERVAL_MS / TICK_MS) + 2; i++) { tick(lawful); tick(plain); }
    expect(enemyHp(plain)).toBeLessThan(30);
    expect(enemyHp(lawful)).toBe(enemyHp(plain));
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
