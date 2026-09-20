/**
 * A6 — the server decides RELAY_LAWS / RELAY_FLOORS for the whole session.
 *
 * Before this, derived laws and the derived look needed `?laws=1` in every browser's URL while
 * the server ran with `RELAY_LAWS=1`; a crew whose URLs disagreed played one game and watched
 * another. `/api/config` now reports both flags and every client adopts them.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeForClient, loadServerConfig } from '../../src/server/config';
import { adoptServerFlags } from '../../src/shared/flags';
import { lawsFlagEnabled, worldLawsView } from '../../src/sim/laws';
import { lintProse } from '../../src/shared/prose';
import { serverWorldProvider } from '../../src/client/transport/worldProviders';
import { DERIVED_LAWS_DISCLOSURE, WorldLaws } from '../../src/client/ui/WorldPanel';
import type { UiWorldSummary } from '../../src/shared/ui';
import { floorsWorld } from '../presentation/floorsFixture';

const baseEnv = { NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1' };

afterEach(() => {
  adoptServerFlags(null);
  delete process.env.RELAY_LAWS;
  vi.unstubAllGlobals();
});

describe('server-authoritative feature flags', () => {
  it('reads RELAY_LAWS and RELAY_FLOORS and reports both on /api/config', () => {
    const off = loadServerConfig({ env: baseEnv, argv: [] });
    expect(off.generation).toMatchObject({ floors: false, laws: false });
    expect(describeForClient(off)).toMatchObject({ floors: false, laws: false });

    const on = loadServerConfig({ env: { ...baseEnv, RELAY_FLOORS: '1', RELAY_LAWS: 'true' }, argv: [] });
    expect(on.generation).toMatchObject({ floors: true, laws: true });
    expect(describeForClient(on)).toMatchObject({ floors: true, laws: true });
    // still no secret, and no raw env
    expect(JSON.stringify(describeForClient(on))).not.toMatch(/KEY|RELAY_/);
  });

  it('a client follows the server for laws, in both directions, over its own env flag', () => {
    expect(lawsFlagEnabled()).toBe(false);

    adoptServerFlags({ laws: true, floors: false });
    expect(lawsFlagEnabled()).toBe(true);

    // The server wins outright: nothing in a PreparedWorld says whether its laws were derived,
    // so a client that guessed differently would draw a different game from the one being run.
    process.env.RELAY_LAWS = '1';
    adoptServerFlags({ laws: false, floors: false });
    expect(lawsFlagEnabled()).toBe(false);

    // No server reached: fall back to the local flag.
    adoptServerFlags(null);
    expect(lawsFlagEnabled()).toBe(true);
  });

  it('derives laws for a law-less world exactly when the server says so', () => {
    const world = floorsWorld('a6');
    const plain = { ...world, recipe: { ...world.recipe, laws: undefined, look: undefined } };
    expect(worldLawsView(plain).laws).toEqual([]);

    adoptServerFlags({ laws: true, floors: false });
    const view = worldLawsView(plain);
    expect(view.laws).toHaveLength(2);
    expect(view).toMatchObject({ lawsDerived: true, lookDerived: true });
    // A recipe's own laws are never overridden, and are never relabelled as the engine's —
    // even in a world whose LOOK the engine had to derive.
    const authored = { ...plain, recipe: { ...plain.recipe, laws: [{ lawId: 'long_dark' as const, name: 'The Long Dark', description: 'Bring your own light.', intensity: 0.5 }] } };
    expect(worldLawsView(authored).laws.map((law) => law.lawId)).toEqual(['long_dark']);
    expect(worldLawsView(authored)).toMatchObject({ lawsDerived: false, lookDerived: true });
  });

  it('asks the server for a floors world when the server has floors on', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return { ok: false, status: 503, statusText: 'stub', body: null } as unknown as Response;
    }));
    const request = { requestId: 'a6-req', sessionId: 'a6-session', contributions: [], plannedRoomCount: 3 };
    const ask = async () => { await serverWorldProvider.prepareWorld(request).catch(() => {}); };

    await ask();
    expect(JSON.parse(bodies[0]!).floors).toBeUndefined();

    adoptServerFlags({ laws: false, floors: true });
    await ask();
    expect(JSON.parse(bodies[1]!).floors).toBe(true);
  });
});

describe('provenance of derived laws', () => {
  const summary = (lawsDerived: boolean): UiWorldSummary => ({
    worldId: 'w', title: 'Test world', tagline: 'A place', themeSummary: 'A theme',
    provenance: { source: 'fixture', label: 'OFFLINE FIXTURE', generatedAt: 0, durationMs: 0, attempts: 0, notes: [] },
    receipt: { source: 'fixture', worldTitle: 'Test world', headline: 'Test', lines: [] },
    committedRoomCount: 1, plannedRoomCount: 1, lore: [], attunements: [],
    laws: [{ lawId: 'thin_air', name: 'High Air', description: 'Dashes carry further here.', effect: 'Dash goes 60% farther.', active: true }],
    lawsDerived,
  });

  it('says engine-chosen laws are the engine\'s, and keeps quiet when the model wrote them', () => {
    const derived = renderToStaticMarkup(createElement(WorldLaws, { world: summary(true) }));
    expect(derived).toContain('engine-chosen');
    expect(derived).toContain(DERIVED_LAWS_DISCLOSURE);

    const authored = renderToStaticMarkup(createElement(WorldLaws, { world: summary(false) }));
    expect(authored).not.toContain('engine-chosen');
    expect(authored).not.toContain(DERIVED_LAWS_DISCLOSURE);
    expect(authored).toContain('High Air');
  });

  it('the disclosure is plain enough for the house linter', () => {
    const result = lintProse(DERIVED_LAWS_DISCLOSURE, { kind: 'uiLabel' });
    expect(result.hardFail, JSON.stringify(result.issues)).toBe(false);
  });
});
