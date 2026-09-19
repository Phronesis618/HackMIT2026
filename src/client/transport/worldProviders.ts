/**
 * Where a LocalSession gets its PreparedWorld from.
 *  - serverWorldProvider: POST /api/world (the real path; server decides fixture vs live)
 *  - fixtureWorldProvider: bundles fixtures/worlds/vantage-spire.json into the client so
 *    Agent C can iterate on rendering/UI with NO backend running (`?world=fixture`).
 * Both validate the result with PreparedWorldSchema before the client trusts it.
 */
import { z } from 'zod';
import {
  formatIssues,
  GenerationRequestSchema,
  GenerationStatusSchema,
  PreparedWorldSchema,
  WorldFixtureSchema,
  type GenerationRequestInput,
  type GenerationStatus,
  type PreparedWorld,
} from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import fixtureJson from '../../../fixtures/worlds/vantage-spire.json';

export interface WorldProvider {
  readonly kind: 'server' | 'client-fixture';
  prepareWorld(request: GenerationRequestInput, options?: WorldStreamOptions): Promise<PreparedWorld>;
  prepareWorldStream?(request: GenerationRequestInput, options?: WorldStreamOptions): AsyncIterable<PreparedWorld>;
}

export interface WorldStreamOptions {
  signal?: AbortSignal;
  onStatus?: (status: GenerationStatus) => void;
}

const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_STREAM_BYTES = 4 * MAX_RECORD_BYTES;
const MAX_RECORDS = 64;
const StreamRecordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), status: GenerationStatusSchema }),
  z.object({ type: z.literal('world'), world: PreparedWorldSchema }),
  z.object({ type: z.literal('error'), message: z.string().min(1).max(200) }),
]);

export function parseWorldPrefix(raw: unknown, rawRequest: GenerationRequestInput, previous?: PreparedWorld): PreparedWorld {
  const request = GenerationRequestSchema.parse(rawRequest);
  const world = PreparedWorldSchema.parse(raw);
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (world.plannedRoomCount !== request.plannedRoomCount
    || world.receipt.source !== world.provenance.source || world.receipt.worldTitle !== world.recipe.title) {
    throw new Error('World identity or provenance does not match the request.');
  }
  const mappings = world.recipe.contributionMappings;
  const attributions = world.rooms.flatMap((room) => room.attributions.map((attribution) => ({
    ...attribution, roomIndex: room.index,
  })));
  const matches = (mapping: typeof mappings[number], attribution: typeof attributions[number]) =>
    mapping.contributionId === attribution.contributionId && mapping.roomIndex === attribution.roomIndex
    && mapping.kind === attribution.kind && mapping.featureDescription === attribution.featureDescription;
  if (mappings.some((mapping) => !request.contributions.some((c) => c.id === mapping.contributionId)
    || !attributions.some((attribution) => matches(mapping, attribution)))
    || attributions.some((attribution) => !mappings.some((mapping) => matches(mapping, attribution)))
    || (world.provenance.source !== 'live' && (mappings.length > 0 || attributions.length > 0))) {
    throw new Error('World attribution does not match committed features.');
  }
  if (world.receipt.lines.length !== request.contributions.length
    || new Set(world.receipt.lines.map((line) => line.contributionId)).size !== world.receipt.lines.length
    || world.receipt.lines.some((line) => {
      const contribution = request.contributions.find((c) => c.id === line.contributionId);
      const mapping = mappings.findLast((m) => m.contributionId === line.contributionId);
      return !contribution || contribution.playerId !== line.playerId || contribution.playerName !== line.playerName
        || contribution.text !== line.text || line.used !== Boolean(mapping)
        || line.featureDescription !== (mapping?.featureDescription ?? null);
    })) {
    throw new Error('World receipt does not match submitted contributions.');
  }
  if (previous) {
    const identity = (value: PreparedWorld) => ({
      worldId: value.worldId, createdAt: value.createdAt, art: value.art, plannedRoomCount: value.plannedRoomCount,
      recipe: { ...value.recipe, contributionMappings: [] },
      provenance: { ...value.provenance, durationMs: 0, notes: [] },
    });
    if (world.rooms.length <= previous.rooms.length || !same(identity(world), identity(previous))
      || !same(world.rooms.slice(0, previous.rooms.length), previous.rooms)
      || !same(mappings.filter((m) => m.roomIndex < previous.rooms.length), previous.recipe.contributionMappings)
      || world.provenance.durationMs < previous.provenance.durationMs) {
      throw new Error('World prefix changed committed rooms or world identity.');
    }
  }
  return world;
}

