/**
 * T1 — '*' volatile canisters. Exact numbers from docs/design/TILES.md: 420 ms fuse, 76 px
 * radius, 48 to enemies and 26 to the crew with linear falloff to 35% at the rim, 40 to a
 * bulkhead, a 140 ms chain fuse and a depth cap of 6.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameSnapshotSchema, PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { TICK_MS, tileToWorld } from '../../src/shared/conventions';
import {
  CANISTER_CHAIN_FUSE_MS, CANISTER_ENEMY_DAMAGE, CANISTER_FUSE_MS, CANISTER_MAX_CHAIN_DEPTH,
  CANISTER_PLAYER_DAMAGE, CANISTER_RADIUS, CANISTER_RIM_FALLOFF, terrainTileAt,
} from '../../src/shared/terrain';
import { buildSolidGrid, isSolidAt } from '../../src/sim/collision';
import {
  applyCanisterBlastToTerrain, armCanister, blastFalloff, createTerrainState, stepCanisterFuses,
} from '../../src/sim/terrain';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);

/** 18x11 arena; callers paint the tiles they need on an otherwise clean floor. */
function arena(paint: (tiles: string[][]) => void, index = 0, isFinal = false, encounters: unknown[] = []): RoomSpec {
  const tiles: string[][] = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 18 }, (_, x) => (x === 0 || x === 17 || y === 0 || y === 10 ? '#' : '.')));
  tiles[5]![2] = 'P';
  if (isFinal) tiles[8]![15] = 'A';
  else tiles[1]![16] = 'X';
  paint(tiles);
  return RoomSpecSchema.parse({
    id: `canister-arena-${index}`, index, name: 'Canister arena', description: '', width: 18, height: 11,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [], relics: [], encounters,
    exits: isFinal ? [] : [{ x: 16, y: 1, toRoomIndex: 1, direction: 'east' }],
    isFinal,
  });
}

function expedition(room: RoomSpec): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId: 'bastion' });
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'canister-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [room, arena(() => {}, 1), arena(() => {}, 2, true)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Canisters', lines: [] },
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

const armedKeys = (sim: Simulation) => Object.keys(sim.getSnapshot().terrain?.canisters ?? {});

/**
 * Walk east into the canister and hit it until its fuse is lit, then stop attacking and let the
 * fuse run. Stopping matters: a test about the blast must not be decided by the player's sword.
 */
function detonate(sim: Simulation, settleTicks = 90): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < 60 && armedKeys(sim).length === 0; i++) events.push(...tick(sim, { moveX: 1, attack: true }));
  for (let i = 0; i < settleTicks; i++) events.push(...tick(sim));
  return events;
}

describe('canisters, as pure rules', () => {
  it('falls off linearly from the centre to 35% at the rim, and nothing beyond it', () => {
    expect(blastFalloff(0)).toBe(1);
    expect(blastFalloff(CANISTER_RADIUS / 2)).toBeCloseTo((1 + CANISTER_RIM_FALLOFF) / 2, 6);
    expect(blastFalloff(CANISTER_RADIUS)).toBe(CANISTER_RIM_FALLOFF);
    expect(blastFalloff(CANISTER_RADIUS + 0.001)).toBe(0);
    expect(blastFalloff(-5)).toBe(1);
  });

  it('arms once, keeps the shorter fuse and detonates deterministically in key order', () => {
    const room = arena((tiles) => { tiles[5]![6] = '*'; tiles[5]![9] = '*'; });
    let state = createTerrainState();
    state = armCanister(room, state, 6, 5, CANISTER_FUSE_MS, 0).state;
    state = armCanister(room, state, 9, 5, CANISTER_CHAIN_FUSE_MS, 1).state;
    // A second, longer fuse never resets a canister that is already counting down faster.
    expect(armCanister(room, state, 9, 5, CANISTER_FUSE_MS, 0).state).toBe(state);
    expect(armCanister(room, state, 7, 5, CANISTER_FUSE_MS, 0).armed).toEqual([]);

    let elapsed = 0;
    const order: string[] = [];
    while (Object.keys(state.canisters ?? {}).length > 0 && elapsed < 2000) {
      const stepped = stepCanisterFuses(state, TICK_MS);
      state = stepped.state;
      for (const blast of stepped.blasts) order.push(`${blast.col},${blast.row}@${Math.round(elapsed)}`);
      elapsed += TICK_MS;
    }
    expect(order).toEqual(['9,5@133', '6,5@417']);
  });

  it('caps the chain so a pathological cluster cannot detonate forever', () => {
    const room = arena((tiles) => { for (let x = 4; x < 14; x++) tiles[5]![x] = '*'; });
    let state = createTerrainState();
    const deep = { col: 4, row: 5, ...tileToWorld(4, 5), depth: CANISTER_MAX_CHAIN_DEPTH };
    state = applyCanisterBlastToTerrain(room, state, deep).state;
    expect(Object.keys(state.canisters ?? {})).toEqual([]);
    const shallow = applyCanisterBlastToTerrain(room, createTerrainState(),
      { col: 4, row: 5, ...tileToWorld(4, 5), depth: 0 });
    expect(Object.keys(shallow.state.canisters ?? {}).length).toBeGreaterThan(0);
  });
});

