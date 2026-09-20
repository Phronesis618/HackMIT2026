/**
 * Floors mode on the server (F1b): off by default and byte-identical to before; on via
 * RELAY_FLOORS / the service option / a per-request override. No real provider calls.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreparedWorldSchema, WorldFixtureSchema, type GenerationRequest, type PreparedWorld } from '../../src/shared/contracts';
import { createWorldFloorRuntime } from '../../src/shared/floorgen';
import { sampleContributions } from '../../src/shared/samples';
import { createRelayServer, type RelayServer } from '../../src/server/app';
import { loadServerConfig } from '../../src/server/config';
import { createGenerationService, upgradeToFloors } from '../../src/server/generation';
import { parseWorldPrefix } from '../../src/client/transport/worldProviders';
import fixtureJson from '../../fixtures/worlds/root-archive.json';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');
const request: GenerationRequest = { requestId: 'floors-req', sessionId: 'floors-session', contributions: sampleContributions, plannedRoomCount: 3, seed: 5 };
const base = { mode: 'fixture' as const, openaiApiKey: null, openaiModel: 'unset', fixturesDir, log: () => {} };
const stable = (world: PreparedWorld) => ({ ...world, createdAt: 0, provenance: { ...world.provenance, generatedAt: 0, durationMs: 0 } });
const collect = async (stream: AsyncIterable<PreparedWorld>) => { const worlds: PreparedWorld[] = []; for await (const world of stream) worlds.push(world); return worlds; };

afterEach(() => vi.useRealTimers());

describe('floors generation path', () => {
  it('is off by default: output is identical to a service that has never heard of floors', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const plain = await createGenerationService(base).prepareWorld(request);
    const flagOff = await createGenerationService({ ...base, floors: false }).prepareWorld(request);
    const optedOut = await createGenerationService({ ...base, floors: true }).prepareWorld({ ...request, floors: false });
    expect(JSON.stringify(flagOff)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(optedOut)).toBe(JSON.stringify(plain));
    expect('floors' in plain).toBe(false);
    expect(plain.rooms).toHaveLength(3);
    expect(loadServerConfig({ env: {}, argv: [] }).generation.floors).toBe(false);
    expect(loadServerConfig({ env: { RELAY_FLOORS: '1' }, argv: [] }).generation.floors).toBe(true);
  });

  it('attaches floors with the flag or the request override, keeping honest fixture provenance', async () => {
    const byFlag = await createGenerationService({ ...base, floors: true }).prepareWorld(request);
    const byRequest = await createGenerationService(base).prepareWorld({ ...request, floors: true });
    expect(stable(byRequest)).toEqual(stable(byFlag));
    const world = PreparedWorldSchema.parse(byFlag);
    expect(world.floors).toMatchObject({ seed: '5' });
    expect(world.floors!.briefs).toHaveLength(8);
    expect(world.rooms).toHaveLength(1);
    expect(world.plannedRoomCount).toBe(1);
    expect(world.provenance.source).toBe('fixture');
    expect(world.receipt.lines.every((line) => !line.used)).toBe(true);
    expect(world.rooms[0]).toEqual(createWorldFloorRuntime(world).getRoom(createWorldFloorRuntime(world).entranceRef()));
    // The client accepts it for a request that asked for 3 legacy rooms.
    expect(() => parseWorldPrefix(JSON.parse(JSON.stringify(world)), request)).not.toThrow();
    // Without a numeric seed the world id seeds the floors.
    const unseeded = await createGenerationService({ ...base, floors: true }).prepareWorld({ ...request, seed: undefined });
    expect(unseeded.floors!.seed).toBe(unseeded.worldId);
  });

  it('streams exactly one complete world in floors mode and three prefixes without it', async () => {
    const service = createGenerationService({ ...base, floors: true });
    const worlds = await collect(service.prepareWorldStream(request));
    expect(worlds).toHaveLength(1);
    expect(worlds[0]!.rooms).toHaveLength(worlds[0]!.plannedRoomCount);
    expect(await collect(service.prepareWorldStream({ ...request, floors: false }))).toHaveLength(1); // fixture service commits all rooms at once
  });

  it('upgrades a live world from a stub provider, using model-written biomes when the recipe has them', async () => {
    const fixture = WorldFixtureSchema.parse(fixtureJson);
    const provider = { generate: async () => ({ recipe: { ...fixture.recipe, contributionMappings: [] } }) };
    const live = createGenerationService({ ...base, mode: 'live', floors: true, recipeProvider: { provider, model: 'stub' } });
    const worlds = await collect(live.prepareWorldStream(request));
    expect(worlds).toHaveLength(1);
    expect(worlds[0]!.provenance.source).toBe('live');
    expect(worlds[0]!.floors!.briefs[0]!.name).toBe(fixture.recipe.rooms[0]!.name);
    expect(() => parseWorldPrefix(JSON.parse(JSON.stringify(worlds[0])), request)).not.toThrow();

    const legacy = await createGenerationService(base).prepareWorld(request);
    const biomes = worlds[0]!.floors!.briefs.map((brief, i) => ({ ...brief, id: `model-${i}`, name: `Model biome ${i}` }));
    const upgraded = upgradeToFloors({ ...legacy, recipe: { ...legacy.recipe, biomes } }, 'seed');
    expect(upgraded.floors!.briefs).toEqual(biomes);
    expect(upgraded.rooms[0]!.biomeId).toBe('model-0');
    expect(upgradeToFloors(upgraded, 'seed')).toEqual(upgraded);
  });
});

describe('POST /api/world in floors mode', () => {
  let server: RelayServer | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });

  it('serves a floors world as JSON and as a one-record NDJSON stream', async () => {
    const config = loadServerConfig({ env: { NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', RELAY_FLOORS: '1' }, argv: [] });
    server = createRelayServer(config, { log: () => {} });
    const { port } = await server.listen();
    const post = (accept: string) => fetch(`http://127.0.0.1:${port}/api/world`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept }, body: JSON.stringify(request),
    });
    const json = PreparedWorldSchema.parse(await (await post('application/json')).json());
    expect(json.floors?.briefs).toHaveLength(8);
    const records = (await (await post('application/x-ndjson')).text()).trim().split('\n').map((line) => JSON.parse(line) as { type: string });
    expect(records.filter((record) => record.type === 'world')).toHaveLength(1);
    expect(records.some((record) => record.type === 'error')).toBe(false);
  });
});
