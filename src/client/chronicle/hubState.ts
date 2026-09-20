/**
 * Hub state — what the Stillpoint knows about the runs recorded on THIS device.
 *
 * Pure reducer over authoritative `GameEvent`s plus a device-local store under
 * `relay.hub.v1`. Nothing here may invent a run, a crew member or an outcome: every number is
 * a count or sum over real events, and every `LastRun` / relic keeps the event ids it came from.
 *
 * The event model carries no class id. The client adapter stamps it at ingest time from the
 * live snapshot (`classByPlayerId`), which is why this reducer lives in `src/client/chronicle`
 * and not in the shared chronicle.
 */
import { z } from 'zod';
import { AbilityIdSchema, ClassIdSchema, EnemyIdSchema, GenerationSourceSchema, type GameEvent, type GenerationSource } from '../../shared/contracts';
import { CLASS_IDS, type AbilityId, type ClassId, type EnemyId } from '../../shared/registry';
import type { KeyValueStorage } from './localStore';

export const HUB_STORAGE_KEY = 'relay.hub.v1';
export const HUB_MAX_STORED_RELICS = 24;
export const HUB_SHELF_BRACKETS = 5;
const MAX_SEEN_EVENT_IDS = 600;

const Participant = z.object({ id: z.string(), displayName: z.string() });

export const LastRunSchema = z.object({
  worldId: z.string(),
  worldTitle: z.string(),
  // `stranded`: the Anchor held and the crew did not make it back out (BOSS_FINALE.md §7.5).
  outcome: z.enum(['anchored', 'collapsed', 'aborted', 'stranded']),
  classId: ClassIdSchema,
  endedAt: z.number(),
  durationMs: z.number().nonnegative(),
  roomsEntered: z.number().int().nonnegative(),
  deepestRoomIndex: z.number().int(),
  roomsCleared: z.number().int().nonnegative(),
  enemiesDefeated: z.number().int().nonnegative(),
  damageDealt: z.number().nonnegative(),
  damageTaken: z.number().nonnegative(),
  downs: z.number().int().nonnegative(),
  lastDownedByEnemyId: EnemyIdSchema.nullable(),
  revivesGiven: z.number().int().nonnegative(),
  revivesReceived: z.number().int().nonnegative(),
  loreRead: z.number().int().nonnegative(),
  abilityUnlocked: AbilityIdSchema.nullable(),
  crew: z.array(Participant),
  worldSource: GenerationSourceSchema,
  sourceEventIds: z.array(z.string()),
});
export type LastRun = z.infer<typeof LastRunSchema>;

export const ClassRecordSchema = z.object({
  runs: z.number().int().nonnegative(),
  anchors: z.number().int().nonnegative(),
  collapses: z.number().int().nonnegative(),
  aborts: z.number().int().nonnegative(),
  deepestRoomIndex: z.number().int(),
  roomsCleared: z.number().int().nonnegative(),
  enemiesDefeated: z.number().int().nonnegative(),
  damageDealt: z.number().nonnegative(),
  damageTaken: z.number().nonnegative(),
  timesDowned: z.number().int().nonnegative(),
  revivesGiven: z.number().int().nonnegative(),
  revivesReceived: z.number().int().nonnegative(),
  loreRead: z.number().int().nonnegative(),
  abilityUseCounts: z.record(z.string(), z.number().int().nonnegative()),
  nemesisCounts: z.record(z.string(), z.number().int().nonnegative()),
  longestRunMs: z.number().nonnegative(),
});
export type ClassRecord = z.infer<typeof ClassRecordSchema>;

export const HubRelicSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  worldTitle: z.string(),
  title: z.string().max(40),
  source: z.string().max(60),
  text: z.string().max(520),
  recoveredBy: z.array(Participant),
  recoveredAt: z.number(),
  worldSource: GenerationSourceSchema,
  sourceEventIds: z.array(z.string()),
});
export type HubRelic = z.infer<typeof HubRelicSchema>;

export const HubTotalsSchema = z.object({
  runs: z.number().int().nonnegative(),
  anchors: z.number().int().nonnegative(),
  worldsVisited: z.number().int().nonnegative(),
  relics: z.number().int().nonnegative(),
});
export type HubTotals = z.infer<typeof HubTotalsSchema>;

