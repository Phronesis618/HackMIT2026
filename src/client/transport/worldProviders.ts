/**
 * Where a LocalSession gets its PreparedWorld from.
 *  - serverWorldProvider: POST /api/world (the real path; server decides fixture vs live)
 *  - fixtureWorldProvider: bundles fixtures/worlds/vantage-spire.json into the client so
 *    Agent C can iterate on rendering/UI with NO backend running (`?world=fixture`).
 * Both validate the result with PreparedWorldSchema before the client trusts it.
 */
import {
  formatIssues,
  GenerationRequestSchema,
  PreparedWorldSchema,
  WorldFixtureSchema,
  type GenerationRequestInput,
  type PreparedWorld,
} from '../../shared/contracts';
import fixtureJson from '../../../fixtures/worlds/vantage-spire.json';

export interface WorldProvider {
  readonly kind: 'server' | 'client-fixture';
  prepareWorld(request: GenerationRequestInput): Promise<PreparedWorld>;
}

export const serverWorldProvider: WorldProvider = {
  kind: 'server',
  async prepareWorld(request) {
    const response = await fetch('/api/world', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(GenerationRequestSchema.parse(request)),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload && 'error' in payload ? String((payload as { error: unknown }).error) : response.statusText;
      throw new Error(`World request failed (${response.status}): ${message}`);
    }
    const parsed = PreparedWorldSchema.safeParse(payload);
    if (!parsed.success) throw new Error(`Server returned an invalid PreparedWorld: ${formatIssues(parsed.error)}`);
    return parsed.data;
  },
};

export const fixtureWorldProvider: WorldProvider = {
  kind: 'client-fixture',
  async prepareWorld(rawRequest) {
    const request = GenerationRequestSchema.parse(rawRequest);
    const fixture = WorldFixtureSchema.parse(fixtureJson);
    const now = Date.now();
    const world: PreparedWorld = {
      worldId: `world-${fixture.fixtureId}-preview`,
      createdAt: now,
      recipe: fixture.recipe,
      art: fixture.art,
      rooms: fixture.rooms,
      plannedRoomCount: fixture.plannedRoomCount,
      provenance: {
        source: 'fixture',
        label: 'OFFLINE FIXTURE (client preview)',
        fixtureId: fixture.fixtureId,
        generatedAt: now,
        durationMs: 0,
        attempts: 0,
        notes: [fixture.fixtureNote, 'Loaded in the browser via ?world=fixture; no server involved.'],
      },
      receipt: {
        worldTitle: fixture.recipe.title,
        source: 'fixture',
        headline:
          request.contributions.length > 0
            ? `Offline fixture “${fixture.recipe.title}” (client preview). Your ideas were recorded but did not shape this world.`
            : `Offline fixture “${fixture.recipe.title}” (client preview).`,
        lines: request.contributions.map((c) => ({
          contributionId: c.id,
          playerId: c.playerId,
          playerName: c.playerName,
          text: c.text,
          used: false,
          featureDescription: null,
        })),
      },
    };
    return PreparedWorldSchema.parse(world);
  },
};
