/**
 * Fixture generation: deterministic, offline, validated. Always available.
 * Agent B's live service reuses `prepareFromFixture` as its fallback path.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  formatIssues,
  GenerationRequestSchema,
  PreparedWorldSchema,
  WorldFixtureSchema,
  type GenerationRequest,
  type GenerationStatus,
  type PreparedWorld,
  type WorldFixture,
} from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import { buildReceipt } from './receipt';

export function loadWorldFixtures(dir: string): WorldFixture[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const fixtures: WorldFixture[] = [];
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as unknown;
    const parsed = WorldFixtureSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid world fixture ${file}: ${formatIssues(parsed.error)}`);
    }
    fixtures.push(parsed.data);
  }
  return fixtures;
}

export interface FixturePreparation {
  fixture: WorldFixture;
  request: GenerationRequest;
  /** 'fixture' for a deliberate offline run, 'live_fallback_fixture' after a failed live attempt. */
  source: 'fixture' | 'live_fallback_fixture';
  attempts: number;
  startedAt: number;
  notes: string[];
  model?: string;
}

/** Turn a validated fixture into a PreparedWorld with honest provenance + receipt. */
export function prepareFromFixture(p: FixturePreparation): PreparedWorld {
  const now = Date.now();
  const worldId = `world-${p.fixture.fixtureId}-${hashString(p.request.requestId).toString(36)}`;
  const label = p.source === 'fixture' ? 'OFFLINE FIXTURE' : 'FALLBACK FIXTURE (live attempt failed)';

  const world: PreparedWorld = {
    worldId,
    createdAt: now,
    recipe: p.fixture.recipe,
    art: p.fixture.art,
    rooms: p.fixture.rooms,
    plannedRoomCount: p.fixture.plannedRoomCount,
    provenance: {
      source: p.source,
      label,
      fixtureId: p.fixture.fixtureId,
      ...(p.model ? { model: p.model } : {}),
      generatedAt: now,
      durationMs: Math.max(0, now - p.startedAt),
      attempts: p.attempts,
      notes: [p.fixture.fixtureNote, ...p.notes].slice(0, 10),
    },
    receipt: buildReceipt({
      worldTitle: p.fixture.recipe.title,
      source: p.source,
      contributions: p.request.contributions,
      mappings: [],
    }),
  };
  // Validate our own output: the client trusts what passes this schema.
  return PreparedWorldSchema.parse(world);
}

export interface FixtureServiceOptions {
  fixtures: WorldFixture[];
  extraNotes?: string[];
}

export function createFixtureGenerationService(options: FixtureServiceOptions) {
  const { fixtures } = options;
  const extraNotes = options.extraNotes ?? [];

  return {
    async prepareWorld(rawRequest: GenerationRequest, onStatus?: (s: GenerationStatus) => void): Promise<PreparedWorld> {
      const startedAt = Date.now();
      const request = GenerationRequestSchema.parse(rawRequest);
      const status = (phase: GenerationStatus['phase'], message: string): void =>
        onStatus?.({ phase, message, requestId: request.requestId, startedAt, elapsedMs: Date.now() - startedAt });

      status('queued', 'Selecting offline fixture…');
      const seed = request.seed ?? hashString(request.requestId);
      const fixture = fixtures[seed % fixtures.length]!;
      status('validating', `Validating fixture “${fixture.recipe.title}”…`);
      const world = prepareFromFixture({ fixture, request, source: 'fixture', attempts: 0, startedAt, notes: extraNotes });
      status('ready', `Offline fixture “${world.recipe.title}” ready.`);
      return world;
    },
  };
}
