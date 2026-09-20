/**
 * Chronicle reducer — turns REAL game events into MemoryRecords.
 *
 * Pure and browser-independent (Agent C owns this folder; Agent A calls it from both
 * LocalSession and the future multiplayer host). Persistence and thumbnails live in
 * src/client/chronicle (browser adapters), never here.
 *
 * Rules:
 *  - world_prepared           -> one `creation_receipt` per world (honest about source)
 *  - first room_entered (#0)  -> one `arrival_keepsake` per world (no run completion needed)
 *  - anchor_planted           -> `anchor`
 *  - first enemy_defeated     -> one `milestone` per world after arrival
 *  - floors biome/room milestones -> `milestone` records, capped per run
 *  - run_ended                -> `run_summary`
 *  - every event id is processed at most once (network retries / replays are safe)
 * Never invents participants: names come from the event's playerIds + known players.
 */
import { CreationReceiptSchema, MemoryRecordSchema, type CreationReceipt, type GameEvent, type GenerationSource, type MemoryRecord } from '../shared/contracts';

export interface ChronicleParticipant {
  id: string;
  displayName: string;
}

export interface ChronicleWorldContext {
  worldId: string;
  title: string;
  provenanceSource: GenerationSource;
  receipt: CreationReceipt | null;
  biomes?: ReadonlyArray<{ id: string; name: string }>;
}

export interface ChronicleContext {
  /** Wall-clock ms for `createdAt`. Injected so tests are deterministic. */
  now: number;
  /** Everyone currently known in the session (for id -> name). */
  players: ChronicleParticipant[];
  world: ChronicleWorldContext | null;
}

export interface FloorsRunTrack {
  biomes: Array<{ biomeId: string; biomeName: string; tier: number; roomsEntered: number }>;
  pendingChoice: { fromBiomeId: string; options: string[] } | null;
  currentRoomKind: string | null;
  currentRoomName: string | null;
  firsts: string[];
  extras: number;
}

export interface ChronicleState {
  seenEventIds: string[];
  memories: MemoryRecord[];
  floors?: Record<string, FloorsRunTrack>;
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
  let floors = state.floors
    ? Object.fromEntries(Object.entries(state.floors).map(([id, track]) => [
      id,
      {
        ...track,
        biomes: track.biomes.map((biome) => ({ ...biome })),
        pendingChoice: track.pendingChoice ? { ...track.pendingChoice, options: [...track.pendingChoice.options] } : null,
        firsts: [...track.firsts],
      },
    ])) as Record<string, FloorsRunTrack>
    : undefined;
  const legacyWorldId = legacyOrigin(events, state, ctx);

  const hasMemory = (kind: MemoryRecord['kind'], worldId: string) =>
    memories.some((m) => m.kind === kind && m.worldId === worldId);

  for (const event of events) {
    const origin = 'worldId' in event ? event.worldId : undefined;
    const worldId = origin === undefined ? legacyWorldId : origin;
    const eventKey = JSON.stringify([worldId, event.id]);
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    if (memories.some((m) => m.worldId === worldId && m.sourceEventIds.includes(event.id))) continue;

    const previous = memories.find((m) => m.worldId === worldId);
    const world = ctx.world?.worldId === worldId ? ctx.world : previous ? {
      worldId: previous.worldId, title: previous.worldTitle, provenanceSource: previous.provenanceSource, receipt: null,
    } : null;
    if (!floors && worldId && (
      event.type === 'biome_choice_offered'
      || event.type === 'biome_entered'
      || (event.type === 'room_entered' && event.kind)
    )) floors = {};
    const floorsMemory = floorsMemoryFromEvent(event, { ...ctx, world }, floors);
    let memory = floorsMemory ?? memoryFromEvent(event, { ...ctx, world }, hasMemory);
    const track = worldId === null ? undefined : floors?.[worldId];
    if (event.type === 'run_ended' && track) {
      if (memory?.kind === 'run_summary') {
        const deepest = track.biomes.reduce<FloorsRunTrack['biomes'][number] | undefined>(
          (best, biome) => !best || biome.tier > best.tier ? biome : best,
          undefined,
        );
        if (deepest) {
          const rooms = deepest.roomsEntered;
          memory.summary += ` Deepest point: ${deepest.biomeName}, tier ${deepest.tier + 1} of 5, ${rooms} ${rooms === 1 ? 'room' : 'rooms'} in.`;
        }
      }
      if (floors && worldId !== null) delete floors[worldId];
    }
    if (!memory) continue;
    memory.title = clip(memory.title, 80);
    memory.summary = clip(memory.summary, 400);
    memory.worldTitle = clip(memory.worldTitle, 40);
    const baseId = memory.id;
    let suffix = 1;
    while (memories.some((m) => m.id === memory.id)) {
      const ending = `-${suffix++}`;
      memory.id = `${baseId.slice(0, 64 - ending.length)}${ending}`;
    }
    const parsed = MemoryRecordSchema.safeParse(memory);
    if (!parsed.success) continue;
    memories.push(parsed.data);
    created.push(parsed.data);
  }