/** A run in flight: counters accumulate here until `run_ended` folds them into `LastRun`. */
const RunAccumulatorSchema = z.object({
  worldId: z.string(),
  worldTitle: z.string(),
  worldSource: GenerationSourceSchema,
  classId: ClassIdSchema.nullable(),
  startedAt: z.number(),
  startTimeMs: z.number().nullable(),
  lastTimeMs: z.number().nullable(),
  roomsEntered: z.number().int().nonnegative(),
  deepestRoomIndex: z.number().int(),
  roomsCleared: z.number().int().nonnegative(),
  enemiesDefeated: z.number().int().nonnegative(),
  damageDealt: z.number().nonnegative(),
  damageTaken: z.number().nonnegative(),
  downs: z.number().int().nonnegative(),
  lastDamageSourceEnemyId: z.string().nullable(),
  lastDownedByEnemyId: z.string().nullable(),
  revivesGiven: z.number().int().nonnegative(),
  revivesReceived: z.number().int().nonnegative(),
  loreRead: z.number().int().nonnegative(),
  abilityUnlocked: AbilityIdSchema.nullable(),
  abilityUseCounts: z.record(z.string(), z.number().int().nonnegative()),
  anchors: z.number().int().nonnegative(),
  lastRelic: HubRelicSchema.omit({ worldId: true, worldTitle: true, worldSource: true, recoveredBy: true }).extend({ playerId: z.string() }).nullable(),
  sourceEventIds: z.array(z.string()),
});
type RunAccumulator = z.infer<typeof RunAccumulatorSchema>;

const RecordsSchema = z.object({
  bastion: ClassRecordSchema, shade: ClassRecordSchema, beacon: ClassRecordSchema, weaver: ClassRecordSchema,
});

export const HubStateSchema = z.object({
  version: z.literal(1),
  lastRun: LastRunSchema.nullable(),
  records: RecordsSchema,
  relics: z.array(HubRelicSchema),
  totals: HubTotalsSchema,
  worldIdsVisited: z.array(z.string()),
  current: RunAccumulatorSchema.nullable(),
  seenEventIds: z.array(z.string()),
});
export type HubState = z.infer<typeof HubStateSchema>;

export function emptyClassRecord(): ClassRecord {
  return {
    runs: 0, anchors: 0, collapses: 0, aborts: 0, deepestRoomIndex: -1, roomsCleared: 0, enemiesDefeated: 0,
    damageDealt: 0, damageTaken: 0, timesDowned: 0, revivesGiven: 0, revivesReceived: 0, loreRead: 0,
    abilityUseCounts: {}, nemesisCounts: {}, longestRunMs: 0,
  };
}

export function emptyRecords(): Record<ClassId, ClassRecord> {
  return { bastion: emptyClassRecord(), shade: emptyClassRecord(), beacon: emptyClassRecord(), weaver: emptyClassRecord() };
}

export function createHubState(): HubState {
  return {
    version: 1, lastRun: null, records: emptyRecords(), relics: [], totals: { runs: 0, anchors: 0, worldsVisited: 0, relics: 0 },
    worldIdsVisited: [], current: null, seenEventIds: [],
  };
}

export interface HubIngestContext {
  /** Wall-clock ms; injected so tests are deterministic. */
  now: number;
  localPlayerId: string;
  players: ReadonlyArray<{ id: string; displayName: string }>;
  /** Read from the live snapshot at ingest time — the only source of a class id. */
  classByPlayerId: Readonly<Partial<Record<string, ClassId>>>;
  world: { worldId: string; title: string; provenanceSource: GenerationSource } | null;
}

function startRun(worldId: string, worldTitle: string, worldSource: GenerationSource, ctx: HubIngestContext): RunAccumulator {
  return {
    worldId, worldTitle, worldSource, classId: ctx.classByPlayerId[ctx.localPlayerId] ?? null, startedAt: ctx.now,
    startTimeMs: null, lastTimeMs: null, roomsEntered: 0, deepestRoomIndex: -1, roomsCleared: 0, enemiesDefeated: 0,
    damageDealt: 0, damageTaken: 0, downs: 0, lastDamageSourceEnemyId: null, lastDownedByEnemyId: null,
    revivesGiven: 0, revivesReceived: 0, loreRead: 0, abilityUnlocked: null, abilityUseCounts: {}, anchors: 0,
    lastRelic: null, sourceEventIds: [],
  };
}

