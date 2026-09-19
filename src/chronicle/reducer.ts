/**
 * Chronicle reducer — turns REAL game events into MemoryRecords.
 *
 * Pure and browser-independent (Agent C owns this folder; Agent A calls it from both
 * LocalSession and the future multiplayer host). Persistence and thumbnails live in
 * src/client/chronicle (browser adapters), never here.
 *
 * Rules (foundation):
 *  - world_prepared           -> one `creation_receipt` per world (honest about source)
 *  - first room_entered (#0)  -> one `arrival_keepsake` per world (no run completion needed)
 *  - anchor_planted           -> `anchor`
 *  - run_ended                -> `run_summary`
 *  - every event id is processed at most once (network retries / replays are safe)
 * Never invents participants: names come from the event's playerIds + known players.
 */
import type { CreationReceipt, GameEvent, GenerationSource, MemoryRecord } from '../shared/contracts';

export interface ChronicleParticipant {
  id: string;
  displayName: string;
}

export interface ChronicleWorldContext {
  worldId: string;
  title: string;
  provenanceSource: GenerationSource;
  receipt: CreationReceipt | null;
}

export interface ChronicleContext {
  /** Wall-clock ms for `createdAt`. Injected so tests are deterministic. */
  now: number;
  /** Everyone currently known in the session (for id -> name). */
  players: ChronicleParticipant[];
  world: ChronicleWorldContext | null;
}

export interface ChronicleState {
  seenEventIds: string[];
  memories: MemoryRecord[];
}

export interface ChronicleResult {
  state: ChronicleState;
  created: MemoryRecord[];
}

const SEEN_LIMIT = 4000;

export function createChronicleState(memories: MemoryRecord[] = []): ChronicleState {
  return { seenEventIds: [], memories: [...memories] };
}

export function reduceChronicle(state: ChronicleState, events: GameEvent[], ctx: ChronicleContext): ChronicleResult {
  const seen = new Set(state.seenEventIds);
  const memories = [...state.memories];
  const created: MemoryRecord[] = [];

  const hasMemory = (kind: MemoryRecord['kind'], worldId: string) =>
    memories.some((m) => m.kind === kind && m.worldId === worldId);

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    const memory = memoryFromEvent(event, ctx, hasMemory);
    if (memory) {
      memories.push(memory);
      created.push(memory);
    }
  }

  const seenList = [...seen];
  return {
    state: {
      seenEventIds: seenList.length > SEEN_LIMIT ? seenList.slice(seenList.length - SEEN_LIMIT) : seenList,
      memories,
    },
    created,
  };
}

