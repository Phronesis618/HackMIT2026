import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { RemoteSession } from '../../src/client/transport/RemoteSession';
import { fixtureWorldProvider } from '../../src/client/transport/worldProviders';
import { attachRealtime, type RealtimeOptions } from '../../src/server/network/realtime';
import { decodeServerMessage, encodeMessage } from '../../src/shared/protocol';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serve(options: RealtimeOptions = {}) {
  const server = createServer();
  const realtime = attachRealtime(server, { ...options, log: () => {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  cleanups.push(async () => {
    await realtime.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return `ws://127.0.0.1:${address.port}/ws`;
}

async function join(url: string, id: string) {
  const sockets: WebSocket[] = [];
  const session = new RemoteSession({
    identity: { id, displayName: id, classId: 'bastion' }, url, reconnect: false,
    createSocket: (address) => {
      const socket = new WebSocket(address);
      sockets.push(socket);
      return socket as unknown as globalThis.WebSocket;
    },
  });
  cleanups.push(() => session.dispose());
  await session.start();
  return {
    session,
    async settled() {
      const socket = sockets.at(-1)!;
      const pong = new Promise<void>((resolve) => {
        const receive = (raw: WebSocket.RawData) => {
          if (decodeServerMessage(raw.toString())?.type !== 'pong') return;
          socket.off('message', receive);
          resolve();
        };
        socket.on('message', receive);
      });
      socket.send(encodeMessage({ type: 'ping', sentAt: Date.now() }));
      await pong;
    },
  };
}

describe('co-op identity edits awaiting acknowledgement', () => {
  it.each(['name then class', 'class then name'] as const)('preserves both edits: %s', async (order) => {
    const url = await serve();
    const host = await join(url, 'host');
    const guest = await join(url, 'guest');
    const rename = () => guest.session.setDisplayName('New Pilot');
    const reclass = () => guest.session.setClass('weaver');
    if (order === 'name then class') {
      rename();
      reclass();
    } else {
      reclass();
      rename();
    }
    expect(guest.session.getLocalPlayer()).toEqual({ id: 'guest', displayName: 'guest', classId: 'bastion' });
    await guest.settled();
    await host.settled();
    const expected = { id: 'guest', displayName: 'New Pilot', classId: 'weaver' };
    await vi.waitFor(() => {
      expect(guest.session.getLocalPlayer()).toEqual(expected);
      expect(host.session.getLobby()?.players.find((player) => player.identity.id === 'guest')?.identity).toEqual(expected);
      expect(host.session.getSnapshot()?.players.find((player) => player.id === 'guest')).toMatchObject(expected);
    });
    const contribution = guest.session.submitContribution('A bright archive');
    await guest.settled();
    await host.settled();
    expect(host.session.getContributions()).toEqual([expect.objectContaining({
      id: contribution?.id, playerId: 'guest', playerName: 'New Pilot',
    })]);
  });

  it('keeps repeated edits and the following contribution in command order', async () => {
    const guest = await join(await serve(), 'guest');
    guest.session.setDisplayName('First');
    guest.session.setDisplayName('First');
    guest.session.setClass('weaver');
    guest.session.setDisplayName('guest');
    guest.session.setClass('bastion');
    guest.session.setClass('shade');
    guest.session.setDisplayName('Last');
    guest.session.submitContribution('A quiet archive');
    await guest.settled();
    expect(guest.session.getLocalPlayer()).toEqual({ id: 'guest', displayName: 'Last', classId: 'shade' });
    expect(guest.session.getContributions()[0]?.playerName).toBe('Last');
    guest.session.setClass('beacon');
    await guest.settled();
    expect(guest.session.getLocalPlayer()).toEqual({ id: 'guest', displayName: 'Last', classId: 'beacon' });
  });

  it('commits edits before portal entry and recovers after forbidden expedition class edits', async () => {
    const host = await join(await serve({
      generation: { prepareWorld: (request) => fixtureWorldProvider.prepareWorld(request) },
    }), 'host');
    const errors: string[] = [];
    host.session.onError((message) => errors.push(message));
    await host.session.requestWorld();
    expect(host.session.getWorld()?.provenance.source).toBe('fixture');
    host.session.setDisplayName('Explorer');
    host.session.setClass('weaver');
    host.session.enterPortal();
    await host.settled();
    expect(errors).toEqual([]);
    expect(host.session.getPhase()).toBe('expedition');
    expect(host.session.getSnapshot()?.players[0]).toMatchObject({
      displayName: 'Explorer', classId: 'weaver',
    });
    host.session.setClass('shade');
    host.session.setDisplayName('Rejected');
    await host.settled();
    expect(errors).toEqual(['Change class at headquarters.', 'Change class at headquarters.']);
    expect(host.session.getLocalPlayer()).toMatchObject({ displayName: 'Explorer', classId: 'weaver' });
    host.session.setDisplayName('Still Explorer');
    await host.settled();
    expect(host.session.getLocalPlayer()).toMatchObject({ displayName: 'Still Explorer', classId: 'weaver' });
    host.session.returnToHeadquarters();
    await host.settled();
    host.session.setClass('shade');
    await host.settled();
    expect(host.session.getLocalPlayer()).toMatchObject({ displayName: 'Still Explorer', classId: 'shade' });
  });
});
