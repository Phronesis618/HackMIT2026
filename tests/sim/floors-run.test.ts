import { describe, expect, it } from 'vitest';
import { GameSnapshotSchema } from '../../src/shared/contracts';
import { FLOOR_ENTRANCE_ROOM_ID } from '../../src/shared/floors';
import { createSimulation } from '../../src/sim';
import { FloorsBot, floorsWorld, makeProvider } from './floorsBot';

const CREW = ['op-a', 'op-b', 'op-c'];

/** Plays a whole seeded run with real intents: five biomes, four picks, the Custodian and the ritual. */
function playRun(seed: string) {
  const world = floorsWorld(seed);
  const sim = createSimulation();
  for (const id of CREW) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
  for (const id of CREW) sim.unlockAbility(id);
  sim.setHostPlayerId(CREW[0]!);
  sim.setWorld(world);
  const bot = new FloorsBot(sim, makeProvider(world), CREW);
  bot.events.push(...sim.enterRoom(0));
  const snapshots: string[] = [];
  for (let tier = 0; tier < 5; tier++) {
    expect(bot.floor().tier).toBe(tier);
    bot.travel(bot.plan().exitId);
    snapshots.push(JSON.stringify(bot.snapshot()));
    if (tier === 4) break;
    bot.useFocus();
    const options = bot.floor().biomeChoice!.options;
    expect(options).toEqual(world.floors!.route.tiers[tier + 1]);
    // Prefer the biome whose exit is nearer: the bot is here to prove the path, not to explore.
    const depth = (biomeId: string) => bot.provider.plan(biomeId).rooms.find((room) => room.id === bot.provider.plan(biomeId).exitId)!.depth;
    sim.chooseBiome(CREW[0]!, [...options].sort((a, b) => depth(a) - depth(b))[0]!);
    bot.tick();
    expect(bot.floor().roomId).toBe('r00');
  }
  return { bot, sim, world, snapshots };
}

describe('floors: a whole run', () => {
  it('reaches the tier-4 Anchor room, fights the three-phase Custodian and completes the ritual', () => {
    const { bot, sim } = playRun('delta');
    const room = bot.room();
    expect(room).toMatchObject({ isFinal: true, feature: 'anchor', kind: 'exit' });
    expect(room.anchorRelays).toHaveLength(3);
    const custodian = bot.snapshot().enemies.find((enemy) => enemy.enemyId === 'guardian')!;
    expect(custodian.hp).toBe(0);
    expect(custodian.bossPhase).toBe(3);
    expect(bot.floor().biomeChoice).toBeNull();

    for (let relay = 0; relay < 3; relay++) {
      const ritual = bot.snapshot().anchor!.ritual!;
      expect(ritual.activeRelay).toBe(relay);
      bot.walkTo(ritual.relays[relay]!, { reach: 10 });
      bot.tick(() => ({ interact: true }));
      bot.tick();
    }
    expect(bot.snapshot().anchor!.ritual!.stage).toBe('core');
    bot.walkTo(bot.snapshot().anchor!, { reach: 30 });
    bot.tick(() => ({ interact: true }));
    for (let i = 0; i < 200 && bot.snapshot().anchor!.ritual!.stage === 'discharging'; i++) bot.tick();
    expect(bot.events.filter((event) => event.type === 'anchor_planted')).toHaveLength(1);

    // The Anchor holds and the world starts coming down: the run now ends with the walk back to
    // the biome entrance and one thing carried out (docs/design/BOSS_FINALE.md §7, §8).
    expect(bot.snapshot().anchor!.ritual!.stage).toBe('collapse');
    const collapse = bot.snapshot().collapse!;
    expect(collapse.totalMs).toBeGreaterThanOrEqual(60_000);
    expect(collapse.remainingMs).toBeGreaterThan(0);
    expect(sim.getPhase()).toBe('expedition');
    bot.travel(FLOOR_ENTRANCE_ROOM_ID);
    bot.tick(); // the timer stops on the first tick inside the portal room
    expect(bot.snapshot().collapse!.stage).toBe('extraction');
    const offer = bot.snapshot().collapse!.offer;
    expect(offer.length).toBeGreaterThan(0);
    // A generous timer: a crew that knows the route arrives with most of it left.
    expect(bot.snapshot().collapse!.remainingMs / collapse.totalMs).toBeGreaterThan(0.35);
    bot.walkTo(offer[0]!, { reach: 16 });
    for (let i = 0; i < 1400 && sim.getPhase() === 'expedition'; i++) bot.tick();
    expect(sim.getPhase()).toBe('debrief');
    expect(bot.events.filter((event) => event.type === 'relic_carried')).toHaveLength(1);
    expect(bot.events.at(-1)).toMatchObject({ type: 'run_ended', outcome: 'anchored' });
    expect(bot.events.filter((event) => event.type === 'biome_entered').map((event) => event.type === 'biome_entered' && event.tier)).toEqual([0, 1, 2, 3, 4]);
    expect(GameSnapshotSchema.parse(bot.snapshot()).floor).toMatchObject({ tier: 4 });
  }, 120_000);

  it('is deterministic: same seed and same intents give identical snapshots', () => {
    const a = playRun('echo');
    const b = playRun('echo');
    expect(a.snapshots).toEqual(b.snapshots);
    expect(a.bot.events).toEqual(b.bot.events);
  }, 240_000);
});
