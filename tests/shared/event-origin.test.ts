import { describe, expect, it } from 'vitest';
import { GameEventSchema } from '../../src/shared/contracts';

const events = [
  { id: '1:0', tick: 1, timeMs: 17, type: 'enemy_defeated', enemyId: 'enemy', byPlayerId: 'player' },
  {
    id: '1:1', tick: 1, timeMs: 17, type: 'lore_discovered', playerId: 'player', fragmentIndex: 0,
    kind: 'remains', title: 'Shard', source: 'Husk', text: 'Found in the world.', x: 32, y: 64,
  },
];

describe('optional event world origin', () => {
  it.each(events)('preserves legacy $type payloads', (event) => {
    expect(GameEventSchema.parse(event)).toEqual(event);
  });

  it.each(events)('preserves explicit world/null origins on $type and rejects invalid ids', (event) => {
    for (const worldId of ['expedition-world', null]) {
      expect(GameEventSchema.parse({ ...event, worldId })).toEqual({ ...event, worldId });
    }
    for (const worldId of ['', 'contains spaces', 'x'.repeat(65), 12]) {
      expect(GameEventSchema.safeParse({ ...event, worldId }).success).toBe(false);
    }
  });
});
