import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ATTRIBUTING_SOURCES,
  IDLE_GENERATION_STATUS,
  GenerationStatusSchema,
  PreparedWorldSchema,
  type Contribution,
  type GameEvent,
  type GameEventInput,
  type GenerationRequest,
  type GenerationStatus,
  type PlayerIdentity,
  type PlayerIntent,
  type PreparedWorld,
} from '../../shared/contracts';
import { TICK_MS } from '../../shared/conventions';
import { randomId } from '../../shared/ids';
import { PROTOCOL_VERSION, decodeClientMessage, encodeMessage, type ClientMessage, type Lobby, type ServerMessage } from '../../shared/protocol';
import { createSimulation, type Simulation } from '../../sim';

export interface RealtimeHandle {
  clientCount(): number;
  close(): Promise<void>;
}

export interface RealtimeOptions {
  path?: string;
  log?: (message: string) => void;
  generation?: {
    prepareWorld: (request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal) => Promise<PreparedWorld>;
    prepareWorldStream?: (request: GenerationRequest, onStatus?: (status: GenerationStatus) => void, signal?: AbortSignal) => AsyncGenerator<PreparedWorld>;
  };
}

interface Member {
  identity: PlayerIdentity;
  resumeToken: string;
  client: ClientRecord | null;
  disconnectedAt: number | null;
  intent: PlayerIntent | null;
  lastIntentAt: number;
  lastSequence: number;
}

interface ClientRecord {
  socket: WebSocket;
  member: Member | null;
  helloTimer: ReturnType<typeof setTimeout>;
  alive: boolean;
  budget: number;
  budgetAt: number;
}

const RECONNECT_GRACE_MS = 30_000;
const MAX_EVENT_HISTORY = 2048;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