  const seenList = [...seen];
  return {
    state: {
      seenEventIds: seenList.length > SEEN_LIMIT ? seenList.slice(seenList.length - SEEN_LIMIT) : seenList,
      memories,
      ...(floors && Object.keys(floors).length > 0 ? { floors } : {}),
    },
    created,
  };
}

const FLOORS_MEMORIES_PER_RUN = 14;

function floorsMemoryFromEvent(
  event: GameEvent,
  ctx: ChronicleContext,
  floors: Record<string, FloorsRunTrack> | undefined,
): MemoryRecord | null {
  const worldId = 'worldId' in event ? event.worldId : undefined;
  if (!worldId || !ctx.world) return null;
  const existing = floors?.[worldId];
  if (!existing && event.type !== 'biome_choice_offered' && event.type !== 'biome_entered' && !(event.type === 'room_entered' && event.kind)) return null;
  const getTrack = (): FloorsRunTrack => floors![worldId] ?? (floors![worldId] = {
    biomes: [],
    pendingChoice: null,
    currentRoomKind: null,
    currentRoomName: null,
    firsts: [],
    extras: 0,
  });
  const track = getTrack();
  const participantsFor = (ids: string[]) => resolveParticipants(ids, ctx.players);
  const worldTitle = ctx.world.title;
  const provenanceSource = ctx.world.provenanceSource;
  const addMemory = (memory: MemoryRecord): MemoryRecord | null => {
    if (track.extras >= FLOORS_MEMORIES_PER_RUN) return null;
    track.extras += 1;
    return memory;
  };

  switch (event.type) {
    case 'biome_choice_offered':
      track.pendingChoice = { fromBiomeId: event.fromBiomeId, options: [...event.options] };
      return null;
    case 'biome_entered': {
      track.biomes.push({ biomeId: event.biomeId, biomeName: event.biomeName, tier: event.tier, roomsEntered: 0 });
      track.currentRoomKind = null;
      track.currentRoomName = null;
      const participants = participantsFor(event.playerIds);
      let summary = `${joinNames(participants)} entered ${event.biomeName}, tier ${event.tier + 1} of 5.`;
      const choice = track.pendingChoice;
      if (choice && choice.options.includes(event.biomeId)) {
        const otherId = choice.options.find((id) => id !== event.biomeId);
        const other = otherId ? (ctx.world.biomes?.find((biome) => biome.id === otherId)?.name ?? otherId) : null;
        if (choice.options.length === 1) summary += ' It was the only route on.';
        else if (event.chosenByPlayerId !== null) {
          const chooser = joinNames(participantsFor([event.chosenByPlayerId]));
          summary += ` ${chooser} chose it over ${other}.`;
        } else if (other) summary += ` The crew took it over ${other}.`;
      } else if (event.tier === 0) {
        summary += ' The run started here.';
      }
      track.pendingChoice = null;
      return addMemory({
        id: memoryId('milestone', event),
        kind: 'milestone',
        worldId,
        worldTitle: clip(worldTitle, 40),
        roomIndex: null,
        createdAt: ctx.now,
        participants,
        title: `Entered ${event.biomeName}`,
        summary,
        sourceEventIds: [event.id],
        provenanceSource,
      });
    }
    case 'room_entered': {
      if (!event.kind) return null;
      track.currentRoomKind = event.kind;
      track.currentRoomName = event.roomName;
      const currentBiome = track.biomes[track.biomes.length - 1];
      if (currentBiome) currentBiome.roomsEntered += 1;
      if (!['elite', 'treasure', 'rest'].includes(event.kind) || track.firsts.includes(event.kind)) return null;
      track.firsts.push(event.kind);
      const participants = participantsFor(event.playerIds);
      const biomeName = currentBiome?.biomeName ?? 'the current biome';
      const first = event.kind === 'elite'
        ? { title: `First elite room — ${worldTitle}`, summary: `${joinNames(participants)} entered the first elite room of the run: ${event.roomName}, in ${biomeName}.` }
        : event.kind === 'treasure'
          ? { title: `First cache — ${worldTitle}`, summary: `${joinNames(participants)} reached the first cache of the run: ${event.roomName}, in ${biomeName}.` }
          : { title: `First rest site — ${worldTitle}`, summary: `${joinNames(participants)} reached the first rest site of the run: ${event.roomName}, in ${biomeName}.` };
      return addMemory({
        id: memoryId('milestone', event),
        kind: 'milestone',
        worldId,
        worldTitle: clip(worldTitle, 40),
        roomIndex: event.roomIndex,
        createdAt: ctx.now,
        participants,
        title: first.title,
        summary: first.summary,
        sourceEventIds: [event.id],
        provenanceSource,
      });
    }
    case 'room_cleared': {
      if (track.currentRoomKind !== 'exit') return null;
      const currentBiome = track.biomes[track.biomes.length - 1];
      if (!currentBiome) return null;
      const participants = participantsFor(event.playerIds);
      return addMemory({
        id: memoryId('milestone', event),
        kind: 'milestone',
        worldId,
        worldTitle: clip(worldTitle, 40),
        roomIndex: event.roomIndex,
        createdAt: ctx.now,
        participants,
        title: `Gatekeeper down — ${currentBiome.biomeName}`,
        summary: `${joinNames(participants)} cleared the gatekeeper room of ${currentBiome.biomeName}, tier ${currentBiome.tier + 1} of 5.`,
        sourceEventIds: [event.id],
        provenanceSource,
      });
    }
    default:
      return null;
  }
}

