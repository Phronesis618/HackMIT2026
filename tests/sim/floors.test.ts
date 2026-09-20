import { describe, expect, it } from 'vitest';
import { GameSnapshotSchema, GameEventSchema, type GameEvent } from '../../src/shared/contracts';
import { ROOM_CLEAR_REWARD, tileToWorld } from '../../src/shared/conventions';
import { lintProse } from '../../src/shared/prose';
import { createSimulation, FLOOR_TUNING, TREASURE_REWARD, tierMultiplier } from '../../src/sim';
import { FloorsBot, floorsWorld, makeProvider, planPath } from './floorsBot';

const SEED = 'delta';

function start(seed = SEED, crew = ['op-a'], tweak?: Parameters<typeof floorsWorld>[1]) {
  const world = floorsWorld(seed, tweak);
  const sim = createSimulation();
  for (const id of crew) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
  for (const id of crew) sim.unlockAbility(id);
  sim.setWorld(world);
  const entered = sim.enterRoom(0);
  const bot = new FloorsBot(sim, makeProvider(world), crew);
  bot.events.push(...entered);
  return { world, sim, bot };
}

const withSpecials = (briefs: Parameters<NonNullable<Parameters<typeof floorsWorld>[1]>>[0]) => {
  briefs[0]!.layout.specials = { treasure: 1, lore: 1, rest: 1, elite: 1 };
};

