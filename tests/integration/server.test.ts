/**
 * Integration: real HTTP server on an ephemeral port, no credentials, no network beyond
 * localhost. Proves the client-facing contract end to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PreparedWorldSchema } from '../../src/shared/contracts';
import { decodeServerMessage, encodeMessage, PROTOCOL_VERSION } from '../../src/shared/protocol';
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
  it('answers hello with welcome and ping with pong; rejects invalid messages', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const next = () =>
      new Promise<ReturnType<typeof decodeServerMessage>>((resolve) => ws.once('message', (d) => resolve(decodeServerMessage(d.toString()))));

    ws.send(encodeMessage({ type: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: 'test-player-ws', displayName: 'WS Tester', classId: 'shade' }));
    const welcome = await next();
    expect(welcome).toMatchObject({ type: 'welcome', playerId: 'test-player-ws', isHost: true });

    ws.send(encodeMessage({ type: 'ping', sentAt: 123 }));
    expect(await next()).toMatchObject({ type: 'pong', sentAt: 123 });

    ws.send('garbage');
    expect(await next()).toMatchObject({ type: 'error' });

    ws.send(encodeMessage({ type: 'request_world' }));
    const notImpl = await next();
    expect(notImpl?.type).toBe('error');

    ws.close();
  });
});

describe('LocalSession against the real server', () => {
  it('requests a world, enters the portal, transitions rooms and emits chronicle-worthy events', async () => {
    const provider: WorldProvider = {
      kind: 'server',
      async prepareWorld(request) {
        const res = await fetch(`${base}/api/world`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
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

    // Walk east to the exit of room 0 (row 5, col 23) by feeding intents and advancing time.
    const exit = world.rooms[0]!.exits[0]!;
    for (let i = 0; i < 2000 && session.getSnapshot()?.roomIndex === 0; i++) {
      const me = session.getSnapshot()!.players[0]!;
      const tx = exit.x * 32 + 16;
      const ty = exit.y * 32 + 16;
      const dx = tx - me.x;
      const dy = ty - me.y;
      const len = Math.hypot(dx, dy) || 1;
      session.setIntent({ moveX: dx / len, moveY: dy / len, aimX: tx, aimY: ty, attack: false, dash: false, ability: null });
      session.advance(1000 / 60);
    }
    expect(session.getSnapshot()?.roomIndex).toBe(1);
    expect(events).toEqual(expect.arrayContaining(['contribution_submitted', 'world_prepared', 'room_entered', 'exit_reached']));

    session.returnToHeadquarters();
    expect(session.getPhase()).toBe('headquarters');
    session.dispose();
  });
});
