import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { RemoteSession, type RemoteSessionOptions } from '../../src/client/transport/RemoteSession';
import { createGenerationService } from '../../src/server/generation';
import { attachRealtime, type RealtimeOptions } from '../../src/server/network/realtime';
import { PreparedWorldSchema, type GameEvent, type PreparedWorld } from '../../src/shared/contracts';
import {
  PROTOCOL_VERSION, decodeServerMessage, encodeMessage, type ClientMessage, type ServerMessage,
} from '../../src/shared/protocol';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const fixtureService = createGenerationService({
  mode: 'fixture', openaiApiKey: null, openaiModel: 'unused',
  fixturesDir: path.resolve(__dirname, '../../fixtures/worlds'), log: () => {},
});

async function serve(options: RealtimeOptions = {}) {
  const http = createServer();
  const realtime = attachRealtime(http, { ...options, log: () => {} });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const close = async () => {
    await realtime.close();
    if (http.listening) await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  };
  cleanups.push(close);
  return { url: `ws://127.0.0.1:${address.port}/ws`, realtime, http, close };
}

class Peer {
  readonly socket: WebSocket;
  readonly history: ServerMessage[] = [];
  private readonly queue: ServerMessage[] = [];
  private readonly invalid: string[] = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => {
      const message = decodeServerMessage(raw.toString());
      if (message) {
        this.history.push(message);
        this.queue.push(message);
      } else this.invalid.push(raw.toString());
    });
  }

  async open(): Promise<this> {
    await once(this.socket, 'open');
    return this;
  }

  send(message: ClientMessage): void { this.socket.send(encodeMessage(message)); }

  async next<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return vi.waitFor(() => {
      expect(this.invalid).toEqual([]);
      const index = this.queue.findIndex((message) => message.type === type
        && predicate(message as Extract<ServerMessage, { type: T }>));
      expect(index, `waiting for ${type}`).toBeGreaterThanOrEqual(0);
      return this.queue.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
    }, { timeout: 3000, interval: 10 });
  }

  hello(playerId: string | null, extra: Partial<Extract<ClientMessage, { type: 'hello' }>> = {}) {
    this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, playerId, displayName: 'Test Pilot', classId: 'bastion', ...extra });
    return this.next('welcome');
  }

  events(): GameEvent[] {
    return this.history.flatMap((message) => message.type === 'events' ? message.events : []);
  }

  async close(): Promise<void> {
    this.socket.close();
    if (this.socket.readyState !== WebSocket.CLOSED) await once(this.socket, 'close');
  }
}

function remote(url: string, id: string, options: Partial<RemoteSessionOptions> = {}): RemoteSession {
  const session = new RemoteSession({
    identity: { id, displayName: id, classId: 'bastion' }, url, reconnect: false,
    createSocket: (address) => new WebSocket(address) as unknown as globalThis.WebSocket,
    ...options,
  });
  cleanups.push(() => session.dispose());
  return session;
}

function intent(playerId: string, seq: number, moveX = 0, moveY = 0, attack = false): ClientMessage {
  return { type: 'intent', intent: { playerId, seq, moveX, moveY, aimX: 1000, aimY: 80, attack, dash: false, ability: null } };
}

async function compactWorld(): Promise<PreparedWorld> {
  const world = await fixtureService.prepareWorld({ requestId: 'fixture-request', sessionId: 'test-session', contributions: [], plannedRoomCount: 3 });
  return PreparedWorldSchema.parse({
    ...world,
    rooms: world.rooms.map((room) => ({
      ...room, width: 8, height: 6, props: [], encounters: [], attributions: [],
      tiles: ['########', '#......#', '#.P....#', room.isFinal ? '#...A..#' : '#XX....#', '#......#', '########'],
      exits: room.isFinal ? [] : [1, 2].map((x) => ({ x, y: 3, toRoomIndex: room.index + 1, direction: 'south' })),
    })),
  });
}

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  cleanups.push(release);
  return { promise, release };
}

