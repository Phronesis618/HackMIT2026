/**
 * T2 — 'o' pits. Solid for walking, open for everything else: bolts cross them, a dash clears
 * a two-tile gap, and anything displaced into one is gone. Players never die to a pit.
 */
import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  PreparedWorldSchema, RoomSpecSchema, WorldFixtureSchema,
  type GameEvent, type PlayerIntent, type RoomSpec,
} from '../../src/shared/contracts';
import { PLAYER_MAX_HP, tileToWorld } from '../../src/shared/conventions';
import { ENV_KILL_CREDIT, PIT_FALL_DAMAGE, TERRAIN_DAMAGE_SOURCE } from '../../src/shared/terrain';
import { ULT_CHARGE_PER_KILL } from '../../src/shared/registry';
import { buildSolidGrid, isSolidAt } from '../../src/sim/collision';
import { clearPath } from '../../src/sim/combat';
import { createSimulation, type Simulation } from '../../src/sim';

// The fixture's own world laws are stripped: these cases measure the base rules, and
// vantage-spire now carries laws the engine really applies (tests/sim/laws.test.ts covers those).
const { laws: _laws, look: _look, custodian: _custodian, ...bareRecipe } = WorldFixtureSchema.parse(fixtureJson).recipe;
const fixture = { ...WorldFixtureSchema.parse(fixtureJson), recipe: bareRecipe };

function arena(paint: (tiles: string[][]) => void, index = 0, isFinal = false, encounters: unknown[] = []): RoomSpec {
  const tiles: string[][] = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 20 }, (_, x) => (x === 0 || x === 19 || y === 0 || y === 10 ? '#' : '.')));
  tiles[5]![2] = 'P';
  if (isFinal) tiles[8]![17] = 'A';
  else tiles[1]![18] = 'X';
  paint(tiles);
  return RoomSpecSchema.parse({
    id: `pit-arena-${index}`, index, name: 'Pit arena', description: '', width: 20, height: 11,
    tiles: tiles.map((row) => row.join('')), props: [], attributions: [], relics: [], encounters,
    exits: isFinal ? [] : [{ x: 18, y: 1, toRoomIndex: 1, direction: 'east' }],
    isFinal,
  });
}

