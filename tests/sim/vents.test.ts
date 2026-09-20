/**
 * T3 — '^' timed vents. The cycle is a pure function of sim time and tile coordinates: no
 * snapshot state, nothing to desync, and a third of any field is always safe to stand on.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { PLAYER_MAX_HP, TICK_MS } from '../../src/shared/conventions';
import {
  TERRAIN_DAMAGE_SOURCE, TERRAIN_ELITE_DAMAGE_SCALE, VENT_CYCLE_MS, VENT_DAMAGE, VENT_FIRE_MS,
  VENT_GROUPS, VENT_TELL_MS, terrainTuning, ventChargeProgress, ventPhaseOffset, ventState,
  ventWindowId,
} from '../../src/shared/terrain';
import { createHazardClock, stepHazardTiles } from '../../src/sim/hazards';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);

/** A 3x3 vent field at cols 5-7, rows 4-6, with the spawn two tiles west of it. */
function ventArena(index = 0, isFinal = false, encounters: unknown[] = []): RoomSpec {
  const tiles: string[][] = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 18 }, (_, x) => (x === 0 || x === 17 || y === 0 || y === 10 ? '#' : '.')));
  tiles[5]![2] = 'P';
  for (let y = 4; y <= 6; y++) for (let x = 5; x <= 7; x++) tiles[y]![x] = '^';
  if (isFinal) tiles[8]![15] = 'A';
  else tiles[1]![16] = 'X';
  return RoomSpecSchema.parse({
    id: `vent-arena-${index}`, index, name: 'Vent arena', description: '', width: 18, height: 11,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [], relics: [], encounters,
    exits: isFinal ? [] : [{ x: 16, y: 1, toRoomIndex: 1, direction: 'east' }],
    isFinal,
  });
}

function expedition(room: RoomSpec): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'vent-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [room, ventArena(1), ventArena(2, true)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Vents', lines: [] },
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

describe('vents, as a pure function of time', () => {
  it('gives the same state for the same (timeMs, col, row) on every machine', () => {
    for (let t = 0; t < VENT_CYCLE_MS * 3; t += 37) {
      for (const [col, row] of [[5, 4], [6, 5], [7, 6], [0, 0], [13, 9]] as const) {
        expect(ventState(t, col, row)).toBe(ventState(t, col, row));
        expect(ventWindowId(t, col, row)).toBe(ventWindowId(t, col, row));
      }
    }
    // Three groups, evenly spaced across the cycle.
    expect(new Set([0, 1, 2].map((i) => ventPhaseOffset(i, 0)))).toEqual(new Set([0, 1000, 2000]));
  });

  it('never fires every group at once: a third of any field is always idle', () => {
    const field: Array<[number, number]> = [];
    for (let row = 4; row <= 6; row++) for (let col = 5; col <= 7; col++) field.push([col, row]);
    for (let t = 0; t < VENT_CYCLE_MS * 2; t += 10) {
      const states = field.map(([col, row]) => ventState(t, col, row));
      expect(states.filter((state) => state === 'idle').length).toBeGreaterThanOrEqual(3);
      expect(states.filter((state) => state === 'firing').length).toBeLessThanOrEqual(3);
    }
  });

  it('spends exactly the specified time charging and firing each cycle', () => {
    let charging = 0;
    let firing = 0;
    for (let t = 0; t < VENT_CYCLE_MS; t += 1) {
      const state = ventState(t, 5, 4);
      if (state === 'charging') charging++;
      if (state === 'firing') firing++;
    }
    expect(charging).toBe(VENT_TELL_MS);
    expect(firing).toBe(VENT_FIRE_MS);
    // The tell runs 0 -> 1 across the charge, so the renderer can ramp anything it likes.
    const chargeStart = VENT_CYCLE_MS - VENT_TELL_MS - VENT_FIRE_MS - ventPhaseOffset(5, 4);
    expect(ventChargeProgress(chargeStart + 1, 5, 4)).toBeLessThan(0.05);
    expect(ventChargeProgress(chargeStart + VENT_TELL_MS - 1, 5, 4)).toBeGreaterThan(0.95);
  });

  it('lands once per firing window, and not at all through a dash', () => {
    const room = ventArena();
    const tuning = terrainTuning();
    const on = { x: 5 * 32 + 16, y: 4 * 32 + 16, kind: 'player' as const, immune: false };
    const clock = createHazardClock();
    const hits: number[] = [];
    for (let t = TICK_MS; t <= VENT_CYCLE_MS * 3; t += TICK_MS) {
      for (const hit of stepHazardTiles(room, [], t, on, clock, tuning)) hits.push(hit.damage);
    }
    expect(hits).toEqual([VENT_DAMAGE, VENT_DAMAGE, VENT_DAMAGE]);

    const dashing = createHazardClock();
    const dashed: number[] = [];
    for (let t = TICK_MS; t <= VENT_CYCLE_MS * 3; t += TICK_MS) {
      for (const hit of stepHazardTiles(room, [], t, { ...on, immune: true }, dashing, tuning)) dashed.push(hit.damage);
    }
    expect(dashed).toEqual([]);
  });

  it('hits enemies for the same number, and elites for half', () => {
    const room = ventArena();
    const tuning = terrainTuning();
    const at = { x: 5 * 32 + 16, y: 4 * 32 + 16, immune: false };
    const first = (subject: Parameters<typeof stepHazardTiles>[3]) => {
      const clock = createHazardClock();
      for (let t = TICK_MS; t <= VENT_CYCLE_MS; t += TICK_MS) {
        const hits = stepHazardTiles(room, [], t, subject, clock, tuning);
        if (hits.length > 0) return hits[0]!.damage;
      }
      return 0;
    };
    expect(first({ ...at, kind: 'enemy', enemyId: 'husk' })).toBe(VENT_DAMAGE);
    expect(first({ ...at, kind: 'enemy', enemyId: 'guardian' })).toBe(VENT_DAMAGE * TERRAIN_ELITE_DAMAGE_SCALE);
  });
});