describe('canisters in the simulation', () => {
  it('is solid until it blows, then leaves rubble the crew can walk over', () => {
    const sim = expedition(arena((tiles) => { tiles[5]![4] = '*'; }));
    const room = sim.getRoom();
    expect(isSolidAt(buildSolidGrid(room), 4, 5)).toBe(true);
    detonate(sim);
    const terrain = sim.getSnapshot().terrain!;
    expect(terrain.brokenWalls).toEqual(['4,5']);
    expect(terrainTileAt(room, 4, 5, terrain.brokenWalls)).toBe(':');
    expect(isSolidAt(buildSolidGrid(room, terrain.brokenWalls), 4, 5)).toBe(false);
    expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);
    for (let i = 0; i < 60; i++) tick(sim, { moveX: 1 });
    expect(sim.getSnapshot().players[0]!.x).toBeGreaterThan(tileToWorld(4, 5).x);
  });

  it('shows the fuse in the snapshot for exactly as long as the spec says', () => {
    const sim = expedition(arena((tiles) => { tiles[5]![4] = '*'; }));
    let armedAt = -1;
    let blewAt = -1;
    for (let i = 0; i < 140 && blewAt < 0; i++) {
      const events = tick(sim, armedAt < 0 ? { moveX: 1, attack: true } : {});
      if (armedAt < 0 && sim.getSnapshot().terrain?.canisters?.['4,5']) armedAt = sim.getTick();
      if (events.some((e) => e.type === 'terrain_detonated')) blewAt = sim.getTick();
    }
    expect(armedAt).toBeGreaterThan(0);
    // Within one tick: the fuse is lit and stepped in the same tick it is armed.
    expect(Math.abs((blewAt - armedAt) * TICK_MS - CANISTER_FUSE_MS)).toBeLessThanOrEqual(TICK_MS);
    expect(sim.getSnapshot().terrain?.canisters).toBeUndefined();
  });

  it('destroys an adjacent bulkhead in one blast', () => {
    const sim = expedition(arena((tiles) => { tiles[5]![4] = '*'; tiles[4]![4] = 'B'; tiles[6]![4] = 'B'; }));
    detonate(sim);
    expect(sim.getSnapshot().terrain!.brokenWalls.sort()).toEqual(['4,4', '4,5', '4,6']);
  });

  it('hurts the crew for 26 at the centre, and not at all through a wall', () => {
    // The player attacks east into a canister one tile away: well inside the 76 px radius.
    const exposed = expedition(arena((tiles) => { tiles[5]![4] = '*'; }));
    detonate(exposed);
    const hurt = 100 - exposed.getSnapshot().players[0]!.hp;
    expect(hurt).toBeGreaterThan(0);
    expect(hurt).toBeLessThanOrEqual(CANISTER_PLAYER_DAMAGE);

    // Same geometry with a '#' between the player and the blast: the wall shields completely.
    const shielded = expedition(arena((tiles) => { tiles[5]![4] = '#'; tiles[5]![5] = '*'; tiles[4]![5] = '*'; }));
    for (let i = 0; i < 60; i++) tick(shielded, { moveX: 1, attack: true });
    for (let i = 0; i < 90; i++) tick(shielded);
    expect(shielded.getSnapshot().players[0]!.hp).toBe(100);
  });

  it('kills a husk beside it, credits nobody, and reports the blast once', () => {
    // The husk is penned in at (6,5) with the canister as its west wall: it cannot walk out of
    // the radius and the player cannot reach it, so only the blast can kill it.
    const sim = expedition(arena(
      (tiles) => {
        tiles[5]![5] = '*';
        for (const [x, y] of [[6, 4], [6, 6], [7, 4], [7, 5], [7, 6]] as const) tiles[y]![x] = '#';
      },
      0, false,
      [{ id: 'victim', enemyId: 'husk', x: 6, y: 5, count: 1 }],
    ));
    expect(sim.getSnapshot().enemies[0]!.hp).toBe(30);
    const events = detonate(sim);
    const blasts = events.filter((e) => e.type === 'terrain_detonated');
    expect(blasts).toHaveLength(1);
    expect(blasts[0]).toMatchObject({ radius: CANISTER_RADIUS, hitEnemyIds: ['victim-0'] });
    const defeat = events.find((e) => e.type === 'enemy_defeated');
    expect(defeat).toMatchObject({ byPlayerId: null });
    expect(CANISTER_ENEMY_DAMAGE).toBeGreaterThan(30);
  });

  it('chains three in a line, in order, within 700 ms', () => {
    const sim = expedition(arena((tiles) => { tiles[5]![4] = '*'; tiles[5]![6] = '*'; tiles[5]![8] = '*'; }));
    const blasts: Array<{ tick: number; x: number }> = [];
    for (let i = 0; i < 200; i++) {
      const armed = armedKeys(sim).length > 0 || blasts.length > 0;
      for (const event of tick(sim, armed ? {} : { moveX: 1, attack: true })) {
        if (event.type === 'terrain_detonated') blasts.push({ tick: sim.getTick(), x: event.x });
      }
    }
    expect(blasts.map((b) => b.x)).toEqual([4, 6, 8].map((col) => tileToWorld(col, 5).x));
    expect((blasts[2]!.tick - blasts[0]!.tick) * TICK_MS).toBeLessThanOrEqual(700);
    expect(sim.getSnapshot().terrain!.brokenWalls.sort()).toEqual(['4,5', '6,5', '8,5']);
  });

  it('is deterministic: two simulations fed the same intents chain identically', () => {
    const paint = (tiles: string[][]) => { tiles[5]![4] = '*'; tiles[5]![6] = '*'; tiles[4]![7] = '*'; tiles[4]![4] = 'B'; };
    const a = expedition(arena(paint));
    const b = expedition(arena(paint));
    for (let i = 0; i < 200; i++) {
      const input = { attack: i < 40, moveX: i < 40 || i > 140 ? 1 : 0 };
      expect(tick(a, input)).toEqual(tick(b, input));
      expect(a.getSnapshot()).toEqual(b.getSnapshot());
    }
    expect(a.getSnapshot().terrain!.brokenWalls.length).toBeGreaterThanOrEqual(3);
  });
});