function isEnemyId(id: string | null): id is EnemyId {
  return id !== null && EnemyIdSchema.safeParse(id).success;
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Fold a batch of authoritative events into the hub state. Returns the SAME object when
 * nothing changed so callers can skip persistence.
 */
export function reduceHubState(state: HubState, events: readonly GameEvent[], ctx: HubIngestContext): HubState {
  const seen = new Set(state.seenEventIds);
  let next: HubState = state;
  let changed = false;
  const local = ctx.localPlayerId;
  const nameOf = (id: string): { id: string; displayName: string } =>
    ({ id, displayName: ctx.players.find((p) => p.id === id)?.displayName ?? id });

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    if (event.type === 'world_prepared') {
      next = { ...next, current: startRun(event.worldId, event.worldTitle, event.source, ctx) };
      changed = true;
      continue;
    }

    let run = next.current;
    if (!run) {
      // No world_prepared seen (e.g. joined mid-run): open the run from the live world context.
      if (event.type === 'room_entered' && ctx.world && ctx.world.worldId === event.worldId) {
        run = startRun(ctx.world.worldId, ctx.world.title, ctx.world.provenanceSource, ctx);
      } else {
        continue;
      }
    }
    run = { ...run, abilityUseCounts: { ...run.abilityUseCounts }, sourceEventIds: [...run.sourceEventIds] };
    const stamped = ctx.classByPlayerId[local];
    if (stamped) run.classId = stamped;
    if (run.startTimeMs === null) run.startTimeMs = event.timeMs;
    run.lastTimeMs = event.timeMs;

    switch (event.type) {
      case 'room_entered':
        if (event.playerIds.includes(local)) {
          run.roomsEntered += 1;
          run.deepestRoomIndex = Math.max(run.deepestRoomIndex, event.roomIndex);
        }
        break;
      case 'room_cleared':
        if (event.playerIds.includes(local)) run.roomsCleared += 1;
        break;
      case 'enemy_damaged':
        if (event.byPlayerId === local) run.damageDealt += event.amount;
        break;
      case 'enemy_defeated':
        if (event.byPlayerId === local) run.enemiesDefeated += 1;
        break;
      case 'player_damaged':
        if (event.playerId === local) {
          run.damageTaken += event.amount;
          run.lastDamageSourceEnemyId = event.sourceEnemyId;
        }
        break;
      case 'player_downed':
        if (event.playerId === local) {
          run.downs += 1;
          run.lastDownedByEnemyId = run.lastDamageSourceEnemyId;
        }
        break;
      case 'player_revived':
        if (event.byPlayerId === local && event.playerId !== local) run.revivesGiven += 1;
        if (event.playerId === local) run.revivesReceived += 1;
        break;
      case 'ability_used':
        if (event.playerId === local) bump(run.abilityUseCounts, event.abilityId);
        break;
      case 'ability_unlocked':
        if (event.playerId === local) run.abilityUnlocked = event.abilityId;
        break;
      case 'lore_discovered':
        if (event.playerId === local) run.loreRead += 1;
        if (event.kind === 'relic') {
          run.lastRelic = {
            id: `relic-${run.worldId}-${event.fragmentIndex}`, title: event.title, source: event.source, text: event.text,
            recoveredAt: ctx.now, sourceEventIds: [event.id], playerId: event.playerId,
          };
        }
        break;
      case 'relic_carried':
        // The crew chose one thing to carry out of the collapse; that, not the last thing read,
        // is what the shelf gets (BOSS_FINALE.md §8).
        run.lastRelic = {
          id: `carried-${run.worldId}-${event.key}`.slice(0, 64), title: event.title, source: 'carried out of the collapse',
          text: event.detail, recoveredAt: ctx.now, sourceEventIds: [event.id],
          playerId: event.playerIds.includes(local) ? local : event.playerIds[0] ?? local,
        };
        break;
      case 'anchor_planted':
        if (event.playerIds.includes(local)) run.anchors += 1;
        break;
      case 'run_ended':
        run.sourceEventIds.push(event.id);
        next = finishRun(next, run, event, ctx, nameOf);
        changed = true;
        continue;
      default:
        next = { ...next, current: run };
        changed = true;
        continue;
    }
    run.sourceEventIds.push(event.id);
    next = { ...next, current: run };
    changed = true;
  }

  if (!changed) return state;
  const seenIds = [...seen];
  return { ...next, seenEventIds: seenIds.length > MAX_SEEN_EVENT_IDS ? seenIds.slice(seenIds.length - MAX_SEEN_EVENT_IDS) : seenIds };
}

