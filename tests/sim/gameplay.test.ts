import { describe, expect, it } from 'vitest';
import fixtureJson from '../../fixtures/worlds/vantage-spire.json';
import {
  GameEventSchema, GameSnapshotSchema, PlayerIntentSchema, PreparedWorldSchema, RoomSpecSchema,
  WorldFixtureSchema, type GameEvent, type PlayerIntent, type RoomEncounter, type RoomSpec,
} from '../../src/shared/contracts';
import {
  ABILITY_UNLOCK_COST, ANCHOR_HOLD_MS, LORE_READ_MS, REVIVE_DURATION_MS, REVIVE_HP,
  ROOM_CLEAR_REWARD, TICK_MS, tileToWorld,
} from '../../src/shared/conventions';
import { CLASS_ABILITIES, CLASS_IDS, ENEMY_IDS, type ClassId, type EnemyId } from '../../src/shared/registry';
import { createSimulation, type Simulation } from '../../src/sim';

const fixture = WorldFixtureSchema.parse(fixtureJson);
const playerId = 'a-player';

function encounter(enemyId: EnemyId = 'husk', x = 6, y = 7, id = 'enemy'): RoomEncounter {
  return { id, enemyId, x, y, count: 1 };
}

function arena(index: number, encounters: RoomEncounter[] = [], walls: Array<[number, number]> = []): RoomSpec {
  const tiles: string[][] = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 26 }, (_, x) => x === 0 || x === 25 || y === 0 || y === 15 ? '#' : '.'));
  tiles[7]![5] = 'P';
  tiles[7]![24] = 'X';
  if (index === 2) tiles[7]![6] = 'A';
  for (const [x, y] of walls) tiles[y]![x] = '#';
  return RoomSpecSchema.parse({
    id: `arena-${index}`, index, name: `Arena ${index}`, description: '', width: 26, height: 16,
    tiles: tiles.map((row) => row.join('')), encounters, props: [], attributions: [],
    exits: [{ x: 24, y: 7, toRoomIndex: index === 0 ? 1 : index === 1 ? 2 : 1, direction: 'east' }],
    isFinal: index === 2,
  });
}

function world(rooms: RoomSpec[]) {
  return PreparedWorldSchema.parse({
    worldId: 'gameplay-world', createdAt: 0, recipe: fixture.recipe, art: fixture.art, rooms,
    plannedRoomCount: 3,
    provenance: { source: 'fixture', label: 'TEST FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { worldTitle: fixture.recipe.title, source: 'fixture', headline: 'Test arena', lines: [] },
  });
}

function setup(classId: ClassId = 'bastion', encounters = [encounter()], walls: Array<[number, number]> = []) {
  const sim = createSimulation();
  sim.addPlayer({ id: playerId, displayName: 'Tester', classId });
  sim.setWorld(world([arena(0, encounters, walls), arena(1), arena(2, [encounter('guardian', 10)])]));
  sim.enterRoom(0);
  return sim;
}

function me(sim: Simulation, id = playerId) {
  return sim.getSnapshot().players.find((p) => p.id === id)!;
}

function input(sim: Simulation, partial: Partial<PlayerIntent> = {}) {
  const id = partial.playerId ?? playerId;
  const p = me(sim, id);
  sim.applyIntent({
    playerId: id, seq: sim.getTick(), moveX: 0, moveY: 0,
    aimX: p.x + 100, aimY: p.y, attack: false, dash: false, ability: null, ...partial,
  });
}

function frames(sim: Simulation, count: number, partial?: Partial<PlayerIntent>): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < count; i++) {
    if (partial) input(sim, partial);
    events.push(...sim.step());
  }
  return events;
}

function until(sim: Simulation, predicate: () => boolean, max = 2400): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && !predicate(); i++) events.push(...sim.step());
  expect(predicate(), 'simulation reached expected state').toBe(true);
  return events;
}

function walkTo(sim: Simulation, x: number, y: number, id = playerId, tolerance = 5) {
  for (let i = 0; i < 600; i++) {
    const p = me(sim, id);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= tolerance) return;
    input(sim, { playerId: id, moveX: (x - p.x) / d, moveY: (y - p.y) / d, aimX: x, aimY: y });
    sim.step();
  }
  throw new Error('walk did not reach target');
}