function memoryFromEvent(
  event: GameEvent,
  ctx: ChronicleContext,
  hasMemory: (kind: MemoryRecord['kind'], worldId: string) => boolean,
): MemoryRecord | null {
  switch (event.type) {
    case 'world_prepared': {
      if (hasMemory('creation_receipt', event.worldId)) return null;
      const participants = resolveParticipants(event.playerIds, ctx.players);
      const receipt = ctx.world?.worldId === event.worldId ? ctx.world.receipt : null;
      return {
        id: memoryId('creation_receipt', event),
        kind: 'creation_receipt',
        worldId: event.worldId,
        worldTitle: event.worldTitle,
        roomIndex: null,
        createdAt: ctx.now,
        participants,
        title: `Creation receipt — ${event.worldTitle}`,
        summary: receiptSummary(event.source, receipt, participants),
        sourceEventIds: [event.id],
        provenanceSource: event.source,
      };
    }
    case 'room_entered': {
      if (event.roomIndex !== 0) return null;
      if (hasMemory('arrival_keepsake', event.worldId)) return null;
      const participants = resolveParticipants(event.playerIds, ctx.players);
      const worldTitle = ctx.world?.worldId === event.worldId ? ctx.world.title : 'an unknown world';
      const source = ctx.world?.worldId === event.worldId ? ctx.world.provenanceSource : 'fixture';
      const names = joinNames(participants);
      return {
        id: memoryId('arrival_keepsake', event),
        kind: 'arrival_keepsake',
        worldId: event.worldId,
        worldTitle: clip(worldTitle, 40),
        roomIndex: 0,
        createdAt: ctx.now,
        participants,
        title: `Arrival — ${event.roomName}`,
        summary:
          participants.length > 1
            ? `${names} stepped through the portal into ${worldTitle} together. First room: ${event.roomName}.`
            : `${names} stepped through the portal into ${worldTitle}. First room: ${event.roomName}.`,
        sourceEventIds: [event.id],
        provenanceSource: source,
      };
    }
    case 'anchor_planted': {
      const participants = resolveParticipants(event.playerIds, ctx.players);
      const worldTitle = ctx.world?.worldId === event.worldId ? ctx.world.title : 'an unknown world';
      return {
        id: memoryId('anchor', event),
        kind: 'anchor',
        worldId: event.worldId,
        worldTitle: clip(worldTitle, 40),
        roomIndex: event.roomIndex,
        createdAt: ctx.now,
        participants,
        title: `Anchor planted — ${worldTitle}`,
        summary: `${joinNames(participants)} planted the Anchor in room ${event.roomIndex + 1}. ${worldTitle} will not collapse.`,
        sourceEventIds: [event.id],
        provenanceSource: ctx.world?.provenanceSource ?? 'fixture',
      };
    }
    case 'run_ended': {
      const participants = resolveParticipants(event.playerIds, ctx.players);
      const worldTitle = ctx.world?.worldId === event.worldId ? ctx.world.title : 'an unknown world';
      const outcome =
        event.outcome === 'anchored'
          ? 'returned with the world anchored'
          : event.outcome === 'collapsed'
            ? 'watched the world collapse'
            : 'aborted the expedition';
      return {
        id: memoryId('run_summary', event),
        kind: 'run_summary',
        worldId: event.worldId,
        worldTitle: clip(worldTitle, 40),
        roomIndex: null,
        createdAt: ctx.now,
        participants,
        title: `Expedition ended — ${worldTitle}`,
        summary: `${joinNames(participants)} ${outcome}.`,
        sourceEventIds: [event.id],
        provenanceSource: ctx.world?.provenanceSource ?? 'fixture',
      };
    }
    default:
      return null;
  }
}

function receiptSummary(source: GenerationSource, receipt: CreationReceipt | null, participants: ChronicleParticipant[]): string {
  const count = receipt?.lines.length ?? 0;
  const used = receipt?.lines.filter((l) => l.used).length ?? 0;
  const who = joinNames(participants);
  if (source === 'fixture') {
    return count > 0
      ? `${who} contributed ${count} idea${count === 1 ? '' : 's'}. This world is an offline fixture — the ideas were recorded but did not shape it.`
      : `${who} opened an offline fixture world. No contributions were recorded.`;
  }
  if (source === 'live_fallback_fixture') {
    return `${who} contributed ${count} idea${count === 1 ? '' : 's'}. Live generation failed, so a labelled fallback fixture was used.`;
  }
  return `${who} contributed ${count} idea${count === 1 ? '' : 's'}; ${used} shaped observable features of this world.`;
}

function resolveParticipants(playerIds: string[], known: ChronicleParticipant[]): ChronicleParticipant[] {
  const byId = new Map(known.map((p) => [p.id, p]));
  const resolved = playerIds.map((id) => byId.get(id) ?? { id, displayName: 'Unknown operative' });
  return resolved.length > 0 ? resolved : [{ id: 'unknown', displayName: 'Unknown operative' }];
}

function joinNames(participants: ChronicleParticipant[]): string {
  const names = participants.map((p) => p.displayName);
  if (names.length <= 1) return names[0] ?? 'Someone';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function memoryId(kind: MemoryRecord['kind'], event: GameEvent): string {
  return `mem-${kind}-${event.id.replace(/[^A-Za-z0-9_.:-]/g, '_')}`.slice(0, 64);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
