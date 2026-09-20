/**
 * Floors co-op: a host and a guest on the real server walk three rooms of a seeded floors
 * world, stay in sync on room ref / map / door locks, and only the host's biome pick decides.
 */
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { RemoteSession } from '../../src/client/transport/RemoteSession';
import { attachRealtime } from '../../src/server/network/realtime';
import type { GameEvent, PreparedWorld } from '../../src/shared/contracts';
import { tileToWorld } from '../../src/shared/conventions';
import { createRoomProvider } from '../../src/sim';
import { fightIntent, floorsWorld, planPath, steerIntent } from '../sim/floorsBot';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A world whose opening biome is quick to cross: exit three doors away, light packs. */
function quickWorld(): PreparedWorld {
  for (let i = 0; i < 200; i++) {
    const world = floorsWorld(`coop-${i}`, (briefs) => {
      briefs[0]!.enemyPool = ['swarmling', 'husk'];
      briefs[0]!.hazards = false;
      briefs[0]!.layout = { linearity: 0, branchiness: 1, specials: { treasure: 0, lore: 0, rest: 0, elite: 0 } };
    });
    const provider = createRoomProvider(world)!;
    const plan = provider.plan(provider.entranceRef().biomeId);
    const path = planPath(plan, plan.entranceId, plan.exitId);
    if (path.length === 3 && path.every((id) => provider.getRoom({ biomeId: plan.biomeId, roomId: id }).width <= 19)) return world;
  }
  throw new Error('no quick floors seed found');
}

async function serve(world: PreparedWorld) {
  const http = createServer();
  const realtime = attachRealtime(http, { log: () => {}, generation: { prepareWorld: async () => world } });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  cleanups.push(async () => {
    await realtime.close();
    if (http.listening) await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  });
  return `ws://127.0.0.1:${address.port}/ws`;
}

function join(url: string, id: string) {
  const session = new RemoteSession({
    identity: { id, displayName: id, classId: 'beacon' }, url, reconnect: false,
    createSocket: (address) => new WebSocket(address) as unknown as globalThis.WebSocket,
  });
  const events: GameEvent[] = [];
  session.onEvents((batch) => events.push(...batch));
  cleanups.push(() => session.dispose());
  return { session, events };
}