function unlocked(classId: ClassId, encounters: RoomEncounter[] = [encounter('sentinel', 8)]) {
  const sim = createSimulation();
  sim.addPlayer({ id: playerId, displayName: 'Tester', classId });
  sim.setWorld(world([arena(0), arena(1, encounters), arena(2)]));
  sim.enterRoom(0);
  expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'room_cleared', reward: ROOM_CLEAR_REWARD }));
  expect(sim.unlockAbility(playerId)).toContainEqual(expect.objectContaining({ type: 'ability_unlocked', cost: ABILITY_UNLOCK_COST }));
  sim.enterRoom(1);
  return sim;
}

function fight(sim: Simulation, id = playerId, max = 3600): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < max && sim.getPhase() === 'expedition'; i++) {
    const p = me(sim, id);
    const enemy = sim.getSnapshot().enemies.filter((e) => e.hp > 0)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (!enemy) return events;
    const d = Math.hypot(enemy.x - p.x, enemy.y - p.y);
    const reach = p.classId === 'beacon' ? 200 : p.classId === 'weaver' ? 110 : 40;
    input(sim, {
      playerId: id, aimX: enemy.x, aimY: enemy.y,
      moveX: d > reach ? (enemy.x - p.x) / d : 0,
      moveY: d > reach ? (enemy.y - p.y) / d : 0,
      attack: true, ability: p.abilityQCooldownMs === 0 ? 'q' : null,
    });
    events.push(...sim.step());
  }
  expect(sim.getSnapshot().enemies.every((e) => e.hp === 0), 'player defeated the encounter').toBe(true);
  return events;
}

describe('authoritative combat', () => {
  it('resolves facing and range, applies damage once per cooldown, and never hits behind the player', () => {
    const sim = setup('bastion', [encounter('husk', 6, 7, 'front'), encounter('husk', 4, 7, 'behind'), encounter('husk', 12, 7, 'far')]);
    input(sim, { attack: true });
    const events = sim.step();
    expect(events[0]).toMatchObject({ type: 'player_attacked', hitEnemyIds: ['front-0'] });
    expect(events).toContainEqual(expect.objectContaining({ type: 'enemy_damaged', enemyId: 'front-0', amount: 20, remainingHp: 10 }));
    expect(sim.getSnapshot().enemies.map((e) => e.hp)).toEqual([10, 30, 30]);
    expect(frames(sim, 10, { attack: true }).some((e) => e.type === 'player_attacked')).toBe(false);
    frames(sim, 12);
    input(sim, { attack: true });
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'enemy_defeated', enemyId: 'front-0' }));
  });

  it('blocks ranged attacks and abilities through solid geometry', () => {
    const sim = setup('beacon', [encounter('sentinel', 8)], [[6, 7]]);
    input(sim, { attack: true });
    expect(sim.step().find((e) => e.type === 'player_attacked')).toMatchObject({ hitEnemyIds: [] });
    input(sim, { ability: 'q', aimX: tileToWorld(8, 7).x });
    expect(sim.step().filter((e) => e.type === 'enemy_damaged')).toEqual([]);
    expect(sim.getSnapshot().enemies[0]!.hp).toBe(60);
  });

  it.each(ENEMY_IDS)('%s telegraphs before dealing damage', (enemyId) => {
    const sim = setup('bastion', [encounter(enemyId, enemyId === 'sentinel' ? 11 : 7)]);
    const initial = sim.getSnapshot().enemies[0]!;
    const events = until(sim, () => me(sim).hp < 100);
    const telegraph = events.find((e) => e.type === 'enemy_telegraphed')!;
    const hit = events.find((e) => e.type === 'player_damaged')!;
    expect(telegraph.tick).toBeLessThan(hit.tick);
    expect(hit.timeMs - telegraph.timeMs).toBeGreaterThanOrEqual(590);
    expect(hit).toMatchObject({ sourceEnemyId: 'enemy-0' });
    if (enemyId === 'husk' || enemyId === 'lurker') expect(sim.getSnapshot().enemies[0]!.x).toBeLessThan(initial.x);
  });

  it('locks ranged aim during windup so strafing avoids the attack', () => {
    const sim = setup('bastion', [encounter('sentinel', 11)]);
    until(sim, () => Boolean(sim.getSnapshot().enemies[0]!.telegraph));
    const telegraph = sim.getSnapshot().enemies[0]!.telegraph!;
    frames(sim, 25, { moveY: 1 });
    expect(sim.getSnapshot().enemies[0]!.telegraph).toMatchObject({ facing: telegraph.facing, x: telegraph.x, y: telegraph.y });
    const events = frames(sim, 35);
    expect(events).toContainEqual(expect.objectContaining({ type: 'enemy_attacked', hitPlayerIds: [] }));
    expect(me(sim).hp).toBe(100);
  });

  it('dash invulnerability prevents a hit even while crossing the attack cone', () => {
    const sim = setup('bastion', [encounter('sentinel', 11)]);
    until(sim, () => (sim.getSnapshot().enemies[0]!.telegraph?.remainingMs ?? Infinity) <= TICK_MS + 0.001);
    input(sim, { dash: true, moveX: 1 });
    const events = sim.step();
    expect(events).toContainEqual(expect.objectContaining({ type: 'enemy_attacked', hitPlayerIds: [] }));
    expect(me(sim)).toMatchObject({ hp: 100, state: 'dashing' });
    until(sim, () => me(sim).hp < 100);
    expect(me(sim).invulnerableMs).toBeGreaterThan(0);
  });

  it('enemies route around obstacles rather than damaging through walls', () => {
    const sim = setup('bastion', [encounter('husk', 8)], [[6, 6], [6, 7], [6, 8]]);
    frames(sim, 40);
    expect(me(sim).hp).toBe(100);
    until(sim, () => me(sim).hp < 100, 1200);
    expect(sim.getSnapshot().enemies[0]!.x).toBeLessThan(tileToWorld(6, 7).x);
  });
});

