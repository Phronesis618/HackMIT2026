/**
 * Integration: real HTTP server on an ephemeral port, no credentials, no network beyond
 * localhost. Proves the client-facing contract end to end.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PreparedWorldSchema } from '../../src/shared/contracts';
import { decodeServerMessage, encodeMessage, PROTOCOL_VERSION, type ServerMessage } from '../../src/shared/protocol';
import { ABILITY_UNLOCK_COST, PLAYER_RADIUS, ROOM_CLEAR_REWARD, TICK_MS, tileToWorld } from '../../src/shared/conventions';
import { buildSolidGrid } from '../../src/sim/collision';
import { chaseWaypoint } from '../../src/sim/combat';
import { createRelayServer, type RelayServer } from '../../src/server/app';
import { loadServerConfig } from '../../src/server/config';
import { sampleContributions } from '../../src/shared/samples';
import { LocalSession } from '../../src/client/transport/LocalSession';
import type { WorldProvider } from '../../src/client/transport/worldProviders';

let server: RelayServer;
let base = '';

beforeAll(async () => {
  const config = loadServerConfig({ env: { NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1' }, argv: [] });
  server = createRelayServer(config, { log: () => {} });
  const { port } = await server.listen();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('HTTP API', () => {
  it('GET /api/health reports fixture mode without credentials', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; generation: { effectiveMode: string; liveConfigured: boolean } };
    expect(body.ok).toBe(true);
    expect(body.generation.effectiveMode).toBe('fixture');
    expect(body.generation.liveConfigured).toBe(false);
  });

  it('GET /api/config never leaks secrets', async () => {
    const res = await fetch(`${base}/api/config`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ generationMode: 'fixture', liveGenerationAvailable: false });
    expect(text).not.toMatch(/OPENAI|key/i);
  });

  it('POST /api/world returns a validated PreparedWorld labelled as a fixture', async () => {
    const res = await fetch(`${base}/api/world`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'test-req-http', sessionId: 'test-session', contributions: sampleContributions, plannedRoomCount: 3 }),
    });
    expect(res.status).toBe(200);
    const parsed = PreparedWorldSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.provenance.source).toBe('fixture');
      expect(parsed.data.receipt.lines).toHaveLength(sampleContributions.length);
    }
  });

  it('POST /api/world rejects invalid bodies with 400', async () => {
    const bad = await fetch(`${base}/api/world`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nope":true}' });
    expect(bad.status).toBe(400);
    const notJson = await fetch(`${base}/api/world`, { method: 'POST', body: 'not json' });
    expect(notJson.status).toBe(400);
  });

  it('unknown API routes are 404 JSON; non-API GET explains the missing bundle', async () => {
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
    const root = await fetch(`${base}/`);
    // Either the built bundle (if dist/client exists locally) or a helpful 404.
    expect([200, 404]).toContain(root.status);
  });
});

describe('WebSocket /ws', () => {
  it('answers hello/ping, rejects invalid messages and prepares a world for the host', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const messages: ServerMessage[] = [];
    const invalid: string[] = [];
    ws.on('message', (raw) => {
      const message = decodeServerMessage(raw.toString());
      if (message) messages.push(message);
      else invalid.push(raw.toString());
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const next = <T extends ServerMessage['type']>(type: T) => vi.waitFor(() => {
      expect(invalid).toEqual([]);
      const index = messages.findIndex((message) => message.type === type);
      expect(index, `waiting for ${type}`).toBeGreaterThanOrEqual(0);
      return messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
    });

    try {
      ws.send(encodeMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'test-player-ws', displayName: 'WS Tester', classId: 'shade' }));
      const welcome = await next('welcome');
      expect(welcome).toMatchObject({ type: 'welcome', playerId: 'test-player-ws', isHost: true });

      ws.send(encodeMessage({ type: 'ping', sentAt: 123 }));
      expect(await next('pong')).toMatchObject({ type: 'pong', sentAt: 123 });

      ws.send('garbage');
      expect(await next('error')).toMatchObject({ type: 'error' });

      ws.send(encodeMessage({ type: 'request_world', requestId: 'test-ws-world' }));
      const prepared = await next('world');
      expect(prepared.requestId).toBe('test-ws-world');
      expect(prepared.world.provenance.source).toBe('fixture');
      expect(prepared.world.rooms.length).toBeGreaterThan(0);
      expect((await next('events')).events).toContainEqual(expect.objectContaining({ type: 'world_prepared', worldId: prepared.world.worldId }));
    } finally {
      ws.close();
    }
  });
});

describe('LocalSession against the real server', () => {
  it('requests a world, enters the portal, transitions rooms and emits chronicle-worthy events', async () => {
    const provider: WorldProvider = {
      kind: 'server',
      async prepareWorld(request) {
        const res = await fetch(`${base}/api/world`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, seed: 2 }) });
        return PreparedWorldSchema.parse(await res.json());
      },
    };
    const session = new LocalSession({
      identity: { id: 'test-local', displayName: 'Local Tester', classId: 'bastion' },
      worldProvider: provider,
      // No real timer: the test drives time with session.advance().
      scheduler: { setInterval: (() => 0) as unknown as typeof setInterval, clearInterval: () => {}, now: () => 0 },
    });
    const events: string[] = [];
    session.onEvents((batch) => events.push(...batch.map((e) => e.type)));
    await session.start();

    expect(session.submitContribution('a drowned observatory')).not.toBeNull();
    const world = await session.requestWorld();
    expect(world.provenance.source).toBe('fixture');
    expect(session.getGenerationStatus().phase).toBe('fallback');

    session.enterPortal();
    expect(session.getPhase()).toBe('expedition');
    expect(session.getSnapshot()?.roomIndex).toBe(0);

    session.enterRoomIndex(1);
    expect(session.getSnapshot()?.roomIndex).toBe(0);
    const grid = buildSolidGrid(world.rooms[0]!);
    for (let i = 0; i < 3600 && !session.getSnapshot()?.roomCleared && session.getPhase() === 'expedition'; i++) {
      const snapshot = session.getSnapshot()!;
      const me = snapshot.players.find((player) => player.id === session.localPlayerId)!;
      const enemy = snapshot.enemies.filter((candidate) => candidate.hp > 0)
        .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (!enemy) break;
      const target = chaseWaypoint(grid, me, enemy, PLAYER_RADIUS);
      const length = Math.hypot(target.x - me.x, target.y - me.y) || 1;
      const moving = Math.hypot(enemy.x - me.x, enemy.y - me.y) > 40;
      session.setIntent({
        moveX: moving ? (target.x - me.x) / length : 0,
        moveY: moving ? (target.y - me.y) / length : 0,
        aimX: enemy.x, aimY: enemy.y, attack: true, dash: false,
        ability: me.abilityQCooldownMs === 0 ? 'q' : null,
      });
      session.advance(TICK_MS);
    }
    expect(session.getSnapshot()?.roomCleared).toBe(true);
    expect(session.getSnapshot()?.players[0]?.resources).toBe(ABILITY_UNLOCK_COST + ROOM_CLEAR_REWARD);
    const exit = world.rooms[0]!.exits[0]!;
    for (let i = 0; i < 2000 && session.getSnapshot()?.roomIndex === 0; i++) {
      const me = session.getSnapshot()!.players[0]!;
      const { x: tx, y: ty } = chaseWaypoint(grid, me, tileToWorld(exit.x, exit.y), PLAYER_RADIUS);
      const dx = tx - me.x;
      const dy = ty - me.y;
      const len = Math.hypot(dx, dy) || 1;
      session.setIntent({ moveX: dx / len, moveY: dy / len, aimX: tx, aimY: ty, attack: false, dash: false, ability: null });
      session.advance(TICK_MS);
    }
    expect(session.getSnapshot()?.roomIndex).toBe(1);
    expect(events).toEqual(expect.arrayContaining(['contribution_submitted', 'world_prepared', 'room_entered', 'enemy_defeated', 'room_cleared', 'exit_reached']));

    session.returnToHeadquarters();
    expect(session.getPhase()).toBe('headquarters');
    expect(events).toContain('run_ended');
    session.dispose();
  });
});
