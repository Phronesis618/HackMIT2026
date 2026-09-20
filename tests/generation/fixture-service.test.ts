/**
 * Generation tests — Agent B extends this folder. Rule: NO real provider calls. Stub the
 * provider/fetch and assert on validated output + honest provenance.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PreparedWorldSchema, type GenerationRequest, type GenerationStatus } from '../../src/shared/contracts';
import { createGenerationService } from '../../src/server/generation';
import { loadWorldFixtures, prepareFromFixture } from '../../src/server/generation/fixtureService';
import { buildReceipt } from '../../src/server/generation/receipt';
import { sampleContributions } from '../../src/shared/samples';

const fixturesDir = path.resolve(__dirname, '../../fixtures/worlds');

const request: GenerationRequest = {
  requestId: 'test-req-1',
  sessionId: 'test-session',
  contributions: sampleContributions,
  plannedRoomCount: 3,
};

describe('fixture generation service', () => {
  it('loads and validates every fixture on disk', () => {
    const fixtures = loadWorldFixtures(fixturesDir);
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures.map((f) => f.fixtureId)).toContain('vantage-spire');
  });

  it('returns a validated PreparedWorld labelled as an offline fixture', async () => {
    const service = createGenerationService({ mode: 'fixture', openaiApiKey: null, openaiModel: 'unset', fixturesDir, log: () => {} });
    const statuses: GenerationStatus[] = [];
    const world = await service.prepareWorld(request, (s) => statuses.push(s));

    expect(PreparedWorldSchema.safeParse(world).success).toBe(true);
    expect(world.provenance.source).toBe('fixture');
    expect(world.provenance.label).toMatch(/FIXTURE/);
    expect(world.provenance.attempts).toBe(0);
    expect(world.rooms.length).toBe(world.plannedRoomCount);
    expect(statuses.map((s) => s.phase)).toEqual(['queued', 'validating', 'ready']);
    expect(service.info()).toMatchObject({ requestedMode: 'fixture', effectiveMode: 'fixture', liveImplemented: true, liveConfigured: false });
  });

  it('records contributions in the receipt without claiming they were used', async () => {
    const service = createGenerationService({ mode: 'fixture', openaiApiKey: null, openaiModel: 'unset', fixturesDir, log: () => {} });
    const world = await service.prepareWorld(request);
    expect(world.receipt.source).toBe('fixture');
    expect(world.receipt.lines.length).toBe(sampleContributions.length);
    for (const line of world.receipt.lines) {
      expect(line.used).toBe(false);
      expect(line.featureDescription).toBeNull();
    }
    expect(world.receipt.headline).toMatch(/did not shape/);
  });

  it('is deterministic for the same requestId', async () => {
    const service = createGenerationService({ mode: 'fixture', openaiApiKey: null, openaiModel: 'unset', fixturesDir, log: () => {} });
    const a = await service.prepareWorld(request);
    const b = await service.prepareWorld(request);
    expect(a.worldId).toBe(b.worldId);
    expect(a.rooms).toEqual(b.rooms);
  });

  it('live mode without a key still serves a fixture and says why', async () => {
    const logs: string[] = [];
    const service = createGenerationService({ mode: 'live', openaiApiKey: null, openaiModel: 'gpt-test', fixturesDir, log: (m) => logs.push(m) });
    const world = await service.prepareWorld(request);
    expect(world.provenance.source).toBe('fixture');
    expect(world.provenance.notes.join(' ')).toMatch(/OPENAI_API_KEY/);
    expect(logs.join(' ')).toMatch(/OPENAI_API_KEY/);
    expect(service.info().liveConfigured).toBe(false);
  });

  it('live mode with a key attempts the provider and labels a failing response as fallback', async () => {
    const service = createGenerationService({
      mode: 'live', openaiApiKey: 'test-key-not-real', openaiModel: 'gpt-test', fixturesDir, log: () => {},
      fetch: async () => new Response(null, { status: 503 }),
    });
    const world = await service.prepareWorld(request);
    expect(world.provenance.source).toBe('live_fallback_fixture');
    expect(world.provenance.notes.join(' ')).toMatch(/HTTP 503/);
    expect(service.info()).toMatchObject({ liveConfigured: true, liveImplemented: true, effectiveMode: 'live' });
  });

  it('prepareFromFixture supports the live-fallback provenance path', () => {
    const [fixture] = loadWorldFixtures(fixturesDir);
    const world = prepareFromFixture({
      fixture: fixture!,
      request,
      source: 'live_fallback_fixture',
      attempts: 2,
      startedAt: Date.now() - 1234,
      notes: ['provider timeout after 25000ms'],
      model: 'gpt-test',
    });
    expect(world.provenance.source).toBe('live_fallback_fixture');
    expect(world.provenance.label).toMatch(/FALLBACK/);
    expect(world.provenance.attempts).toBe(2);
    expect(world.provenance.model).toBe('gpt-test');
    expect(world.provenance.durationMs).toBeGreaterThanOrEqual(1234);
    expect(world.receipt.headline).toMatch(/Live generation failed/);
  });

  it('rejects an invalid request body', async () => {
    const service = createGenerationService({ mode: 'fixture', openaiApiKey: null, openaiModel: 'unset', fixturesDir, log: () => {} });
    await expect(service.prepareWorld({ ...request, requestId: 'has spaces!' })).rejects.toThrow();
  });
});

describe('buildReceipt', () => {
  it('marks lines used only when a mapping exists and the source is live', () => {
    const receipt = buildReceipt({
      worldTitle: 'Test World',
      source: 'live',
      contributions: sampleContributions,
      mappings: [{ contributionId: sampleContributions[0]!.id, kind: 'prop', featureDescription: 'luggage crates on the platform', roomIndex: 0 }],
    });
    expect(receipt.lines[0]).toMatchObject({ used: true, featureDescription: 'luggage crates on the platform' });
    expect(receipt.lines[1]).toMatchObject({ used: false, featureDescription: null });
    expect(receipt.headline).toMatch(/1 shaped/);
  });

  it('never marks fixture receipts as used even if mappings are passed', () => {
    const receipt = buildReceipt({
      worldTitle: 'Test World',
      source: 'fixture',
      contributions: sampleContributions,
      mappings: [{ contributionId: sampleContributions[0]!.id, kind: 'prop', featureDescription: 'x', roomIndex: 0 }],
    });
    expect(receipt.lines.every((l) => !l.used)).toBe(true);
  });
});