describe('class abilities and transactions', () => {
  it.each(CLASS_IDS)('%s Q executes with the registry ID and a real cooldown', (classId) => {
    const sim = setup(classId);
    input(sim, { ability: 'q' });
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'ability_used', abilityId: CLASS_ABILITIES[classId].q }));
    const remaining = me(sim).abilityQCooldownMs!;
    expect(remaining).toBeGreaterThan(0);
    input(sim, { ability: 'q' });
    expect(sim.step().some((e) => e.type === 'ability_used')).toBe(false);
    expect(me(sim).abilityQCooldownMs).toBeCloseTo(remaining - TICK_MS);
  });

  it('Bastion bulwark blocks a sentinel beam and reduces melee damage', () => {
    for (const enemy of ['sentinel', 'husk'] as const) {
      const sim = setup('bastion', [encounter(enemy)]);
      until(sim, () => (sim.getSnapshot().enemies[0]!.telegraph?.remainingMs ?? Infinity) <= TICK_MS + 0.001);
      input(sim, { ability: 'q' });
      sim.step();
      expect(me(sim).hp).toBe(enemy === 'sentinel' ? 100 : 97);
      expect(me(sim).shieldMs).toBeGreaterThan(0);
    }
  });

  it('Shade blink damages crossed enemies but cannot blink through a wall', () => {
    const sim = setup('shade');
    const x = me(sim).x;
    input(sim, { ability: 'q' });
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'enemy_defeated', enemyId: 'enemy-0' }));
    expect(me(sim).x - x).toBeCloseTo(112);
    const blocked = setup('shade', [encounter('husk', 8)], [[7, 7]]);
    input(blocked, { ability: 'q' });
    blocked.step();
    expect(me(blocked).x).toBeLessThan(7 * 32);
    expect(blocked.getSnapshot().enemies[0]!.hp).toBe(30);
  });

  it('Beacon flare damages its aimed area and marks enemies for stronger follow-up attacks', () => {
    const sim = setup('beacon', [encounter('sentinel', 10)]);
    input(sim, { ability: 'q', aimX: tileToWorld(10, 7).x });
    sim.step();
    expect(sim.getSnapshot().enemies[0]).toMatchObject({ hp: 36 });
    expect(sim.getSnapshot().enemies[0]!.markMs).toBeGreaterThan(0);
    input(sim, { attack: true });
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'enemy_damaged', amount: 18 }));
  });

  it('Weaver tether pulls and slows a target, and basic attacks also slow', () => {
    const sim = setup('weaver', [encounter('sentinel', 11)]);
    input(sim, { ability: 'q' });
    sim.step();
    const enemy = sim.getSnapshot().enemies[0]!;
    expect(enemy.hp).toBe(48);
    expect(enemy.x - me(sim).x).toBeCloseTo(55, 0);
    expect(enemy.slowMs).toBeGreaterThan(2900);
    input(sim, { attack: true });
    sim.step();
    expect(sim.getSnapshot().enemies[0]!.hp).toBe(32);
  });

  it('purchases E once with earned resources and keeps class-specific unlocks at HQ', () => {
    const sim = setup('bastion', []);
    expect(sim.unlockAbility(playerId)).toEqual([]);
    input(sim, { ability: 'e' });
    expect(sim.step().some((e) => e.type === 'ability_used')).toBe(false);
    expect(me(sim).resources).toBe(ROOM_CLEAR_REWARD);
    const purchase = sim.unlockAbility(playerId);
    expect(purchase).toEqual([expect.objectContaining({
      type: 'ability_unlocked', abilityId: 'bastion.e.shockwave', cost: ABILITY_UNLOCK_COST, remainingResources: 0,
    })]);
    expect(sim.unlockAbility(playerId)).toEqual([]);
    expect(sim.unlockAbility('missing-player')).toEqual([]);
    sim.returnToHeadquarters();
    sim.updatePlayerIdentity({ id: playerId, displayName: 'Tester', classId: 'shade' });
    expect(me(sim).abilityEUnlocked).toBe(false);
    sim.updatePlayerIdentity({ id: playerId, displayName: 'Tester', classId: 'bastion' });
    expect(me(sim).abilityEUnlocked).toBe(true);
  });

  it('Bastion shockwave damages, stuns, and knocks enemies back', () => {
    const sim = unlocked('bastion');
    const before = sim.getSnapshot().enemies[0]!;
    input(sim, { ability: 'e' });
    sim.step();
    const enemy = sim.getSnapshot().enemies[0]!;
    expect(enemy.hp).toBe(25);
    expect(enemy.x - before.x).toBeCloseTo(70);
    expect(enemy.stunMs).toBeGreaterThan(1400);
    expect(frames(sim, 60).some((e) => e.type === 'enemy_telegraphed')).toBe(false);
  });

  it('Shade shroud conceals the player and empowers the next strike', () => {
    const sim = unlocked('shade', [encounter('sentinel', 6)]);
    input(sim, { ability: 'e' });
    sim.step();
    expect(frames(sim, 35).some((e) => e.type === 'enemy_telegraphed')).toBe(false);
    input(sim, { attack: true });
    expect(sim.step()).toContainEqual(expect.objectContaining({ type: 'enemy_damaged', amount: 36 }));
    expect(me(sim).shroudMs).toBe(0);
    expect(me(sim).abilityECooldownMs).toBeGreaterThan(0);
  });

  it('Beacon rally heals living nearby allies and boosts their movement and attacks', () => {
    const sim = unlocked('beacon', [encounter('sentinel', 11)]);
    sim.addPlayer({ id: 'b-ally', displayName: 'Ally', classId: 'bastion' });
    until(sim, () => me(sim, 'b-ally').hp < 100);
    const before = me(sim, 'b-ally').hp;
    input(sim, { ability: 'e' });
    const events = sim.step();
    expect(events).toContainEqual(expect.objectContaining({ type: 'player_healed', playerId: 'b-ally', byPlayerId: playerId }));
    expect(me(sim, 'b-ally').hp).toBe(Math.min(100, before + 35));
    expect(me(sim, 'b-ally').rallyMs).toBeGreaterThan(3900);
    input(sim, { playerId: 'b-ally', moveY: 1, attack: true });
    sim.step();
    expect(me(sim, 'b-ally').attackCooldownMs).toBe(270);
  });

  it('Weaver rewind restores prior position and lost health without crossing room history', () => {
    const sim = unlocked('weaver', [encounter('sentinel', 11)]);
    const start = me(sim);
    until(sim, () => me(sim).hp < 100);
    frames(sim, 15, { moveY: 1 });
    expect(me(sim).y).toBeGreaterThan(start.y);
    input(sim, { ability: 'e' });
    const events = sim.step();
    expect(events).toContainEqual(expect.objectContaining({ type: 'player_healed', remainingHp: 100 }));
    expect(me(sim)).toMatchObject({ x: start.x, y: start.y, hp: 100 });
  });
});

