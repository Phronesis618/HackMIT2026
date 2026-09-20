/**
 * A composed world, upgraded to floors, played by the floors bot: four composed biomes cleared
 * end to end with real intents, four biome picks, arrival in the fifth (Anchor) biome. Proves
 * the composer's briefs are not just schema-valid but walkable. The Custodian fight itself is
 * B1's (tests/sim/finale.test.ts); the bot is an approximate player there.
 */
import { describe, expect, it } from 'vitest';
import { composeWorld } from '../../src/server/composer/compose';
import { compileWorldRecipe } from '../../src/server/generation/compiler';
import { PreparedWorldSchema } from '../../src/shared/contracts';
import { floorsSeedFor, upgradeToFloors } from '../../src/shared/floorgen';
import { createSimulation } from '../../src/sim';
import { FloorsBot, makeProvider } from '../sim/floorsBot';

const CREW = ['op-a', 'op-b', 'op-c'];

function composedFloorsWorld(ideas: string[], requestId: string) {
  const { recipe } = composeWorld({
    requestId, sessionId: 'composer-floors', plannedRoomCount: 3,
    contributions: ideas.map((text, i) => ({ id: `c${i}`, playerId: `p${i}`, playerName: `Op ${i}`, text, submittedAt: i })),
  });
  const compiled = compileWorldRecipe(recipe, { plannedRoomCount: 3, seed: 21 });
  const legacy = PreparedWorldSchema.parse({
    worldId: `world-composed-${requestId}`, createdAt: 0, recipe, art: compiled.art, rooms: compiled.rooms, plannedRoomCount: 3,
    provenance: { source: 'procedural', label: 'COMPOSED · relay-composer', model: 'relay-composer', generatedAt: 0, durationMs: 1, attempts: 1, notes: [] },
    receipt: { worldTitle: recipe.title, source: 'procedural', headline: 'h', lines: [] },
  });
  return upgradeToFloors(legacy, floorsSeedFor(legacy));
}

describe('composer briefs in a floors run', () => {
  it.each([
    ['space pirates', 'a frozen moon full of crystal moths'],
    ['a haunted space station overrun by ghost pirates'],
  ])('walks four composed biomes and arrives in the Anchor biome: %s', (...ideas) => {
    const world = composedFloorsWorld(ideas, ideas.join('-').replace(/\W+/g, '-').slice(0, 40));
    expect(world.floors!.briefs.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']);
    const sim = createSimulation();
    for (const id of CREW) sim.addPlayer({ id, displayName: id, classId: 'beacon' });
    for (const id of CREW) sim.unlockAbility(id);
    sim.setHostPlayerId(CREW[0]!);
    sim.setWorld(world);
    const bot = new FloorsBot(sim, makeProvider(world), CREW);
    bot.events.push(...sim.enterRoom(0));
    const visited: string[] = [];
    for (let tier = 0; tier < 5; tier++) {
      expect(bot.floor().tier).toBe(tier);
      visited.push(bot.floor().biomeId);
      if (tier === 4) break;
      bot.travel(bot.plan().exitId);
      bot.useFocus();
      const options = bot.floor().biomeChoice!.options;
      expect(options).toEqual(world.floors!.route.tiers[tier + 1]);
      const depth = (biomeId: string) => bot.provider.plan(biomeId).rooms.find((room) => room.id === bot.provider.plan(biomeId).exitId)!.depth;
      sim.chooseBiome(CREW[0]!, [...options].sort((a, b) => depth(a) - depth(b))[0]!);
      bot.tick();
      expect(bot.floor().roomId).toBe('r00');
    }
    // Five distinct composed biomes were walked, named by the composer's themes.
    expect(new Set(visited).size).toBe(5);
    const names = visited.map((id) => world.floors!.briefs.find((b) => b.id === id)!.name);
    expect(new Set(names).size).toBe(5);
    // The Anchor biome's exit room is built and is the final (Anchor) room of the run.
    const finale = bot.plan();
    expect(finale.tier).toBe(4);
    const anchorRoom = bot.provider.getRoom({ biomeId: finale.biomeId, roomId: finale.exitId });
    expect(anchorRoom.isFinal).toBe(true);
    expect(anchorRoom.feature).toBe('anchor');
  });
});
