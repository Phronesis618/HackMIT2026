import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameSnapshotSchema, PreparedWorldSchema, WorldFixtureSchema, type PlayerIntent, type PreparedWorld } from '../../src/shared/contracts';
import { DASH_COOLDOWN_MS, PLAYER_SPEED, TICK_MS, TILE_SIZE, tileToWorld } from '../../src/shared/conventions';
import { createSimulation } from '../../src/sim';
import { headquartersRoom } from '../../src/sim/headquarters';

const localPlayer = { id: 'test-player-1', displayName: 'Tester', classId: 'bastion' as const };

function intent(partial: Partial<PlayerIntent> = {}): PlayerIntent {
  return { playerId: localPlayer.id, seq: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, ...partial };
}

function loadFixtureWorld(): PreparedWorld {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/worlds/vantage-spire.json'), 'utf8'));
  const fixture = WorldFixtureSchema.parse(raw);
  return PreparedWorldSchema.parse({
    worldId: 'test-world',
    createdAt: 0,
    recipe: fixture.recipe,
    art: fixture.art,
    rooms: fixture.rooms,
    plannedRoomCount: fixture.plannedRoomCount,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', fixtureId: fixture.fixtureId, generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'test', lines: [] },
  });
}

describe('simulation basics', () => {
  it('starts in headquarters with the player on the spawn tile', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    const snap = sim.getSnapshot();
    expect(snap.phase).toBe('headquarters');
    expect(snap.roomId).toBe(headquartersRoom.id);
    const spawnRow = headquartersRoom.tiles.findIndex((r) => r.includes('P'));
    const spawnCol = headquartersRoom.tiles[spawnRow]!.indexOf('P');
    expect(snap.players[0]).toMatchObject(tileToWorld(spawnCol, spawnRow));
    expect(GameSnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('moves the player right at PLAYER_SPEED and reports moving state', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    const before = sim.getSnapshot().players[0]!;
    const ticks = 30;
    for (let i = 0; i < ticks; i++) {
      sim.applyIntent(intent({ moveX: 1, aimX: before.x + 100, aimY: before.y }));
      sim.step();
    }
    const after = sim.getSnapshot().players[0]!;
    const expected = PLAYER_SPEED * (TICK_MS / 1000) * ticks;
    expect(after.x - before.x).toBeCloseTo(expected, 0);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.facing).toBeCloseTo(0, 5);
  });

  it('is blocked by walls and blocking props', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    // Row 5 has a pillar prop at column 6: walking left from spawn (10,5) stops at it.
    for (let i = 0; i < 300; i++) {
      sim.applyIntent(intent({ moveX: -1 }));
      sim.step();
    }
    const blockedByPillar = sim.getSnapshot().players[0]!;
    expect(blockedByPillar.x).toBeGreaterThan(TILE_SIZE * 7);
    expect(blockedByPillar.x).toBeLessThan(TILE_SIZE * 8);

    // Go up to row 1 (no props), then left: the outer wall at column 0 stops us.
    for (let i = 0; i < 300; i++) {
      sim.applyIntent(intent({ moveY: -1 }));
      sim.step();
    }
    for (let i = 0; i < 600; i++) {
      sim.applyIntent(intent({ moveX: -1 }));
      sim.step();
    }
    const p = sim.getSnapshot().players[0]!;
    expect(p.x).toBeGreaterThan(TILE_SIZE);
    expect(p.x).toBeLessThan(TILE_SIZE * 2);
    expect(p.y).toBeGreaterThan(TILE_SIZE);
    expect(p.y).toBeLessThan(TILE_SIZE * 2);
  });

  it('dashes once, emits player_dashed and respects the cooldown', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    sim.applyIntent(intent({ moveX: 1, dash: true }));
    const events = sim.step();
    expect(events.map((e) => e.type)).toContain('player_dashed');
    expect(sim.getSnapshot().players[0]!.state).toBe('dashing');

    // A second dash during cooldown does nothing.
    sim.applyIntent(intent({ moveX: 1, dash: true }));
    expect(sim.step().some((e) => e.type === 'player_dashed')).toBe(false);

    // After the cooldown a dash works again.
    for (let i = 0; i < Math.ceil(DASH_COOLDOWN_MS / TICK_MS) + 1; i++) sim.step();
    sim.applyIntent(intent({ moveX: 1, dash: true }));
    expect(sim.step().some((e) => e.type === 'player_dashed')).toBe(true);
  });

  it('emits player_attacked with no hits yet (hit resolution is a later slice)', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    sim.applyIntent(intent({ attack: true }));
    const events = sim.step();
    const attack = events.find((e) => e.type === 'player_attacked');
    expect(attack).toBeDefined();
    if (attack?.type === 'player_attacked') expect(attack.hitEnemyIds).toEqual([]);
  });

  it('assigns deterministic tick-scoped event ids', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    sim.applyIntent(intent({ dash: true }));
    const events = sim.step();
    expect(events[0]!.id).toBe(`${sim.getTick()}:0`);
  });
});

describe('rooms and exits', () => {
  it('enters room 0 of a world, spawns enemies, and emits room_entered', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    const world = loadFixtureWorld();
    sim.setWorld(world);
    const events = sim.enterRoom(0);
    expect(events[0]).toMatchObject({ type: 'room_entered', roomIndex: 0, roomId: world.rooms[0]!.id, playerIds: [localPlayer.id] });
    const snap = sim.getSnapshot();
    expect(snap.phase).toBe('expedition');
    expect(snap.enemies.length).toBe(world.rooms[0]!.encounters.reduce((n, e) => n + e.count, 0));
    expect(GameSnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('exposes a dormant anchor in the final room', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    const world = loadFixtureWorld();
    sim.setWorld(world);
    sim.enterRoom(world.rooms.length - 1);
    expect(sim.getSnapshot().anchor).toMatchObject({ state: 'dormant', progress: 0 });
  });

  it('emits exit_reached once when the player walks onto the portal in headquarters', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    const exit = headquartersRoom.exits[0]!;
    const target = tileToWorld(exit.x, exit.y);
    let reached = 0;
    for (let i = 0; i < 900; i++) {
      const me = sim.getSnapshot().players[0]!;
      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const len = Math.hypot(dx, dy) || 1;
      sim.applyIntent(intent({ moveX: dx / len, moveY: dy / len, aimX: target.x, aimY: target.y }));
      for (const e of sim.step()) if (e.type === 'exit_reached') reached++;
      if (reached > 0 && i > 200) break;
    }
    expect(reached).toBe(1);
  });

  it('refuses to enter an uncommitted room', () => {
    const sim = createSimulation();
    sim.addPlayer(localPlayer);
    const world = loadFixtureWorld();
    sim.setWorld({ ...world, rooms: [world.rooms[0]!] });
    expect(() => sim.enterRoom(1)).toThrow(/not committed/);
  });
});