describe('progression, objectives, and co-op', () => {
  it('gates direct room transitions and exit events until combat is actually cleared', () => {
    const sim = setup('beacon', [encounter('sentinel', 6)]);
    expect(sim.enterRoom(1)).toEqual([]);
    expect(sim.getRoom().index).toBe(0);
    const events = fight(sim);
    expect(events.filter((e) => e.type === 'room_cleared')).toHaveLength(1);
    expect(me(sim).resources).toBe(ROOM_CLEAR_REWARD);
    expect(sim.enterRoom(1)).toContainEqual(expect.objectContaining({ type: 'room_entered', roomIndex: 1 }));
  });

  it('does not emit exit_reached while standing on an exit with live enemies', () => {
    const sim = setup('beacon', [encounter('husk', 20, 3)]);
    const exit = tileToWorld(24, 7);
    const events: GameEvent[] = [];
    for (let i = 0; i < 195; i++) {
      input(sim, { moveX: me(sim).x < exit.x ? 1 : 0 });
      events.push(...sim.step());
    }
    expect(Math.floor(me(sim).x / 32)).toBe(24);
    expect(events.some((e) => e.type === 'exit_reached')).toBe(false);
    expect(sim.enterRoom(1)).toEqual([]);
  });

  it('retains cleared rooms and prevents duplicate rewards after revisiting and streaming updates', () => {
    const sim = setup('beacon');
    const prepared = sim.getWorld()!;
    const second = arena(1);
    second.exits[0]!.toRoomIndex = 0;
    sim.setWorld({ ...prepared, rooms: [prepared.rooms[0]!, second] });
    fight(sim);
    sim.enterRoom(1);
    sim.step();
    const resources = me(sim).resources;
    sim.setWorld({ ...sim.getWorld()!, rooms: [...sim.getWorld()!.rooms, arena(2)] });
    expect(sim.enterRoom(0)).toContainEqual(expect.objectContaining({ type: 'room_entered' }));
    expect(sim.getSnapshot().enemies.every((e) => e.hp === 0)).toBe(true);
    expect(sim.getSnapshot().roomCleared).toBe(true);
    expect(frames(sim, 20).some((e) => e.type === 'room_cleared')).toBe(false);
    expect(me(sim).resources).toBe(resources);
  });

  it('emits one loss on all-downed, freezes gameplay, restores health at HQ, and retries', () => {
    const sim = setup();
    const events = until(sim, () => sim.getPhase() === 'debrief');
    expect(events.filter((e) => e.type === 'run_ended')).toEqual([expect.objectContaining({ outcome: 'collapsed' })]);
    expect(me(sim)).toMatchObject({ hp: 0, state: 'down' });
    const position = { x: me(sim).x, y: me(sim).y };
    expect(frames(sim, 30, { dash: true, attack: true, moveX: 1, ability: 'q' })).toEqual([]);
    expect(me(sim)).toMatchObject(position);
    expect(sim.enterRoom(1)).toEqual([]);
    expect(sim.returnToHeadquarters()).toEqual([]);
    expect(me(sim)).toMatchObject({ hp: 100, state: 'idle', abilityQCooldownMs: 0, invulnerableMs: 0 });
    sim.enterRoom(0);
    expect(sim.getPhase()).toBe('expedition');
    expect(sim.getSnapshot().enemies[0]!.hp).toBe(30);
  });

  it('revives only with an uninterrupted nearby F hold and reports the actual rescuer', () => {
    const sim = setup('bastion', [encounter('sentinel', 11)]);
    const allyId = 'b-ally';
    sim.addPlayer({ id: allyId, displayName: 'Rescuer', classId: 'beacon' });
    frames(sim, 60, { playerId: allyId, moveY: 1 });
    until(sim, () => me(sim).hp === 0);
    expect(sim.getPhase()).toBe('expedition');
    fight(sim, allyId);
    frames(sim, 60, { playerId: allyId, interact: true });
    expect(me(sim).reviveProgress).toBe(0);
    walkTo(sim, me(sim).x, me(sim).y + 35, allyId);
    frames(sim, 60, { playerId: allyId, interact: true });
    expect(me(sim).reviveProgress).toBeCloseTo(0.5);
    input(sim, { playerId: allyId, interact: true });
    input(sim, { playerId: allyId, interact: false });
    sim.step();
    expect(me(sim).reviveProgress).toBe(0);
    const events = frames(sim, Math.ceil(REVIVE_DURATION_MS / TICK_MS), { playerId: allyId, interact: true });
    expect(events.filter((e) => e.type === 'player_revived')).toEqual([expect.objectContaining({
      playerId, byPlayerId: allyId, hp: REVIVE_HP,
    })]);
    expect(me(sim)).toMatchObject({ hp: REVIVE_HP, state: 'idle', reviveProgress: 0 });
  });

  it('requires the guardian defeat and a held Anchor interaction before declaring victory', () => {
    const sim = setup('beacon');
    sim.returnToHeadquarters();
    sim.enterRoom(2);
    expect(sim.getSnapshot().enemies.some((e) => e.enemyId === 'guardian')).toBe(true);
    frames(sim, 180, { interact: true });
    expect(sim.getSnapshot().anchor).toMatchObject({ state: 'dormant', progress: 0 });
    const events = fight(sim);
    expect(events.some((e) => e.type === 'run_ended')).toBe(false);
    const anchor = sim.getSnapshot().anchor!;
    walkTo(sim, anchor.x, anchor.y);
    frames(sim, 60, { interact: true });
    expect(sim.getSnapshot().anchor!.progress).toBeCloseTo(1 / 3);
    sim.step();
    expect(sim.getSnapshot().anchor).toMatchObject({ state: 'dormant', progress: 0 });
    const completion = frames(sim, Math.ceil(ANCHOR_HOLD_MS / TICK_MS), { interact: true });
    expect(completion.filter((e) => e.type === 'anchor_planted')).toHaveLength(1);
    expect(completion.filter((e) => e.type === 'run_ended')).toEqual([expect.objectContaining({ outcome: 'anchored' })]);
    expect(sim.getPhase()).toBe('debrief');
    expect(sim.getSnapshot().anchor).toMatchObject({ state: 'planted', progress: 1 });
    expect(sim.returnToHeadquarters()).toEqual([]);
  });

  it('reads a relic only with an uninterrupted F hold beside it and records the discovery', () => {
    const sim = createSimulation();
    sim.addPlayer({ id: playerId, displayName: 'Tester', classId: 'bastion' });
    const room0 = RoomSpecSchema.parse({ ...arena(0), relics: [{ id: 'relic', x: 6, y: 5, fragmentIndex: 0 }] });
    sim.setWorld(world([room0, arena(1), arena(2, [encounter('guardian', 10)])]));
    sim.enterRoom(0);
    expect(sim.getSnapshot().loreNodes).toEqual([expect.objectContaining({ id: 'relic', kind: 'relic', state: 'sealed', progress: 0 })]);
    frames(sim, 10, { interact: true });
    expect(sim.getSnapshot().discoveredLore).toEqual([]);

    const relic = tileToWorld(6, 5);
    walkTo(sim, relic.x, relic.y);
    const half = frames(sim, Math.floor(LORE_READ_MS / TICK_MS / 2), { interact: true });
    expect(half.some((e) => e.type === 'lore_discovered')).toBe(false);
    expect(sim.getSnapshot().loreNodes![0]!.state).toBe('reading');
    input(sim, { interact: false });
    sim.step();
    expect(sim.getSnapshot().loreNodes![0]).toMatchObject({ state: 'sealed', progress: 0 });

    const events = frames(sim, Math.ceil(LORE_READ_MS / TICK_MS) + 1, { interact: true });
    const fragment = fixture.recipe.lore[0]!;
    expect(events.filter((e) => e.type === 'lore_discovered')).toEqual([expect.objectContaining({
      playerId, kind: 'relic', fragmentIndex: 0, title: fragment.title, text: fragment.text,
    })]);
    expect(sim.getSnapshot().loreNodes![0]).toMatchObject({ state: 'collected', progress: 1 });
    expect(sim.getSnapshot().discoveredLore).toEqual([0]);
    expect(frames(sim, 60, { interact: true }).some((e) => e.type === 'lore_discovered')).toBe(false);
  });

  it('drops an enemy kind\'s remains once per run where it fell, collected by touch', () => {
    const sim = setup('beacon', [encounter('husk', 8, 7, 'a'), encounter('husk', 12, 7, 'b')]);
    const events = fight(sim);
    const huskFragment = fixture.recipe.lore.findIndex((f) => f.kind === 'remains' && f.enemyId === 'husk');
    const pickedUp = events.filter((e) => e.type === 'lore_discovered');
    const pending = sim.getSnapshot().loreNodes!.filter((n) => n.kind === 'remains');
    expect(pickedUp.length + pending.length).toBe(1);
    if (pending.length === 1) {
      const node = pending[0]!;
      expect(node).toMatchObject({ fragmentIndex: huskFragment, state: 'sealed' });
      expect(sim.getSnapshot().discoveredLore).toEqual([]);
      walkTo(sim, node.x, node.y);
    } else {
      expect(pickedUp[0]).toMatchObject({ kind: 'remains', fragmentIndex: huskFragment });
    }
    expect(sim.getSnapshot().loreNodes!.filter((n) => n.kind === 'remains')).toEqual([]);
    expect(sim.getSnapshot().discoveredLore).toEqual([huskFragment]);
  });

  it('has deterministic co-op results independent of per-tick input arrival order', () => {
    const run = (reverse: boolean) => {
      const sim = createSimulation();
      const identities = [
        { id: playerId, displayName: 'A', classId: 'beacon' as const },
        { id: 'b-player', displayName: 'B', classId: 'weaver' as const },
      ];
      for (const p of reverse ? [...identities].reverse() : identities) sim.addPlayer(p);
      sim.setWorld(world([arena(0, [encounter('guardian', 9), encounter('husk', 7, 8, 'husk')]), arena(1), arena(2)]));
      const events = sim.enterRoom(0);
      for (let i = 0; i < 480; i++) {
        for (const id of reverse ? ['b-player', playerId] : [playerId, 'b-player']) {
          input(sim, { playerId: id, aimX: tileToWorld(9, 7).x, aimY: tileToWorld(9, 7).y, attack: i % 24 === 0, ability: i % 240 === 0 ? 'q' : null });
        }
        events.push(...sim.step());
      }
      for (const event of events) expect(GameEventSchema.safeParse(event).success).toBe(true);
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      expect(GameSnapshotSchema.safeParse(sim.getSnapshot()).success).toBe(true);
      return { snapshot: sim.getSnapshot(), events };
    };
    expect(run(true)).toEqual(run(false));
  });

  it('keeps event IDs unique across step, purchase, transitions, and abort at the same tick', () => {
    const sim = setup('bastion', []);
    const events = [...sim.step(), ...sim.unlockAbility(playerId), ...sim.enterRoom(1), ...sim.returnToHeadquarters()];
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events.filter((e) => e.type === 'run_ended')).toEqual([expect.objectContaining({ outcome: 'aborted' })]);
    for (const event of events) expect(GameEventSchema.safeParse(event).success).toBe(true);
  });

  it('accepts legacy intents and isolates returned snapshots from simulation state', () => {
    const sim = setup();
    expect(PlayerIntentSchema.safeParse({
      playerId, seq: 1, moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null,
    }).success).toBe(true);
    until(sim, () => Boolean(sim.getSnapshot().enemies[0]!.telegraph));
    const snapshot = sim.getSnapshot();
    snapshot.players[0]!.hp = 0;
    snapshot.enemies[0]!.telegraph!.range = 999;
    expect(me(sim).hp).toBe(100);
    expect(sim.getSnapshot().enemies[0]!.telegraph!.range).not.toBe(999);
  });
});
