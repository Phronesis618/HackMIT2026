/**
 * Gatekeepers: the biome-exit fight is a single-pattern preview of the Custodian the crew will
 * meet in the last room, so the run teaches its own final fight (BOSS_FINALE.md §5, Stout's
 * beat 1 done systemically). Tier 0 shows move 1, tier 1 move 2, tier 2 move 3, tier 3 alternates
 * the first two, and only the tier-4 Custodian has all three and more than one phase.
 */
import { describe, expect, it } from 'vitest';
import { GATEKEEPER_TIERS, gatekeeperMaxHp, resolveCustodian } from '../../src/shared/custodian';
import { createSimulation } from '../../src/sim';
import { FloorsBot, floorsWorld, makeProvider } from './floorsBot';

const CREW = ['op-a', 'op-b'];

function worldCustodianMoves(world: ReturnType<typeof floorsWorld>) {
  return resolveCustodian({
    seed: world.worldId,
    motifIds: world.recipe.motifIds,
    enemyPool: [...new Set(world.recipe.rooms.flatMap((room) => room.enemyIds))].filter((id) => id !== 'guardian'),
  }).moves;
}

describe('gatekeepers preview the Custodian', () => {
  it('gives the tier-0 exit fight one of the final boss\'s three patterns, its own health and one phase', () => {
    const world = floorsWorld('gatekeeper');
    const sim = createSimulation();
    for (const id of CREW) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
    sim.setHostPlayerId(CREW[0]!);
    sim.setWorld(world);
    const bot = new FloorsBot(sim, makeProvider(world), CREW);
    bot.events.push(...sim.enterRoom(0));
    expect(bot.floor().tier).toBe(0);
    bot.travel(bot.plan().exitId);

    const moves = worldCustodianMoves(world);
    const previews = bot.events.filter((event) => event.type === 'boss_pattern_started');
    expect(previews.length).toBeGreaterThan(0);
    const expected = moves[GATEKEEPER_TIERS[0]!.moveIndices[0]!]!;
    for (const event of previews) {
      if (event.type !== 'boss_pattern_started') continue;
      // One pattern, the world's own name for it, so the banner reads the same in the last room.
      expect(event.patternId).toBe(expected.patternId);
      expect(event.name).toBe(expected.name);
    }
    // A gatekeeper never leaves phase 1 and never runs the finale's terrain twist.
    expect(bot.events.some((event) => event.type === 'boss_phase_changed')).toBe(false);
    expect(bot.events.some((event) => event.type === 'terrain_corrupted')).toBe(false);
  }, 120_000);

  it('sizes each tier\'s gatekeeper from the table, well under the Custodian', () => {
    expect(GATEKEEPER_TIERS.map((tier) => tier.hp)).toEqual([320, 360, 400, 480]);
    expect(GATEKEEPER_TIERS.map((tier) => tier.telegraphScale)).toEqual([1.3, 1.2, 1.15, 1.05]);
    expect(GATEKEEPER_TIERS.map((tier) => tier.moveIndices)).toEqual([[0], [1], [2], [0, 1]]);
    expect(gatekeeperMaxHp(0, 2)).toBe(400);
    expect(gatekeeperMaxHp(2, 4)).toBe(400 + 300);
    // Telegraphs are slower the earlier the crew meets them: the first one is there to be read.
    for (let tier = 1; tier < GATEKEEPER_TIERS.length; tier++) {
      expect(GATEKEEPER_TIERS[tier]!.telegraphScale).toBeLessThan(GATEKEEPER_TIERS[tier - 1]!.telegraphScale);
      expect(GATEKEEPER_TIERS[tier]!.hp).toBeGreaterThan(GATEKEEPER_TIERS[tier - 1]!.hp);
    }
  });
});