describe('authoritative realtime room', () => {
  it('requires hello, enforces unique membership and four seats, rejects forged or replayed intents', async () => {
    const server = await serve();
    const host = await new Peer(server.url).open();
    host.send({ type: 'ping', sentAt: 1 });
    expect(await host.next('error')).toMatchObject({ action: 'ping', message: expect.stringContaining('hello') });
    host.socket.send('not json');
    expect(await host.next('error')).toMatchObject({ message: expect.stringContaining('validation') });
    const welcome = await host.hello('shared-id');
    expect(welcome).toMatchObject({ isHost: true, playerId: 'shared-id', snapshot: { phase: 'headquarters' } });
    const guest = await new Peer(server.url).open();
    const second = await guest.hello('shared-id');
    expect(second.playerId).not.toBe(welcome.playerId);
    expect(second.lobby.players).toHaveLength(2);
    expect(second.isHost).toBe(false);
    expect(JSON.stringify(second.lobby)).not.toContain(welcome.resumeToken);

    guest.send(intent(welcome.playerId, 1, 1));
    expect(await guest.next('error')).toMatchObject({ action: 'intent', message: expect.stringContaining('ownership') });
    guest.send(intent(second.playerId, 2, 0, 0, true));
    await guest.next('events', (message) => message.events.some((event) => event.type === 'player_attacked' && event.playerId === second.playerId));
    guest.send(intent(second.playerId, 2, 1));
    expect(await guest.next('error')).toMatchObject({ action: 'intent', message: expect.stringContaining('sequence') });

    const attacker = await new Peer(server.url).open();
    attacker.send({
      type: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: welcome.playerId,
      displayName: 'Forged', classId: 'shade', resumeToken: 'not-the-resume-token',
    });
    expect(await attacker.next('error')).toMatchObject({ action: 'hello', message: expect.stringContaining('rejected') });
    for (let index = 0; index < 2; index++) {
      const peer = await new Peer(server.url).open();
      await peer.hello(null);
    }
    const fifth = await new Peer(server.url).open();
    fifth.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: null, displayName: 'Fifth', classId: 'beacon' });
    expect(await fifth.next('error')).toMatchObject({ action: 'hello', message: expect.stringContaining('full') });
    expect(server.realtime.clientCount()).toBe(4);
  });

  it('shares identity, contributions, immutable worlds, movement and ordered events with two clients', async () => {
    const server = await serve({ generation: { prepareWorld: fixtureService.prepareWorld } });
    const host = await new Peer(server.url).open();
    const guest = await new Peer(server.url).open();
    const first = await host.hello('host');
    const second = await guest.hello('guest');
    guest.send({ type: 'identity', displayName: 'Beacon Pilot', classId: 'beacon' });
    await host.next('lobby', (message) => message.lobby.players.some((player) => player.identity.displayName === 'Beacon Pilot'));
    guest.send({ type: 'contribution', text: 'An observatory above an electric sea', contributionId: 'guest-idea' });
    const contributed = await host.next('contributions');
    expect(contributed.contributions).toEqual([expect.objectContaining({
      playerId: second.playerId, playerName: 'Beacon Pilot', id: 'guest-idea',
    })]);
    expect(await guest.next('contributions')).toEqual(contributed);

    for (const type of ['request_world', 'enter_portal', 'return_to_hq'] as const) {
      guest.send({ type });
      expect(await guest.next('error')).toMatchObject({ action: type, message: expect.stringContaining('host') });
    }
    host.send({ type: 'request_world', requestId: 'shared-world-request' });
    const prepared = await host.next('world');
    expect(prepared.requestId).toBe('shared-world-request');
    expect(prepared.world.provenance.source).toBe('fixture');
    expect(await guest.next('world')).toEqual(prepared);
    host.send({ type: 'enter_portal' });
    const entry = await guest.next('snapshot', (message) => message.snapshot.phase === 'expedition');
    const before = entry.snapshot.players.find((player) => player.id === first.playerId)!;
    host.send(intent(first.playerId, 1, 1, 0, true));
    const moved = await host.next('snapshot', (message) => message.snapshot.players.some((player) => player.id === first.playerId && player.x > before.x));
    expect(await guest.next('snapshot', (message) => message.snapshot.tick === moved.snapshot.tick)).toEqual(moved);
    const attacked = await host.next('events', (message) => message.events.some((event) => event.type === 'player_attacked'));
    expect(await guest.next('events', (message) => message.eventSequence === attacked.eventSequence)).toEqual(attacked);
    expect(host.events().map((event) => event.type)).toEqual(expect.arrayContaining(['contribution_submitted', 'world_prepared', 'room_entered', 'player_attacked']));
    const sequences = host.history.filter((message) => message.type === 'events').map((message) => message.eventSequence);
    expect(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]!)).toBe(true);
    expect(new Set(host.events().map((event) => event.id)).size).toBe(host.events().length);
    host.send({ type: 'return_to_hq' });
    await guest.next('snapshot', (message) => message.snapshot.tick > entry.snapshot.tick && message.snapshot.phase === 'headquarters');
  });

  it('restores authoritative late-join and reconnect state, replays missed events, and elects a new host', async () => {
    const server = await serve({ generation: fixtureService });
    const host = await new Peer(server.url).open();
    const first = await host.hello('host');
    const guest = await new Peer(server.url).open();
    const second = await guest.hello('guest');
    const replayFrom = second.eventSequence;
    await guest.close();
    await host.next('lobby', (message) => message.lobby.players.some((player) => player.identity.id === 'guest' && !player.connected));
    host.send({ type: 'contribution', text: 'Glowing roots', contributionId: 'reconnect-idea' });
    await host.next('contributions');
    host.send({ type: 'request_world', requestId: 'recovery-world' });
    const world = await host.next('world');
    host.send({ type: 'enter_portal' });
    const entry = await host.next('snapshot', (message) => message.snapshot.phase === 'expedition');
    const resumed = await new Peer(server.url).open();
    const recovery = await resumed.hello(second.playerId, { resumeToken: second.resumeToken, lastEventSequence: replayFrom });
    expect(recovery.playerId).toBe(second.playerId);
    expect(recovery.world).toEqual(world.world);
    expect(recovery.contributions).toHaveLength(1);
    expect(recovery.snapshot).toMatchObject({ phase: 'expedition', roomId: entry.snapshot.roomId });
    expect(recovery.snapshot.players).toHaveLength(2);
    expect(recovery.events.map((event) => event.type)).toEqual(['contribution_submitted', 'world_prepared', 'room_entered']);
    expect(recovery.historyTruncated).toBe(false);
    const late = await new Peer(server.url).open();
    const joined = await late.hello('late');
    expect(joined.snapshot.phase).toBe('expedition');
    expect(joined.world).toEqual(world.world);
    expect(joined.snapshot.players).toHaveLength(3);
    expect(joined.events).toEqual([]);
    await host.close();
    await resumed.next('lobby', (message) => message.lobby.hostPlayerId === second.playerId);
    resumed.send({ type: 'return_to_hq' });
    await late.next('snapshot', (message) => message.snapshot.phase === 'headquarters');
    expect(first.resumeToken).not.toBe(second.resumeToken);
  });

  it('keeps a requested exit pending until its room commits, then moves the group once', async () => {
    const full = await compactWorld();
    const release = gate();
    const server = await serve({ generation: {
      prepareWorld: fixtureService.prepareWorld,
      async *prepareWorldStream() {
        yield { ...full, rooms: full.rooms.slice(0, 1) };
        await release.promise;
        yield full;
      },
    } });
    const host = await new Peer(server.url).open();
    const guest = await new Peer(server.url).open();
    await host.hello('host');
    await guest.hello('guest');
    host.send({ type: 'request_world', requestId: 'stream-exit' });
    await host.next('world');
    host.send({ type: 'enter_portal' });
    await host.next('snapshot', (message) => message.snapshot.phase === 'expedition');
    host.send(intent('host', 1, 0, 1));
    guest.send(intent('guest', 1, 0, 1));
    await host.next('generation_status', (message) => message.status.message.includes('Waiting for room'));
    const waiting = await guest.next('snapshot', (message) => message.snapshot.phase === 'expedition' && message.snapshot.players.some((player) => player.y >= 96));
    expect(waiting.snapshot.roomIndex).toBe(0);
    release.release();
    const next = await host.next('snapshot', (message) => message.snapshot.roomIndex === 1);
    expect(await guest.next('snapshot', (message) => message.snapshot.tick === next.snapshot.tick && message.snapshot.roomIndex === 1)).toEqual(next);
    await host.next('events', (message) => message.events.some((event) => event.type === 'room_entered' && event.roomIndex === 1));
    expect(host.events().filter((event) => event.type === 'room_entered' && event.roomIndex === 1)).toHaveLength(1);
    expect(host.events().filter((event) => event.type === 'world_prepared')).toHaveLength(1);
  });

  it('rejects changed committed prefixes while preserving the existing playable room', async () => {
    const full = await compactWorld();
    const release = gate();
    const server = await serve({ generation: {
      prepareWorld: fixtureService.prepareWorld,
      async *prepareWorldStream() {
        yield { ...full, rooms: full.rooms.slice(0, 1) };
        await release.promise;
        yield { ...full, rooms: [{ ...full.rooms[0]!, name: 'Changed committed room' }, ...full.rooms.slice(1)] };
      },
    } });
    const host = remote(server.url, 'host');
    const errors: string[] = [];
    host.onError((message) => errors.push(message));
    await host.start();
    const prefix = await host.requestWorld();
    expect(prefix.rooms).toHaveLength(1);
    host.enterPortal();
    await vi.waitFor(() => expect(host.getPhase()).toBe('expedition'));
    release.release();
    await vi.waitFor(() => expect(host.getGenerationStatus().phase).toBe('failed'));
    expect(host.getWorld()).toEqual(prefix);
    expect(host.getSnapshot()?.roomId).toBe(prefix.rooms[0]!.id);
    expect(errors).toContain('Generation attempted to replace committed rooms.');
  });
});