describe('floors: traversal, door locks and the map', () => {
  it('starts in the opening biome entrance with an open, schema-valid floor state', () => {
    const { world, bot } = start();
    const snapshot = GameSnapshotSchema.parse(bot.snapshot());
    expect(snapshot.floor).toMatchObject({ biomeId: world.floors!.route.tiers[0]![0], roomId: 'r00', tier: 0, doorsLocked: false, biomeChoice: null });
    expect(snapshot.roomId).toBe(world.rooms[0]!.id);
    expect(snapshot.roomCleared).toBe(true);
    expect(bot.room()).toEqual(world.rooms[0]);
    const map = snapshot.floor!.map;
    expect(map.filter((room) => room.state === 'visited').map((room) => room.roomId)).toEqual(['r00']);
    const neighbours = Object.values(bot.plan().rooms[0]!.doors);
    expect(map.filter((room) => room.state === 'seen').map((room) => room.roomId).sort()).toEqual([...neighbours].sort());
    expect(bot.events.map((event) => event.type)).toEqual(['biome_entered', 'room_entered']);
    for (const event of bot.events) GameEventSchema.parse(event);
  });

  it('seals a combat room until it is cleared, arrives on the twin door entry, and keeps it cleared on backtrack', () => {
    const { bot } = start();
    const plan = bot.plan();
    const path = planPath(plan, 'r00', plan.exitId);
    const first = path[0]!;
    expect(plan.rooms.find((room) => room.id === first)!.kind).toBe('combat');
    expect(bot.useDoor(first)).toBe(true);
    const room = bot.room();
    const twin = room.exits.find((exit) => exit.toRoomId === 'r00')!;
    const lead = bot.snapshot().players[0]!;
    expect({ x: lead.x, y: lead.y }).toEqual(tileToWorld(twin.entry!.x, twin.entry!.y));
    expect(bot.floor().doorsLocked).toBe(true);
    expect(bot.snapshot().enemies.length).toBeGreaterThan(0);
    // The door we came through does not let us back out mid-fight.
    const before = bot.events.length;
    for (let i = 0; i < 40; i++) bot.tick((player) => ({ moveX: twin.x - twin.entry!.x, moveY: twin.y - twin.entry!.y, aimX: player.x, aimY: player.y + 1 }));
    expect(bot.floor().roomId).toBe(first);
    expect(bot.events.slice(before).some((event) => event.type === 'exit_reached')).toBe(false);

    bot.fight();
    expect(bot.floor().doorsLocked).toBe(false);
    const cleared = bot.events.filter((event): event is Extract<GameEvent, { type: 'room_cleared' }> => event.type === 'room_cleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ roomId: room.id, reward: ROOM_CLEAR_REWARD });
    const corpses = bot.snapshot().enemies.map((enemy) => enemy.id);

    expect(bot.useDoor('r00')).toBe(true);
    expect(bot.floor().map.find((entry) => entry.roomId === first)).toMatchObject({ state: 'visited', cleared: true, kind: 'combat' });
    expect(bot.useDoor(first)).toBe(true);
    expect(bot.floor().doorsLocked).toBe(false);
    expect(bot.snapshot().roomCleared).toBe(true);
    expect(bot.snapshot().enemies.map((enemy) => enemy.id)).toEqual(corpses);
    expect(bot.snapshot().enemies.every((enemy) => enemy.hp === 0)).toBe(true);
    expect(bot.events.filter((event) => event.type === 'room_cleared')).toHaveLength(1);
  });
});

describe('floors: room kinds', () => {
  it('rest heals once, treasure pays once, elites pay double, lore rooms hold a relic', () => {
    const { bot, sim } = start(SEED, ['op-a'], withSpecials);
    const plan = bot.plan();
    const kinds = new Map(plan.rooms.map((room) => [room.kind, room.id]));
    expect([...kinds.keys()]).toEqual(expect.arrayContaining(['rest', 'treasure', 'lore', 'elite']));

    // Take one real hit from the elite pack first, so the rest site has something to heal.
    bot.travel(kinds.get('elite')!, (roomId) => {
      if (roomId !== kinds.get('elite')) return;
      for (let i = 0; i < 1200 && bot.snapshot().players[0]!.hp === 100; i++) {
        bot.tick((player, snapshot) => ({ moveX: Math.sign(snapshot.enemies[0]!.x - player.x), moveY: Math.sign(snapshot.enemies[0]!.y - player.y) }));
      }
    });
    const eliteClear = bot.events.filter((event) => event.type === 'room_cleared').at(-1)!;
    // An elite room pays double, minus ENV_KILL_CREDIT of the share of any enemy the ROOM
    // killed rather than the crew (docs/design/TILES.md §1.1). The bot kites through hazards,
    // so a terrain kill is normal here; the floor of the range is one enemy short of full.
    const full = ROOM_CLEAR_REWARD * FLOOR_TUNING.eliteRewardMultiplier;
    expect(eliteClear.type).toBe('room_cleared');
    expect((eliteClear as { reward: number }).reward).toBeLessThanOrEqual(full);
    expect((eliteClear as { reward: number }).reward).toBeGreaterThanOrEqual(Math.round(full * 0.5));

    bot.travel(kinds.get('lore')!);
    expect(bot.floor().doorsLocked).toBe(false);
    expect((bot.snapshot().loreNodes ?? []).filter((node) => node.kind === 'relic')).toHaveLength(1);

    bot.travel(kinds.get('treasure')!);
    expect(bot.floor().doorsLocked).toBe(false);
    const resources = bot.snapshot().players[0]!.resources!;
    const clearsBefore = bot.events.filter((event) => event.type === 'room_cleared').length;
    bot.useFocus();
    expect(bot.snapshot().players[0]!.resources).toBe(resources + TREASURE_REWARD);
    expect(bot.events.filter((event) => event.type === 'room_cleared')).toHaveLength(clearsBefore + 1);
    expect(bot.floor().map.find((room) => room.roomId === bot.floor().roomId)?.cleared).toBe(true);
    const treasureId = bot.floor().roomId;
    const back = planPath(plan, treasureId, 'r00')[0]!;
    bot.travel(back);
    bot.travel(treasureId);
    bot.useFocus();
    expect(bot.snapshot().players[0]!.resources).toBe(resources + TREASURE_REWARD);

    const hurt = bot.snapshot().players[0]!;
    expect(hurt.hp).toBeLessThan(hurt.maxHp);
    bot.travel(kinds.get('rest')!);
    const hpBefore = bot.snapshot().players[0]!.hp;
    bot.useFocus();
    const healed = bot.snapshot().players[0]!.hp;
    expect(healed).toBe(Math.min(hurt.maxHp, hpBefore + Math.ceil(hurt.maxHp * FLOOR_TUNING.restHealFraction)));
    const restId = bot.floor().roomId;
    bot.travel(planPath(plan, restId, 'r00')[0]!);
    bot.travel(restId);
    const heals = bot.events.filter((event) => event.type === 'player_healed' && event.amount > 35).length;
    bot.useFocus();
    expect(bot.events.filter((event) => event.type === 'player_healed' && event.amount > 35)).toHaveLength(heals);
    expect(sim.getPhase()).toBe('expedition');

    // A4: a rest site is once per RUN, not once per visit — and the room says so out loud, so
    // nobody walks back across a biome expecting a second one.
    expect(bot.room().description).toContain('once, and not again');
    const lint = lintProse(bot.room().description, { kind: 'roomLine' });
    expect(lint.hardFail, JSON.stringify(lint.issues)).toBe(false);
  });
});

describe('floors: biome choice and the final room', () => {
  it('clears biome 0, offers the choice at the exit focus, and the pick lands the crew in the next r00 one tier deeper', () => {
    const { bot, sim, world } = start(SEED, ['op-a', 'op-b']);
    sim.setHostPlayerId('op-a');
    const plan = bot.plan();
    const sealed: string[] = [];
    bot.travel(plan.exitId, () => { if (bot.floor().doorsLocked) sealed.push(bot.floor().roomId); });
    expect(sealed).toContain(plan.exitId);
    const gatekeeper = bot.snapshot().enemies.find((enemy) => enemy.enemyId === 'guardian')!;
    expect(gatekeeper).toMatchObject({ hp: 0, bossPhase: 1 });
    expect(bot.snapshot().anchor).toBeNull();
    expect(bot.floor().biomeChoice).toBeNull();

    bot.useFocus();
    const options = world.floors!.route.tiers[1]!;
    expect(bot.floor().biomeChoice).toMatchObject({ fromBiomeId: plan.biomeId, options, chosenBiomeId: null, hostPlayerId: 'op-a' });
    expect(bot.events.filter((event) => event.type === 'biome_choice_offered')).toHaveLength(1);

    sim.chooseBiome('op-b', options[1]!); // a guest may vote, never decide
    bot.tick();
    expect(bot.floor()).toMatchObject({ biomeId: plan.biomeId, tier: 0 });
    expect(bot.floor().biomeChoice!.votes).toEqual({ 'op-b': options[1] });
    sim.chooseBiome('op-a', 'not-a-biome');
    sim.chooseBiome('op-a', options[0]!);
    bot.tick();
    const floor = GameSnapshotSchema.parse(bot.snapshot()).floor!;
    expect(floor).toMatchObject({ biomeId: options[0], roomId: 'r00', tier: 1, path: [plan.biomeId, options[0]], biomeChoice: null, doorsLocked: false });
    expect(floor.map.filter((room) => room.state === 'visited')).toHaveLength(1);
    expect(bot.events.filter((event) => event.type === 'biome_entered').at(-1)).toMatchObject({ biomeId: options[0], tier: 1, chosenByPlayerId: 'op-a' });
    for (const event of bot.events) GameEventSchema.parse(event);
  });

  it('scales enemies by tier', () => {
    expect(tierMultiplier(0)).toBe(1);
    expect(tierMultiplier(4)).toBeCloseTo(1 + 4 * FLOOR_TUNING.tierScalePerTier);
  });
});