function finishRun(
  state: HubState,
  run: RunAccumulator,
  event: Extract<GameEvent, { type: 'run_ended' }>,
  ctx: HubIngestContext,
  nameOf: (id: string) => { id: string; displayName: string },
): HubState {
  const classId = run.classId ?? ctx.classByPlayerId[ctx.localPlayerId] ?? null;
  const localTookPart = event.playerIds.includes(ctx.localPlayerId);
  if (!classId || !localTookPart) {
    // Nothing honest to record for this device; drop the run in flight.
    return { ...state, current: null };
  }
  const durationMs = run.startTimeMs !== null && run.lastTimeMs !== null ? Math.max(0, run.lastTimeMs - run.startTimeMs) : 0;
  const lastRun: LastRun = {
    worldId: run.worldId, worldTitle: run.worldTitle, outcome: event.outcome, classId, endedAt: ctx.now, durationMs,
    roomsEntered: run.roomsEntered, deepestRoomIndex: run.deepestRoomIndex, roomsCleared: run.roomsCleared,
    enemiesDefeated: run.enemiesDefeated, damageDealt: run.damageDealt, damageTaken: run.damageTaken, downs: run.downs,
    lastDownedByEnemyId: isEnemyId(run.lastDownedByEnemyId) ? run.lastDownedByEnemyId : null,
    revivesGiven: run.revivesGiven, revivesReceived: run.revivesReceived, loreRead: run.loreRead,
    abilityUnlocked: run.abilityUnlocked, crew: event.playerIds.map(nameOf), worldSource: run.worldSource,
    sourceEventIds: run.sourceEventIds,
  };

  const prev = state.records[classId];
  const nemesisCounts = { ...prev.nemesisCounts };
  if (lastRun.lastDownedByEnemyId) bump(nemesisCounts, lastRun.lastDownedByEnemyId);
  const abilityUseCounts = { ...prev.abilityUseCounts };
  for (const [abilityId, count] of Object.entries(run.abilityUseCounts)) abilityUseCounts[abilityId] = (abilityUseCounts[abilityId] ?? 0) + count;
  const record: ClassRecord = {
    runs: prev.runs + 1,
    anchors: prev.anchors + run.anchors,
    collapses: prev.collapses + (event.outcome === 'collapsed' ? 1 : 0),
    aborts: prev.aborts + (event.outcome === 'aborted' ? 1 : 0),
    deepestRoomIndex: Math.max(prev.deepestRoomIndex, run.deepestRoomIndex),
    roomsCleared: prev.roomsCleared + run.roomsCleared,
    enemiesDefeated: prev.enemiesDefeated + run.enemiesDefeated,
    damageDealt: prev.damageDealt + run.damageDealt,
    damageTaken: prev.damageTaken + run.damageTaken,
    timesDowned: prev.timesDowned + run.downs,
    revivesGiven: prev.revivesGiven + run.revivesGiven,
    revivesReceived: prev.revivesReceived + run.revivesReceived,
    loreRead: prev.loreRead + run.loreRead,
    abilityUseCounts,
    nemesisCounts,
    longestRunMs: Math.max(prev.longestRunMs, durationMs),
  };

  let relics = state.relics;
  // `stranded` keeps the anchor and the run summary but never a relic: the crew lost the souvenir.
  if (event.outcome === 'anchored' && run.lastRelic) {
    const { playerId, ...rest } = run.lastRelic;
    const relic: HubRelic = { ...rest, worldId: run.worldId, worldTitle: run.worldTitle, worldSource: run.worldSource, recoveredBy: [nameOf(playerId)] };
    relics = [...relics.filter((r) => r.worldId !== run.worldId), relic];
    if (relics.length > HUB_MAX_STORED_RELICS) relics = relics.slice(relics.length - HUB_MAX_STORED_RELICS);
  }

  const worldIdsVisited = state.worldIdsVisited.includes(run.worldId) ? state.worldIdsVisited : [...state.worldIdsVisited, run.worldId];
  return {
    ...state,
    lastRun,
    records: { ...state.records, [classId]: record },
    relics,
    totals: {
      runs: state.totals.runs + 1,
      anchors: state.totals.anchors + (event.outcome === 'anchored' ? 1 : 0),
      worldsVisited: worldIdsVisited.length,
      relics: relics.length,
    },
    worldIdsVisited,
    current: null,
  };
}