describe('RemoteSession over real sockets', () => {
  it('resolves the first prefix and applies later prefixes without resetting active players', async () => {
    const full = await compactWorld();
    const release = gate();
    const server = await serve({ generation: {
      prepareWorld: fixtureService.prepareWorld,
      async *prepareWorldStream() {
        yield { ...full, rooms: full.rooms.slice(0, 1) };
        await release.promise;
        yield full;
      },
    } });
    const host = remote(server.url, 'host');
    const guest = remote(server.url, 'guest');
    const worlds: PreparedWorld[] = [];
    const events: GameEvent[] = [];
    host.onWorld((world) => worlds.push(world));
    guest.onEvents((batch) => events.push(...batch));
    await host.start();
    await guest.start();
    expect(host.getIsHost()).toBe(true);
    expect(guest.getIsHost()).toBe(false);
    guest.setDisplayName('Shade Pilot');
    await vi.waitFor(() => expect(guest.getLocalPlayer().displayName).toBe('Shade Pilot'));
    guest.setClass('shade');
    await vi.waitFor(() => expect(guest.getLocalPlayer().classId).toBe('shade'));
    const submitted = guest.submitContribution('A branching lightning reef');
    expect(submitted).not.toBeNull();
    await vi.waitFor(() => expect(host.getContributions()[0]?.id).toBe(submitted?.id));
    const first = await host.requestWorld();
    expect(first.rooms).toHaveLength(1);
    host.enterPortal();
    await vi.waitFor(() => expect(guest.getPhase()).toBe('expedition'));
    host.setIntent({ moveX: 1, moveY: 0, aimX: 1000, aimY: 80, attack: true, dash: false, ability: null });
    await vi.waitFor(() => expect(host.getSnapshot()?.players[0]?.x).toBeGreaterThan(80));
    host.setIntent({ moveX: 0, moveY: 0, aimX: 1000, aimY: 80, attack: false, dash: false, ability: null });
    const beforeAppend = host.getSnapshot()!.players[0]!.x;
    release.release();
    await vi.waitFor(() => expect(guest.getWorld()?.rooms).toHaveLength(3));
    expect(host.getSnapshot()?.players[0]?.x).toBeGreaterThanOrEqual(beforeAppend);
    expect(host.getSnapshot()?.roomId).toBe(first.rooms[0]!.id);
    expect(worlds.map((world) => world.rooms.length)).toEqual([1, 3]);
    expect(events.filter((event) => event.type === 'world_prepared')).toHaveLength(1);
    expect(events.some((event) => event.type === 'player_attacked')).toBe(true);
    guest.returnToHeadquarters();
    const errors: string[] = [];
    guest.onError((message) => errors.push(message));
    await vi.waitFor(() => expect(errors.some((message) => message.includes('host'))).toBe(true));
    host.returnToHeadquarters();
    await vi.waitFor(() => expect(guest.getPhase()).toBe('headquarters'));
  });

  it('rejects unavailable generation, exposes server errors, and recovers identity after reconnect', async () => {
    const server = await serve();
    const sockets: WebSocket[] = [];
    const host = remote(server.url, 'host', {
      reconnect: true,
      createSocket: (address) => {
        const socket = new WebSocket(address);
        sockets.push(socket);
        return socket as unknown as globalThis.WebSocket;
      },
    });
    const guest = remote(server.url, 'guest');
    const errors: string[] = [];
    host.onError((message) => errors.push(message));
    await host.start();
    await guest.start();
    await expect(host.requestWorld()).rejects.toThrow('unavailable');
    expect(errors.some((message) => message.includes('generation'))).toBe(true);
    host.submitContribution('A remembered forest');
    await vi.waitFor(() => expect(guest.getContributions()).toHaveLength(1));
    const id = host.localPlayerId;
    sockets[0]!.terminate();
    await vi.waitFor(() => expect(guest.getIsHost()).toBe(true));
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 });
    await vi.waitFor(() => expect(host.getConnectionStatus()).toBe('connected'));
    expect(host.localPlayerId).toBe(id);
    expect(host.getContributions()).toHaveLength(1);
    expect(host.getLobby()?.players).toHaveLength(2);
    expect(host.getIsHost()).toBe(false);
  });

  it('rejects a failed connection and pending world requests when the server closes', async () => {
    const server = await serve();
    const address = server.url;
    await server.close();
    const failed = remote(address, 'failed');
    await expect(failed.start()).rejects.toThrow('connect');
    expect(failed.getConnectionStatus()).toBe('offline');

    const release = gate();
    let signal: AbortSignal | undefined;
    const running = await serve({ generation: {
      async prepareWorld(_request, _status, abort) {
        signal = abort;
        await release.promise;
        return compactWorld();
      },
    } });
    const session = remote(running.url, 'host');
    await session.start();
    const pending = session.requestWorld();
    const rejection = expect(pending).rejects.toThrow('Disconnected');
    await vi.waitFor(() => expect(signal).toBeDefined());
    await running.close();
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(running.http.listenerCount('upgrade')).toBe(0);
    expect(running.realtime.clientCount()).toBe(0);
  });
});
