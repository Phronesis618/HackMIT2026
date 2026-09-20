/** Solo floors: LocalSession plays a floors world with the same events and snapshots co-op gets. */
import { describe, expect, it } from 'vitest';
import { LocalSession } from '../../src/client/transport/LocalSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import type { GameEvent } from '../../src/shared/contracts';
import { TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { createRoomProvider } from '../../src/sim';
import { fightIntent, steerIntent } from '../sim/floorsBot';

describe('LocalSession in floors mode', () => {
  it('enters the opening biome, walks a door without asking for legacy rooms, and exposes chooseBiome', async () => {
    const session = new LocalSession({
      identity: { id: 'solo', displayName: 'Solo', classId: 'beacon' },
      worldProvider: {
        ...fixtureWorldProvider,
        prepareWorld: (request, options) => fixtureWorldProvider.prepareWorld({ ...request, floors: true }, options),
        prepareWorldStream: undefined,
      },
    });
    const events: GameEvent[] = [];
    session.onEvents((batch) => events.push(...batch));
    await session.start();
    const world = await session.requestWorld();
    expect(world.floors).toBeDefined();
    expect(world.rooms).toHaveLength(1);
    const provider = createRoomProvider(world)!;
    session.enterPortal();
    expect(session.getSnapshot()?.floor).toMatchObject({ roomId: 'r00', tier: 0, doorsLocked: false });
    expect(session.getSnapshot()?.roomId).toBe(world.rooms[0]!.id);

    const idle = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false };
    const entrance = provider.getRoom(provider.entranceRef());
    const door = entrance.exits[0]!;
    for (let i = 0; i < 1500 && session.getSnapshot()!.floor!.roomId === 'r00'; i++) {
      const snapshot = session.getSnapshot()!;
      session.setIntent({ ...idle, ...steerIntent(entrance, snapshot, snapshot.players[0]!, tileToWorld(door.x, door.y), false) });
      session.advance(TICK_MS);
    }
    const floor = session.getSnapshot()!.floor!;
    expect(floor.roomId).toBe(door.toRoomId);
    expect(floor.map.filter((room) => room.state === 'visited').map((room) => room.roomId).sort()).toEqual(['r00', door.toRoomId].sort());
    expect(events.filter((event) => event.type === 'room_entered').map((event) => event.type === 'room_entered' && event.floorRoomId)).toEqual(['r00', door.toRoomId]);
    expect(session.getGenerationStatus().message).not.toMatch(/not committed/);

    // Fight it out through the session, then the doors open again.
    const room = provider.getRoom({ biomeId: floor.biomeId, roomId: floor.roomId });
    for (let i = 0; i < 6000 && !session.getSnapshot()!.roomCleared; i++) {
      const snapshot = session.getSnapshot()!;
      session.setIntent({ ...idle, ...fightIntent(room, snapshot, snapshot.players[0]!) });
      session.advance(TICK_MS);
    }
    expect(session.getSnapshot()).toMatchObject({ roomCleared: true, phase: 'expedition', floor: { doorsLocked: false } });
    expect(() => session.chooseBiome('nowhere')).not.toThrow(); // no open choice: ignored

    session.returnToHeadquarters();
    expect(session.getSnapshot()?.floor).toBeUndefined();
    session.dispose();
  });
});