describe('vents in the simulation', () => {
  it('costs a player standing in the field three hits in nine seconds', () => {
    const sim = expedition(ventArena());
    while (sim.getSnapshot().players[0]!.x < 5 * 32 + 8) tick(sim, { moveX: 1 });
    const start = sim.getSnapshot().players[0]!.hp;
    const sources: string[] = [];
    for (let i = 0; i < Math.round((VENT_CYCLE_MS * 3) / TICK_MS); i++) {
      for (const event of tick(sim)) {
        if (event.type === 'player_damaged') sources.push(event.sourceEnemyId ?? '');
      }
    }
    expect(sources.every((source) => source === TERRAIN_DAMAGE_SOURCE.vent)).toBe(true);
    expect(sources.length).toBeGreaterThanOrEqual(2);
    expect(sources.length).toBeLessThanOrEqual(4);
    expect(start - sim.getSnapshot().players[0]!.hp).toBe(sources.length * VENT_DAMAGE);
  });

  it('takes more than two cycles to kill a stationary husk, so the crew gets to watch it work', () => {
    const sim = expedition(ventArena(0, false, [{ id: 'sitter', enemyId: 'husk', x: 6, y: 5, count: 1 }]));
    const twoCycles = Math.round((VENT_CYCLE_MS * 2) / TICK_MS);
    for (let i = 0; i < twoCycles; i++) tick(sim);
    expect(sim.getSnapshot().enemies[0]!.hp).toBeGreaterThan(0);
  });

  it('is deterministic and carries no vent state in the snapshot', () => {
    const a = expedition(ventArena());
    const b = expedition(ventArena());
    for (let i = 0; i < 400; i++) {
      const input = { moveX: i < 60 ? 1 : i % 9 === 0 ? -1 : 0, dash: i === 200 };
      expect(tick(a, input)).toEqual(tick(b, input));
      expect(a.getSnapshot()).toEqual(b.getSnapshot());
    }
    expect(a.getSnapshot().terrain).toEqual({ brokenWalls: [], wallDamage: {} });
    expect(a.getSnapshot().players[0]!.hp).toBeLessThan(PLAYER_MAX_HP);
    expect(VENT_GROUPS).toBe(3);
  });
});