export function attachRealtime(server: Server, options: RealtimeOptions = {}): RealtimeHandle {
  const log = options.log ?? ((message: string) => console.log(`[realtime] ${message}`));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Set<ClientRecord>();
  const members = new Map<string, Member>();
  const sim: Simulation & { unlockAbility?: (playerId: string) => GameEvent[] } = createSimulation();
  const sessionId = randomId('session');
  const history: Array<{ sequence: number; event: GameEvent }> = [];
  let hostPlayerId: string | null = null;
  let contributions: Contribution[] = [];
  let generation: GenerationStatus = IDLE_GENERATION_STATUS;
  let world: PreparedWorld | null = null;
  let generating = false;
  let generationController: AbortController | null = null;
  let generationHasPrefix = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let eventSequence = 0;
  let metaCounter = 0;
  let pendingExit: { roomId: string; target: number } | null = null;
  let lastTime = performance.now();
  let accumulator = 0;

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return;
    }
    socket.send(encodeMessage(message));
  }

  function broadcast(message: ServerMessage, except?: ClientRecord): void {
    if (closed) return;
    for (const client of clients) if (client.member && client !== except) send(client.socket, message);
  }

  function lobby(): Lobby {
    return {
      sessionId, hostPlayerId,
      players: [...members.values()].map((member) => ({ identity: member.identity, connected: member.client !== null })),
    };
  }

  function publishSnapshot(): void {
    broadcast({ type: 'snapshot', snapshot: sim.getSnapshot() });
  }

  function publishEvents(events: GameEvent[]): void {
    if (!events.length) return;
    for (const event of events) history.push({ sequence: ++eventSequence, event });
    if (history.length > MAX_EVENT_HISTORY) history.splice(0, history.length - MAX_EVENT_HISTORY);
    broadcast({ type: 'events', events, eventSequence });
  }

  function metaEvent(input: GameEventInput): GameEvent {
    const tick = sim.getTick();
    return { ...input, id: `meta:${++metaCounter}`, tick, timeMs: tick * TICK_MS } as GameEvent;
  }

  function error(client: ClientRecord, message: string, action?: string, requestId?: string): void {
    send(client.socket, { type: 'error', message: message.slice(0, 200), action, requestId });
  }

  function setGeneration(status: GenerationStatus): void {
    if (closed) return;
    generation = GenerationStatusSchema.parse(status);
    broadcast({ type: 'generation_status', status: generation });
  }

  function electHost(): void {
    if (hostPlayerId && members.get(hostPlayerId)?.client) return;
    hostPlayerId = [...members.values()].find((member) => member.client)?.identity.id ?? null;
    sim.setHostPlayerId(hostPlayerId); // floors: the (new) host decides biome choices
  }

  function clearIntents(): void {
    for (const member of members.values()) member.intent = null;
  }

  function enterRoom(index: number): GameEvent[] {
    pendingExit = null;
    clearIntents();
    return sim.enterRoom(index);
  }

  function finishPendingExit(): GameEvent[] {
    if (!pendingExit || pendingExit.roomId !== sim.getRoom().id || sim.getPhase() !== 'expedition') return [];
    if (!world?.rooms[pendingExit.target]) return [];
    return enterRoom(pendingExit.target);
  }

  function handleExits(events: GameEvent[]): GameEvent[] {
    const phase = sim.getPhase();
    if (phase === 'debrief' || events.some((event) => event.type === 'run_ended')) {
      pendingExit = null;
      return [];
    }
    // Floors: the sim walks doors and biome picks itself; a fresh room only needs clean intents.
    if (events.some((event) => event.type === 'room_entered')) clearIntents();
    const exit = events.find((event) => event.type === 'exit_reached' && event.toRoomId === undefined
      && event.roomIndex === sim.getRoom().index
      && (phase !== 'headquarters' || event.playerId === hostPlayerId));
    if (!exit || exit.type !== 'exit_reached') return [];
    if (phase === 'headquarters') return world && (!generating || generationHasPrefix) ? enterRoom(0) : [];
    if (world?.rooms[exit.toRoomIndex]) return enterRoom(exit.toRoomIndex);
    pendingExit = { roomId: sim.getRoom().id, target: exit.toRoomIndex };
    setGeneration({ ...generation, message: `Waiting for room ${exit.toRoomIndex + 1} to be committed.` });
    return [];
  }

  async function* generate(request: GenerationRequest): AsyncGenerator<PreparedWorld> {
    const service = options.generation;
    if (!service) return;
    if (service.prepareWorldStream) yield* service.prepareWorldStream(request, setGeneration, generationController?.signal);
    else yield await service.prepareWorld(request, setGeneration, generationController?.signal);
  }

  async function prepareWorld(client: ClientRecord, requestId: string): Promise<void> {
    if (!options.generation) {
      error(client, 'World generation is unavailable on this server.', 'request_world', requestId);
      return;
    }
    if (generating || sim.getPhase() !== 'headquarters') {
      error(client, 'World generation requires headquarters with no request in progress.', 'request_world', requestId);
      return;
    }
    generating = true;
    generationController = new AbortController();
    generationHasPrefix = false;
    const startedAt = Date.now();
    let committed: PreparedWorld | null = null;
    setGeneration({ phase: 'queued', message: 'Preparing a shared world…', requestId, startedAt, elapsedMs: 0 });
    try {
      for await (const candidate of generate({
        requestId, sessionId, contributions: contributions.map((contribution) => ({ ...contribution })), plannedRoomCount: 3,
      })) {
        if (closed) break;
        const next = PreparedWorldSchema.parse(candidate);
        if (committed && (next.worldId !== committed.worldId
          || next.createdAt !== committed.createdAt
          || next.plannedRoomCount !== committed.plannedRoomCount
          || next.rooms.length < committed.rooms.length
          || next.provenance.source !== committed.provenance.source
          || JSON.stringify({ ...next.recipe, contributionMappings: [] }) !== JSON.stringify({ ...committed.recipe, contributionMappings: [] })
          || JSON.stringify(next.art) !== JSON.stringify(committed.art)
          || committed.rooms.some((room, index) => JSON.stringify(room) !== JSON.stringify(next.rooms[index])))) {
          throw new Error('Generation attempted to replace committed rooms.');
        }
        const first = committed === null;
        committed = next;
        generationHasPrefix = true;
        world = next;
        sim.setWorld(next);
        broadcast({ type: 'world', world: next, requestId });
        setGeneration({
          phase: ATTRIBUTING_SOURCES.has(next.provenance.source) ? 'ready' : 'fallback',
          message: `${next.provenance.label}: ${next.rooms.length}/${next.plannedRoomCount} rooms committed.`.slice(0, 200),
          requestId, startedAt, elapsedMs: Date.now() - startedAt,
        });
        if (first) publishEvents([metaEvent({
          type: 'world_prepared', worldId: next.worldId, worldTitle: next.recipe.title,
          source: next.provenance.source, playerIds: sim.getPlayerIds(),
        })]);
        const events = finishPendingExit();
        publishSnapshot();
        publishEvents(events);
      }
      if (!closed && !committed) throw new Error('Generation returned no committed rooms.');
      if (!closed && committed && committed.rooms.length < committed.plannedRoomCount) {
        throw new Error('Generation ended before all planned rooms were committed.');
      }
    } catch (cause) {
      if (!closed) {
        const message = cause instanceof Error ? cause.message.slice(0, 200) : 'World generation failed.';
        setGeneration({ phase: 'failed', message, requestId, startedAt, elapsedMs: Date.now() - startedAt });
        broadcast({ type: 'error', action: 'request_world', requestId, message });
      }
    } finally {
      generating = false;
      generationController = null;
    }
  }

  function hello(client: ClientRecord, message: Extract<ClientMessage, { type: 'hello' }>): void {
    if (client.member) {
      error(client, 'Hello has already completed.', 'hello');
      return;
    }
    let member: Member;
    let replay: GameEvent[] = [];
    let historyTruncated = false;
    if (message.resumeToken) {
      const previous = message.playerId ? members.get(message.playerId) : undefined;
      if (!previous || previous.resumeToken !== message.resumeToken || previous.client
        || (previous.disconnectedAt !== null && Date.now() - previous.disconnectedAt >= RECONNECT_GRACE_MS)) {
        error(client, 'Session resume rejected; join again without a resume token.', 'hello');
        client.socket.close(1008, 'Resume rejected');
        return;
      }
      member = previous;
      const lastSequence = message.lastEventSequence ?? eventSequence;
      replay = history.filter((entry) => entry.sequence > lastSequence).map((entry) => entry.event);
      historyTruncated = lastSequence < (history[0]?.sequence ?? eventSequence + 1) - 1;
    } else {
      if (members.size >= 4) {
        // A full lobby of ghosts must not lock the living out: the longest-gone seat is given up first.
        const ghost = [...members.values()].filter((candidate) => !candidate.client)
          .sort((a, b) => (a.disconnectedAt ?? 0) - (b.disconnectedAt ?? 0))[0];
        if (ghost) {
          members.delete(ghost.identity.id);
          sim.removePlayer(ghost.identity.id);
        }
      }
      if (members.size >= 4) {
        error(client, 'The lobby is full (maximum four players).', 'hello');
        client.socket.close(1008, 'Lobby full');
        return;
      }
      // An unused proposed ID is compatible with v1; it is never a resume credential.
      let id = message.playerId ?? randomId('player');
      while (members.has(id)) id = randomId('player');
      member = {
        identity: { id, displayName: message.displayName, classId: message.classId },
        resumeToken: randomUUID(), client: null, disconnectedAt: null,
        intent: null, lastIntentAt: 0, lastSequence: -1,
      };
      members.set(id, member);
      sim.addPlayer(member.identity);
    }
    clearTimeout(client.helloTimer);
    member.client = client;
    member.disconnectedAt = null;
    member.intent = null;
    member.lastSequence = -1;
    client.member = member;
    electHost();
    send(client.socket, {
      type: 'welcome', protocolVersion: PROTOCOL_VERSION, playerId: member.identity.id,
      serverTimeMs: Date.now(), isHost: hostPlayerId === member.identity.id, resumeToken: member.resumeToken,
      lobby: lobby(), snapshot: sim.getSnapshot(), world, contributions, generation,
      eventSequence, events: replay, historyTruncated,
    });
    broadcast({ type: 'lobby', lobby: lobby() }, client);
  }

  function receive(client: ClientRecord, message: ClientMessage): void {
    if (message.type === 'hello') {
      hello(client, message);
      return;
    }
    const member = client.member;
    if (!member) {
      error(client, 'Send hello before taking actions.', message.type);
      return;
    }
    if (message.type === 'request_world' || message.type === 'enter_portal' || message.type === 'return_to_hq') {
      if (member.identity.id !== hostPlayerId) {
        error(client, 'Only the host can perform this action.', message.type, message.type === 'request_world' ? message.requestId : undefined);
        return;
      }
    }
    switch (message.type) {
      case 'ping':
        send(client.socket, { type: 'pong', sentAt: message.sentAt, serverTimeMs: Date.now() });
        break;
      case 'intent': {
        const intent = message.intent;
        if (intent.playerId !== member.identity.id || intent.seq <= member.lastSequence) {
          error(client, 'Intent ownership or sequence is invalid.', 'intent');
          return;
        }
        member.lastSequence = intent.seq;
        member.lastIntentAt = Date.now();
        member.intent = {
          ...intent, attack: intent.attack || (member.intent?.attack ?? false),
          dash: intent.dash || (member.intent?.dash ?? false),
          ability: intent.ability ?? member.intent?.ability ?? null,
        };
        break;
      }
      case 'identity':
        if (sim.getPhase() !== 'headquarters' && message.classId !== member.identity.classId) {
          error(client, 'Change class at headquarters.', 'identity');
          return;
        }
        member.identity = { id: member.identity.id, displayName: message.displayName, classId: message.classId };
        sim.updatePlayerIdentity(member.identity);
        broadcast({ type: 'lobby', lobby: lobby() });
        publishSnapshot();
        break;
      case 'contribution': {
        if (sim.getPhase() !== 'headquarters' || generating || contributions.length >= 24) {
          error(client, 'Contributions require headquarters, no generation in progress, and fewer than 24 ideas.', 'contribution');
          return;
        }
        if (message.contributionId && contributions.some((item) => item.id === message.contributionId)) {
          error(client, 'Contribution ID is already in use.', 'contribution');
          return;
        }
        const contribution: Contribution = {
          id: message.contributionId ?? randomId('contrib'), playerId: member.identity.id,
          playerName: member.identity.displayName, text: message.text, submittedAt: Date.now(),
        };
        contributions = [...contributions, contribution];
        broadcast({ type: 'contributions', contributions });
        publishEvents([metaEvent({ type: 'contribution_submitted', contributionId: contribution.id, playerId: member.identity.id })]);
        break;
      }
      case 'request_world':
        void prepareWorld(client, message.requestId ?? randomId('request'));
        break;
      case 'enter_portal': {
        if (sim.getPhase() !== 'headquarters' || !world || (generating && !generationHasPrefix)) {
          error(client, 'Prepare a world at headquarters before entering.', 'enter_portal');
          return;
        }
        const events = enterRoom(0);
        publishSnapshot();
        publishEvents(events);
        break;
      }
      case 'return_to_hq': {
        if (sim.getPhase() === 'headquarters') return;
        pendingExit = null;
        clearIntents();
        const events = sim.returnToHeadquarters();
        publishSnapshot();
        publishEvents(events);
        break;
      }
      case 'choose_biome':
        // Every operative may vote; the sim only lets the host's vote decide (setHostPlayerId).
        sim.chooseBiome(member.identity.id, message.biomeId);
        publishSnapshot();
        break;
      case 'unlock_ability': {
        if (!sim.unlockAbility) {
          error(client, 'Ability unlocks are unavailable on this server.', 'unlock_ability');
          return;
        }
        const events = sim.unlockAbility(member.identity.id);
        publishSnapshot();
        publishEvents(events);
        break;
      }
      case 'purchase_skill':
        // Buys for the sender only: the node id is data, the player id is the socket's.
        if (sim.purchaseSkill(member.identity.id, message.nodeId)) publishSnapshot();
        break;
    }
  }

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== (options.path ?? '/ws')) {
      if (server.listenerCount('upgrade') === 1) socket.destroy();
      return;
    }
    if (closed || clients.size >= 16) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', upgrade);

  wss.on('connection', (socket: WebSocket) => {
    const client: ClientRecord = {
      socket, member: null, alive: true, budget: 240, budgetAt: Date.now(),
      helloTimer: setTimeout(() => socket.terminate(), 5000),
    };
    clients.add(client);
    socket.on('pong', () => { client.alive = true; });
    socket.on('message', (data, isBinary) => {
      const now = Date.now();
      client.budget = Math.min(240, client.budget + (now - client.budgetAt) * 0.12) - 1;
      client.budgetAt = now;
      if (client.budget < 0) {
        socket.close(1008, 'Message rate exceeded');
        return;
      }
      const message = isBinary ? null : decodeClientMessage(data.toString());
      if (!message) {
        error(client, 'Invalid message (failed protocol validation).');
        return;
      }
      receive(client, message);
    });
    socket.on('close', () => {
      clearTimeout(client.helloTimer);
      clients.delete(client);
      if (client.member) {
        client.member.client = null;
        client.member.disconnectedAt = Date.now();
        client.member.intent = null;
        electHost();
        broadcast({ type: 'lobby', lobby: lobby() });
      }
    });
    socket.on('error', (cause) => log(`socket error: ${cause.message}`));
  });

  const tickTimer = setInterval(() => {
    const now = performance.now();
    accumulator = Math.min(accumulator + now - lastTime, TICK_MS * 5);
    lastTime = now;
    if (![...members.values()].some((member) => member.client)) {
      accumulator = 0;
      return;
    }
    while (accumulator >= TICK_MS) {
      accumulator -= TICK_MS;
      for (const member of members.values()) {
        if (!member.client || !member.intent || Date.now() - member.lastIntentAt > 250) continue;
        sim.applyIntent(member.intent);
        member.intent = { ...member.intent, attack: false, dash: false, ability: null };
      }
      const phase = sim.getPhase();
      const events = sim.step();
      const extra = handleExits(events);
      if (phase !== sim.getPhase() || extra.length
        || events.some((event) => event.type === 'run_ended' || event.type === 'room_entered')) publishSnapshot();
      publishEvents([...events, ...extra]);
    }
  }, TICK_MS);
  const snapshotTimer = setInterval(publishSnapshot, 50);
  const heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) client.socket.terminate();
      else {
        client.alive = false;
        if (client.socket.readyState === client.socket.OPEN) client.socket.ping();
      }
    }
    let changed = false;
    for (const [id, member] of members) {
      if (member.disconnectedAt !== null && Date.now() - member.disconnectedAt >= RECONNECT_GRACE_MS) {
        members.delete(id);
        sim.removePlayer(id);
        changed = true;
      }
    }
    if (changed) broadcast({ type: 'lobby', lobby: lobby() });
  }, 5000);

  return {
    clientCount: () => [...clients].filter((client) => client.member).length,
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      generationController?.abort();
      clearInterval(tickTimer);
      clearInterval(snapshotTimer);
      clearInterval(heartbeatTimer);
      server.off('upgrade', upgrade);
      for (const client of clients) {
        clearTimeout(client.helloTimer);
        client.socket.terminate();
      }
      closePromise = new Promise<void>((resolve) => wss.close(() => resolve()));
      return closePromise;
    },
  };
}