function expedition(room: RoomSpec, classId: 'bastion' | 'weaver' = 'bastion'): Simulation {
  const sim = createSimulation();
  sim.addPlayer({ id: 'tester', displayName: 'Tester', classId });
  sim.unlockAbility('tester'); // shockwave is the knockback under test
  sim.setWorld(PreparedWorldSchema.parse({
    worldId: 'pit-test', createdAt: 0, recipe: fixture.recipe, art: fixture.art,
    rooms: [room, arena(() => {}, 1), arena(() => {}, 2, true)], plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Pits', lines: [] },
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

const px = (sim: Simulation) => sim.getSnapshot().players[0]!.x;
const hp = (sim: Simulation) => sim.getSnapshot().players[0]!.hp;
/** A two-tile gap at cols 6-7 on the walking line. */
const twoTileGap = (tiles: string[][]) => { tiles[5]![6] = 'o'; tiles[5]![7] = 'o'; };

describe('pits', () => {
  it('blocks walking but not bolts, and the two grid layers say so', () => {
    const room = arena(twoTileGap);
    const grid = buildSolidGrid(room);
    expect(isSolidAt(grid, 6, 5)).toBe(true);
    expect(isSolidAt(grid, 6, 5, 'shots')).toBe(false);
    expect(isSolidAt(grid, 6, 5, 'dash')).toBe(false);
    expect(clearPath(grid, tileToWorld(4, 5), tileToWorld(10, 5))).toBe(true);

    const sim = expedition(room);
    for (let i = 0; i < 120; i++) tick(sim, { moveX: 1 });
    expect(px(sim)).toBeLessThan(6 * 32);
    expect(hp(sim)).toBe(PLAYER_MAX_HP);
  });

  it('lets a dash cross a two-tile gap for free', () => {
    const sim = expedition(arena(twoTileGap));
    for (let i = 0; i < 40; i++) tick(sim, { moveX: 1 });
    const before = px(sim);
    tick(sim, { moveX: 1, dash: true });
    for (let i = 0; i < 12; i++) tick(sim, { moveX: 1 });
    expect(px(sim)).toBeGreaterThan(8 * 32);
    expect(px(sim)).toBeGreaterThan(before);
    expect(hp(sim)).toBe(PLAYER_MAX_HP);
  });

  it('relocates a player whose dash ends over a pit, for 12, never below 1 HP', () => {
    // A four-tile gap: 96 px of dash cannot clear it, so the dash ends over the hole.
    const sim = expedition(arena((tiles) => { for (const x of [6, 7, 8, 9]) tiles[5]![x] = 'o'; }));
    for (let i = 0; i < 40; i++) tick(sim, { moveX: 1 });
    let fell: GameEvent | undefined;
    for (let i = 0; i < 40 && !fell; i++) {
      fell = tick(sim, { moveX: 1, dash: i === 0 })
        .find((e) => e.type === 'player_damaged' && e.sourceEnemyId === TERRAIN_DAMAGE_SOURCE.pit);
    }
    expect(fell).toMatchObject({ amount: PIT_FALL_DAMAGE });
    expect(hp(sim)).toBe(PLAYER_MAX_HP - PIT_FALL_DAMAGE);
    const landing = sim.getSnapshot().players[0]!;
    expect(sim.getRoom().tiles[Math.floor(landing.y / 32)]![Math.floor(landing.x / 32)]).not.toBe('o');
    expect(landing.invulnerableMs).toBeGreaterThan(0);
  });

  it('never lets a pit take a player below 1 HP, however many times they fall in', () => {
    const sim = expedition(arena((tiles) => { for (const x of [6, 7, 8, 9]) tiles[5]![x] = 'o'; }));
    for (let i = 0; i < 1200; i++) tick(sim, { moveX: 1, dash: i % 60 === 0 });
    expect(hp(sim)).toBeGreaterThanOrEqual(1);
    expect(sim.getSnapshot().players[0]!.state).not.toBe('down');
  });

  it('deletes a husk knocked in, credits the displacer at half, and drops its remains on solid ground', () => {
    // The husk walks at the player from the east; the pit sits between them.
    const sim = expedition(arena(
      (tiles) => { for (const x of [7, 8]) for (const y of [4, 5, 6]) tiles[y]![x] = 'o'; },
      0, false, [{ id: 'victim', enemyId: 'husk', x: 5, y: 5, count: 1 }],
    ), 'bastion');
    // Let the husk close in, then shockwave it eastward into the hole.
    let defeat: GameEvent | undefined;
    for (let i = 0; i < 240 && !defeat; i++) {
      const events = tick(sim, { ability: i > 60 && i % 20 === 0 ? 'e' : null, aimX: 999, aimY: 5 * 32 + 16 });
      defeat = events.find((e) => e.type === 'enemy_defeated');
    }
    expect(defeat).toMatchObject({ type: 'enemy_defeated', byPlayerId: 'tester' });
    const enemy = sim.getSnapshot().enemies[0]!;
    expect(enemy.hp).toBe(0);
    // Lore is never lost down a hole: remains land on ground you can stand on.
    for (const node of sim.getSnapshot().loreNodes ?? []) {
      expect(sim.getRoom().tiles[Math.floor(node.y / 32)]![Math.floor(node.x / 32)]).not.toBe('o');
    }
    // Half credit for an environmental kill, not the full per-kill bonus.
    expect(sim.getSnapshot().players[0]!.ultCharge).toBeGreaterThan(0);
    expect(ULT_CHARGE_PER_KILL * ENV_KILL_CREDIT).toBe(7.5);
  });

  it('is deterministic across two simulations fed the same intents', () => {
    const paint = (tiles: string[][]) => { for (const x of [6, 7]) for (const y of [4, 5]) tiles[y]![x] = 'o'; };
    const a = expedition(arena(paint, 0, false, [{ id: 'v', enemyId: 'husk', x: 12, y: 5, count: 1 }]));
    const b = expedition(arena(paint, 0, false, [{ id: 'v', enemyId: 'husk', x: 12, y: 5, count: 1 }]));
    for (let i = 0; i < 300; i++) {
      const input = { moveX: i % 5 === 0 ? 1 : 0, dash: i % 47 === 0, ability: i % 31 === 0 ? ('e' as const) : null };
      expect(tick(a, input)).toEqual(tick(b, input));
      expect(a.getSnapshot()).toEqual(b.getSnapshot());
    }
  });
});