async function* responseChunks(response: Response, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new Error('World response has no body.');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) return;
      total += value.byteLength;
      if (total > MAX_STREAM_BYTES) throw new Error('World stream exceeds the byte limit.');
      yield value;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readJsonResponse(response: Response, signal?: AbortSignal): Promise<unknown> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  for await (const chunk of responseChunks(response, signal)) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RECORD_BYTES) throw new Error('World response exceeds the byte limit.');
    text += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as unknown;
}

async function fetchWorld(request: GenerationRequestInput, accept: string, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const response = await fetch('/api/world', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: accept },
    body: JSON.stringify(GenerationRequestSchema.parse(request)),
    signal,
  });
  if (!response.ok) {
    const payload = await readJsonResponse(response, signal).catch(() => null);
    signal?.throwIfAborted();
    const error = z.object({ error: z.string().max(200) }).safeParse(payload);
    throw new Error(`World request failed (${response.status}): ${error.success ? error.data.error : response.statusText}`);
  }
  return response;
}

export const serverWorldProvider: WorldProvider = {
  kind: 'server',
  async prepareWorld(request, options) {
    const response = await fetchWorld(request, 'application/json', options?.signal);
    return parseWorldPrefix(await readJsonResponse(response, options?.signal), request);
  },
  async *prepareWorldStream(rawRequest, options = {}) {
    const request = GenerationRequestSchema.parse(rawRequest);
    const response = await fetchWorld(request, 'application/x-ndjson', options.signal);
    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType === 'application/json') {
      yield parseWorldPrefix(await readJsonResponse(response, options.signal), request);
      return;
    }
    if (mediaType !== 'application/x-ndjson') {
      await response.body?.cancel();
      throw new Error('Unsupported world response content type.');
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const encoder = new TextEncoder();
    let buffer = '';
    let records = 0;
    let previous: PreparedWorld | undefined;
    const parseLine = (line: string): PreparedWorld | undefined => {
      if (encoder.encode(line).byteLength > MAX_RECORD_BYTES) throw new Error('World stream exceeds the record limit.');
      if (!line.trim()) return;
      if (++records > MAX_RECORDS) throw new Error('World stream exceeds the record limit.');
      const parsed = StreamRecordSchema.safeParse(JSON.parse(line) as unknown);
      if (!parsed.success) throw new Error(`Invalid world stream record: ${formatIssues(parsed.error)}`);
      const record = parsed.data;
      if (record.type === 'error') throw new Error(record.message);
      if (record.type === 'status') {
        if (record.status.requestId !== request.requestId) throw new Error('Mismatched generation status.');
        options.onStatus?.(record.status);
        return;
      }
      const world = parseWorldPrefix(record.world, request, previous);
      previous = structuredClone(world);
      return world;
    };
    for await (const chunk of responseChunks(response, options.signal)) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        options.signal?.throwIfAborted();
        const world = parseLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (world) yield world;
        newline = buffer.indexOf('\n');
      }
      if (encoder.encode(buffer).byteLength > MAX_RECORD_BYTES) throw new Error('World stream exceeds the record limit.');
    }
    buffer += decoder.decode();
    const last = parseLine(buffer);
    if (last) yield last;
    if (!previous || previous.rooms.length < previous.plannedRoomCount) {
      throw new Error('World stream ended before all rooms were committed.');
    }
  },
};

export const fixtureWorldProvider: WorldProvider = {
  kind: 'client-fixture',
  async prepareWorld(rawRequest) {
    const request = GenerationRequestSchema.parse(rawRequest);
    const fixture = WorldFixtureSchema.parse(fixtureJson);
    const now = Date.now();
    const world: PreparedWorld = {
      worldId: `world-${fixture.fixtureId}-${hashString(request.requestId).toString(36)}`,
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
        notes: [fixture.fixtureNote, 'Loaded from the bundled browser fixture; no server or model call involved.'],
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