/** Newest-left shelf view: the last `HUB_SHELF_BRACKETS` relics, most recent first. */
export function shelfRelics(state: Pick<HubState, 'relics'>): HubRelic[] {
  return state.relics.slice(-HUB_SHELF_BRACKETS).reverse();
}

export function mostCounted<K extends string>(counts: Partial<Record<K, number>>): K | null {
  let best: K | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts) as Array<[K, number]>) {
    if (count > bestCount || (count === bestCount && best !== null && key < best)) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export function abilityIdOrNull(id: string | null): AbilityId | null {
  return id !== null && AbilityIdSchema.safeParse(id).success ? (id as AbilityId) : null;
}

export function enemyIdOrNull(id: string | null): EnemyId | null {
  return isEnemyId(id) ? id : null;
}

// ---------------------------------------------------------------------------------------------
// Device-local persistence
// ---------------------------------------------------------------------------------------------

/**
 * Load `relay.hub.v1`. A clean parse wins; otherwise salvage every field that still validates
 * (records per class, relics one by one, the last run) and fall back to empty for the rest.
 */
export function loadHubState(storage: KeyValueStorage, key = HUB_STORAGE_KEY): HubState {
  const empty = createHubState();
  try {
    const raw = storage.getItem(key);
    if (!raw) return empty;
    const json: unknown = JSON.parse(raw);
    const whole = HubStateSchema.safeParse(json);
    if (whole.success) return whole.data;
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return empty;
    const partial = json as Record<string, unknown>;
    const records = emptyRecords();
    const storedRecords = partial.records;
    if (typeof storedRecords === 'object' && storedRecords !== null) {
      for (const classId of CLASS_IDS) {
        const one = ClassRecordSchema.safeParse((storedRecords as Record<string, unknown>)[classId]);
        if (one.success) records[classId] = one.data;
      }
    }
    const relics = Array.isArray(partial.relics)
      ? partial.relics.flatMap((item) => { const one = HubRelicSchema.safeParse(item); return one.success ? [one.data] : []; })
      : [];
    const lastRun = LastRunSchema.safeParse(partial.lastRun);
    const totals = HubTotalsSchema.safeParse(partial.totals);
    const worldIdsVisited = z.array(z.string()).safeParse(partial.worldIdsVisited);
    const runs = Object.values(records).reduce((sum, record) => sum + record.runs, 0);
    const anchors = Object.values(records).reduce((sum, record) => sum + record.anchors, 0);
    return {
      ...empty,
      lastRun: lastRun.success ? lastRun.data : null,
      records,
      relics: relics.slice(-HUB_MAX_STORED_RELICS),
      worldIdsVisited: worldIdsVisited.success ? worldIdsVisited.data : [],
      totals: totals.success
        ? { ...totals.data, relics: Math.min(totals.data.relics, relics.length) }
        : { runs, anchors, worldsVisited: worldIdsVisited.success ? worldIdsVisited.data.length : 0, relics: relics.length },
    };
  } catch {
    return empty;
  }
}

export function saveHubState(storage: KeyValueStorage, state: HubState, key = HUB_STORAGE_KEY): void {
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Quota: drop relic bodies and retry once; the counts still persist.
    try {
      storage.setItem(key, JSON.stringify({ ...state, relics: state.relics.map((relic) => ({ ...relic, text: '' })) }));
    } catch {
      /* storage disabled; state stays in memory for this session */
    }
  }
}

export function clearHubState(storage: KeyValueStorage, key = HUB_STORAGE_KEY): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be disabled; in-memory state still resets.
  }
}

// ---------------------------------------------------------------------------------------------
// In-page bus: the chronicle adapter publishes, the renderer and station panels read.
// Keeps the shared UiModel untouched — hub state is a presentation concern.
// ---------------------------------------------------------------------------------------------

export interface HubStateBus {
  get(): HubState;
  set(state: HubState): void;
  subscribe(listener: (state: HubState) => void): () => void;
}

export function createHubStateBus(initial: HubState = createHubState()): HubStateBus {
  let state = initial;
  const listeners = new Set<(state: HubState) => void>();
  return {
    get: () => state,
    set(next) {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The one bus a page uses. Tests may `hubStateBus.set(createHubState())` to reset. */
export const hubStateBus: HubStateBus = createHubStateBus();