function legacyOrigin(events: GameEvent[], state: ChronicleState, ctx: ChronicleContext): string | null {
  const origins = new Set(events.flatMap((event) =>
    'worldId' in event && event.worldId !== undefined ? [event.worldId] : [],
  ));
  if (origins.size === 0) {
    for (const memory of state.memories) origins.add(memory.worldId);
    if (ctx.world) origins.add(ctx.world.worldId);
  }
  return origins.size === 1 ? [...origins][0]! : null;
}

export function refreshChronicleReceipt(state: ChronicleState, world: ChronicleWorldContext): ChronicleState {
  const receipt = CreationReceiptSchema.safeParse(world.receipt);
  if (!receipt.success || receipt.data.source !== world.provenanceSource || receipt.data.worldTitle !== world.title) return state;
  const index = state.memories.findIndex((memory) =>
    memory.kind === 'creation_receipt' && memory.worldId === world.worldId
    && memory.provenanceSource === world.provenanceSource && memory.worldTitle === world.title
    && memory.sourceEventIds.length > 0,
  );
  if (index < 0) return state;
  const memory = state.memories[index]!;
  const summary = clip(receiptSummary(memory.provenanceSource, receipt.data, memory.participants), 400);
  if (memory.summary === summary) return state;
  const memories = [...state.memories];
  memories[index] = { ...memory, summary };
  return { ...state, memories };
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
      const receipt = ctx.world?.worldId === event.worldId && ctx.world.receipt?.source === event.source
        && ctx.world.receipt.worldTitle === event.worldTitle ? ctx.world.receipt : null;
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
      if (!ctx.world) return null;
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
      if (!ctx.world || hasMemory('anchor', event.worldId)) return null;
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
      if (!ctx.world) return null;
      const participants = resolveParticipants(event.playerIds, ctx.players);
      const worldTitle = ctx.world?.worldId === event.worldId ? ctx.world.title : 'an unknown world';
      const outcome =
        event.outcome === 'anchored'
          ? 'returned with the world anchored'
          : event.outcome === 'collapsed'
            ? 'watched the world collapse'
            : event.outcome === 'stranded'
              // The Anchor held; they did not make it back to the portal. No relic, and the run
              // still counts: the world is saved.
              ? 'anchored the world and did not get out'
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
    case 'lore_discovered': {
      const world = ctx.world;
      if (!world) return null;
      const participants = resolveParticipants([event.playerId], ctx.players);
      return {
        id: memoryId('lore', event),
        kind: 'lore',
        worldId: world.worldId,
        worldTitle: clip(world.title, 40),
        roomIndex: null,
        createdAt: ctx.now,
        participants,
        title: clip(event.title, 80),
        summary: clip(`${event.source} — ${event.text} (${event.kind === 'relic' ? 'read' : 'recovered'} by ${joinNames(participants)})`, 400),
        sourceEventIds: [event.id],
        provenanceSource: world.provenanceSource,
      };
    }
    case 'relic_carried': {
      // The one thing the crew chose to carry out of the collapse. Derived from a real choice at a
      // real pedestal, so the hub may talk about it (BOSS_FINALE.md §8).
      const world = ctx.world;
      if (!world) return null;
      const participants = resolveParticipants(event.playerIds, ctx.players);
      return {
        id: memoryId('lore', event),
        kind: 'lore',
        worldId: world.worldId,
        worldTitle: clip(world.title, 40),
        roomIndex: null,
        createdAt: ctx.now,
        participants,
        title: clip(`Carried out — ${event.title}`, 80),
        summary: clip(`${joinNames(participants)} carried ${event.title} out of ${world.title} as it came down. ${event.detail}`, 400),
        sourceEventIds: [event.id],
        provenanceSource: world.provenanceSource,
      };
    }
    case 'enemy_defeated': {
      const world = ctx.world;
      if (!world || !hasMemory('arrival_keepsake', world.worldId) || hasMemory('milestone', world.worldId)) return null;
      const participants = resolveParticipants([event.byPlayerId], ctx.players);
      return {
        id: memoryId('milestone', event),
        kind: 'milestone',
        worldId: world.worldId,
        worldTitle: clip(world.title, 40),
        roomIndex: null,
        createdAt: ctx.now,
        participants,
        title: `First victory — ${world.title}`,
        summary: `${joinNames(participants)} defeated the first hostile recorded in ${world.title}.`,
        sourceEventIds: [event.id],
        provenanceSource: world.provenanceSource,
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
  return [...new Set(playerIds)].map((id) => byId.get(id) ?? { id, displayName: 'Unknown operative' });
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