describe('floors over the realtime server', () => {
  it('keeps host and guest in sync across three rooms; the guest votes, the host decides', async () => {
    const world = quickWorld();
    const provider = createRoomProvider(world)!;
    const url = await serve(world);
    const host = join(url, 'host');
    await host.session.start();
    const guest = join(url, 'guest');
    await guest.session.start();
    expect(host.session.getIsHost()).toBe(true);
    expect(guest.session.getIsHost()).toBe(false);

    await host.session.requestWorld();
    await vi.waitFor(() => expect(guest.session.getWorld()?.floors).toEqual(world.floors));
    // Clients get the recipe for every room once, never the rooms themselves.
    expect(guest.session.getWorld()!.rooms).toHaveLength(1);
    // HUB.md §7: the gate waits for every connected seat, so both walk south from the spawn to it first.
    await Promise.all([host.session, guest.session].map(async (session) => {
      const timer = setInterval(() => session.setIntent({ moveX: 0, moveY: 1, aimX: 500, aimY: 600, attack: false, dash: false, ability: null }), 30);
      try {
        await vi.waitFor(() => expect(session.getSnapshot()?.players.find((player) => player.id === session.localPlayerId)?.ready).toBe(true), { timeout: 4000 });
      } finally {
        clearInterval(timer);
        session.setIntent({ moveX: 0, moveY: 0, aimX: 500, aimY: 600, attack: false, dash: false, ability: null });
      }
    }));
    host.session.enterPortal();

    const crew = [host.session, guest.session];
    const floorOf = (session: RemoteSession) => session.getSnapshot()?.floor;
    const roomOf = (session: RemoteSession) => provider.getRoom({ biomeId: floorOf(session)!.biomeId, roomId: floorOf(session)!.roomId });
    const idle = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dash: false, ability: null, interact: false };

    /** Both operatives fight when there is a fight; otherwise the host walks to `goal` and the guest waits. */
    async function drive(goal: () => { x: number; y: number } | null, done: () => boolean, interact = false): Promise<void> {
      const deadline = Date.now() + 40_000;
      while (!done()) {
        if (Date.now() > deadline) throw new Error(`co-op bot timed out in ${floorOf(host.session)?.roomId}`);
        for (const session of crew) {
          const snapshot = session.getSnapshot();
          const me = snapshot?.players.find((player) => player.id === session.localPlayerId);
          if (!snapshot?.floor || !me) continue;
          const room = roomOf(session);
          if (snapshot.enemies.some((enemy) => enemy.hp > 0)) session.setIntent({ ...idle, ...fightIntent(room, snapshot, me) });
          else if (session === host.session && goal()) {
            const target = goal()!;
            const near = Math.hypot(target.x - me.x, target.y - me.y) < 12;
            session.setIntent({ ...idle, ...(near ? {} : steerIntent(room, snapshot, me, target, false)), interact: interact && near });
          } else session.setIntent(idle);
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      for (const session of crew) session.setIntent(idle);
    }
    const inSync = async (roomId: string) => vi.waitFor(() => {
      expect(floorOf(host.session)?.roomId).toBe(roomId);
      expect(floorOf(guest.session)).toEqual(floorOf(host.session));
    }, { timeout: 3000, interval: 20 });

    await inSync('r00');
    const plan = provider.plan(floorOf(host.session)!.biomeId);
    const path = planPath(plan, 'r00', plan.exitId);
    const sealedRooms: string[] = [];
    for (const next of path) {
      const door = roomOf(host.session).exits.find((exit) => exit.toRoomId === next)!;
      await drive(() => tileToWorld(door.x, door.y), () => floorOf(host.session)?.roomId === next);
      await inSync(next);
      if (floorOf(guest.session)!.doorsLocked) sealedRooms.push(next);
      await drive(() => null, () => host.session.getSnapshot()!.roomCleared === true);
      await vi.waitFor(() => expect(floorOf(guest.session)).toMatchObject({ roomId: next, doorsLocked: false }));
    }
    expect(sealedRooms).toContain(plan.exitId);
    const visited = (session: RemoteSession) => floorOf(session)!.map.filter((room) => room.state === 'visited').map((room) => room.roomId);
    expect(visited(guest.session)).toEqual(['r00', ...path].sort());
    expect(visited(host.session)).toEqual(visited(guest.session));
    // Both clients saw the same three door crossings, in the same order.
    const crossings = (events: GameEvent[]) => events.flatMap((event) => event.type === 'room_entered' ? [event.floorRoomId] : []);
    expect(crossings(guest.events)).toEqual(['r00', ...path]);
    expect(crossings(host.events)).toEqual(crossings(guest.events));

    // The choice site sits on the exit room's focus; the host opens it with F.
    const focus = roomOf(host.session).focus!;
    await drive(() => tileToWorld(focus.x, focus.y), () => floorOf(host.session)?.biomeChoice != null, true);
    await vi.waitFor(() => expect(floorOf(guest.session)?.biomeChoice).toMatchObject({ hostPlayerId: 'host', chosenBiomeId: null }));
    const options = floorOf(guest.session)!.biomeChoice!.options;
    expect(options).toEqual(world.floors!.route.tiers[1]);

    guest.session.chooseBiome(options[1]!);
    await vi.waitFor(() => expect(floorOf(host.session)?.biomeChoice?.votes).toEqual({ guest: options[1] }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(floorOf(host.session)).toMatchObject({ biomeId: plan.biomeId, tier: 0 }); // a guest vote moves nobody

    host.session.chooseBiome(options[0]!);
    await vi.waitFor(() => {
      expect(floorOf(guest.session)).toMatchObject({ biomeId: options[0], roomId: 'r00', tier: 1, biomeChoice: null });
      expect(floorOf(host.session)).toEqual(floorOf(guest.session));
    }, { timeout: 3000, interval: 20 });
    expect(guest.events.filter((event) => event.type === 'biome_entered').at(-1)).toMatchObject({ biomeId: options[0], chosenByPlayerId: 'host' });

    // Host succession and a late join both land on the current ref: it rides in every snapshot.
    host.session.dispose();
    await vi.waitFor(() => expect(guest.session.getIsHost()).toBe(true));
    const late = join(url, 'late');
    await late.session.start();
    await vi.waitFor(() => expect(floorOf(late.session)).toMatchObject({ biomeId: options[0], roomId: 'r00', tier: 1, path: [plan.biomeId, options[0]] }));
    expect(late.session.getWorld()?.floors).toEqual(world.floors);
  }, 120_000);
});
