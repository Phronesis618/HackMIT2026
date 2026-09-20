import { z } from 'zod';
import {
  IDLE_GENERATION_STATUS,
  PlayerIdentitySchema,
  type Contribution,
  type GameEvent,
  type GamePhase,
  type GameSnapshot,
  type GenerationStatus,
  type PlayerIdentity,
  type PreparedWorld,
} from '../../shared/contracts';
import { TICK_MS } from '../../shared/conventions';
import { isAtDepartureGate } from '../../shared/headquarters';
import { randomId } from '../../shared/ids';
import {
  ClientMessageSchema, PROTOCOL_VERSION, decodeServerMessage, encodeMessage,
  type ClientMessage, type Lobby, type ServerMessage,
} from '../../shared/protocol';
import type { ConnectionStatus, GameSession, LocalIntent, Unsubscribe } from '../../shared/session';

export interface RemoteSessionOptions {
  identity: PlayerIdentity;
  /** Defaults to /ws on the current page's origin. */
  url?: string;
  createSocket?: (url: string) => WebSocket;
  reconnect?: boolean;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  /**
   * Where the resume credential lives between page loads. Pass the TAB's sessionStorage so a
   * reload returns as the same operative instead of leaving a ghost and joining as a new one.
   */
  resumeStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Stable tab identity scope, independent of server-assigned player IDs. */
  resumeScope?: string;
}

const RESUME_KEY_PREFIX = 'relay.resume.v1.';
const ResumeCredentialSchema = z.object({
  playerId: PlayerIdentitySchema.shape.id,
  token: z.string().min(16).max(128),
});

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RemoteSession implements GameSession {
  readonly mode = 'remote' as const;
  private identity: PlayerIdentity;
  private pendingIdentities: PlayerIdentity[] = [];
  private socket: WebSocket | null = null;
  private connection: ConnectionStatus = 'offline';
  private world: PreparedWorld | null = null;
  private snapshot: GameSnapshot | null = null;
  private generation: GenerationStatus = IDLE_GENERATION_STATUS;
  private contributions: Contribution[] = [];
  private lobby: Lobby | null = null;
  private resumeToken: string | undefined;
  private eventSequence = 0;
  private intentSequence = 0;
  private pendingIntent: LocalIntent | null = null;
  private lastInputAt = 0;
  /** Last gate-readiness hint sent (HUB.md §7); the server derives the truth from position. */
  private sentReady: boolean | null = null;
  private pendingContributions = new Set<string>();
  private startPromise: Promise<void> | null = null;
  private pendingStart: Pending<void> | null = null;
  private pendingWorld: (Pending<PreparedWorld> & { requestId: string }) | null = null;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private hasConnected = false;
  private disposed = false;

  private snapshotListeners = new Set<(snapshot: GameSnapshot) => void>();
  private eventListeners = new Set<(events: GameEvent[]) => void>();
  private worldListeners = new Set<(world: PreparedWorld) => void>();
  private generationListeners = new Set<(status: GenerationStatus) => void>();
  private phaseListeners = new Set<(phase: GamePhase) => void>();
  private connectionListeners = new Set<(status: ConnectionStatus) => void>();
  private contributionListeners = new Set<(contributions: Contribution[]) => void>();
  private lobbyListeners = new Set<(lobby: Lobby) => void>();
  private errorListeners = new Set<(message: string) => void>();

  constructor(private readonly options: RemoteSessionOptions) {
    this.identity = PlayerIdentitySchema.parse(options.identity);
    this.resumeKey = RESUME_KEY_PREFIX + (options.resumeScope ?? this.identity.id);
    try {
      const saved = ResumeCredentialSchema.safeParse(JSON.parse(options.resumeStorage?.getItem(this.resumeKey) ?? 'null'));
      if (saved.success) {
        this.identity = { ...this.identity, id: saved.data.playerId };
        this.resumeToken = saved.data.token;
      }
    } catch { /* unreadable storage: join fresh */ }
  }

  private readonly resumeKey: string;

  private saveResume(token: string | undefined): void {
    this.resumeToken = token;
    try {
      if (token) this.options.resumeStorage?.setItem(this.resumeKey, JSON.stringify({ playerId: this.localPlayerId, token }));
      else this.options.resumeStorage?.removeItem(this.resumeKey);
    } catch { /* storage unavailable: in-memory resume still works */ }
  }

  get localPlayerId(): string { return this.identity.id; }
  getLocalPlayer(): PlayerIdentity { return this.identity; }
  getPhase(): GamePhase { return this.snapshot?.phase ?? 'headquarters'; }
  getConnectionStatus(): ConnectionStatus { return this.connection; }
  getWorld(): PreparedWorld | null { return this.world; }
  getGenerationStatus(): GenerationStatus { return this.generation; }
  getSnapshot(): GameSnapshot | null { return this.snapshot; }
  getContributions(): Contribution[] { return this.contributions; }
  getLobby(): Lobby | null { return this.lobby; }
  getIsHost(): boolean { return this.connection === 'connected' && this.lobby?.hostPlayerId === this.localPlayerId; }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Session is disposed.'));
    if (this.connection === 'connected') return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setConnection('connecting');
    const promise = new Promise<void>((resolve, reject) => {
      this.pendingStart = {
        resolve, reject,
        timer: setTimeout(() => this.disconnect(new Error('Connection timed out.')), this.options.connectTimeoutMs ?? 8000),
      };
    });
    this.startPromise = promise;
    this.openSocket();
    return promise;
  }

  private openSocket(): void {
    const previous = this.socket;
    if (previous) {
      previous.onopen = previous.onmessage = previous.onclose = null;
      previous.onerror = () => {};
      previous.close();
    }
    try {
      const url = this.options.url ?? this.defaultUrl();
      const socket = (this.options.createSocket ?? ((address: string) => new WebSocket(address)))(url);
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket) return;
        this.send({
          type: 'hello', protocolVersion: PROTOCOL_VERSION, playerId: this.localPlayerId,
          displayName: this.identity.displayName, classId: this.identity.classId,
          // A fresh page resuming from storage has seen no events: ask for current state, not a replay.
          resumeToken: this.resumeToken, lastEventSequence: this.resumeToken && this.hasConnected ? this.eventSequence : undefined,
        });
      };
      socket.onmessage = (event: MessageEvent) => {
        if (this.socket !== socket) return;
        const message = decodeServerMessage(event.data);
        if (!message) {
          this.disconnect(new Error('Server sent an invalid message.'));
          return;
        }
        this.receive(message);
      };
      socket.onerror = () => {
        if (this.socket === socket) this.disconnect(new Error('Unable to connect to the co-op server.'));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.disconnect(new Error('Disconnected from the co-op server.'));
      };
    } catch (cause) {
      this.disconnect(cause instanceof Error ? cause : new Error('Unable to open WebSocket.'));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnect(new Error('Session disposed.'), false);
    this.snapshotListeners.clear();
    this.eventListeners.clear();
    this.worldListeners.clear();
    this.generationListeners.clear();
    this.phaseListeners.clear();
    this.connectionListeners.clear();
    this.contributionListeners.clear();
    this.lobbyListeners.clear();
    this.errorListeners.clear();
  }

  setDisplayName(name: string): void {
    const displayName = name.trim().slice(0, 24);
    if (displayName) this.updateIdentity({ ...(this.pendingIdentities.at(-1) ?? this.identity), displayName });
  }

  setClass(classId: PlayerIdentity['classId']): void {
    this.updateIdentity({ ...(this.pendingIdentities.at(-1) ?? this.identity), classId });
  }

  private updateIdentity(identity: PlayerIdentity): void {
    if (this.connection !== 'connected') {
      this.identity = PlayerIdentitySchema.parse(identity);
      return;
    }
    const previous = this.pendingIdentities.at(-1) ?? this.identity;
    if (identity.displayName === previous.displayName && identity.classId === previous.classId) return;
    this.pendingIdentities.push(PlayerIdentitySchema.parse(identity));
    if (!this.send({ type: 'identity', displayName: identity.displayName, classId: identity.classId })) {
      this.pendingIdentities.pop();
    }
  }

  submitContribution(text: string): Contribution | null {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 200 || this.connection !== 'connected'
      || this.contributions.length + this.pendingContributions.size >= 24) return null;
    const contribution: Contribution = {
      id: randomId('contrib'), playerId: this.localPlayerId, playerName: this.identity.displayName,
      text: trimmed, submittedAt: Date.now(),
    };
    if (!this.send({ type: 'contribution', text: trimmed, contributionId: contribution.id })) return null;
    this.pendingContributions.add(contribution.id);
    return contribution;
  }

  requestWorld(): Promise<PreparedWorld> {
    if (!this.getIsHost()) return Promise.reject(new Error('Only the connected host can prepare a world.'));
    if (this.pendingWorld) return Promise.reject(new Error('A world request is already in progress.'));
    const requestId = randomId('request');
    return new Promise<PreparedWorld>((resolve, reject) => {
      this.pendingWorld = {
        requestId, resolve, reject,
        timer: setTimeout(() => {
          this.rejectWorld(new Error('World generation timed out.'));
          this.notifyError('World generation timed out.');
        }, this.options.requestTimeoutMs ?? 90_000),
      };
      if (!this.send({ type: 'request_world', requestId })) this.rejectWorld(new Error('Not connected.'));
    });
  }

  enterPortal(): void { this.sendAction({ type: 'enter_portal' }); }
  returnToHeadquarters(): void { this.sendAction({ type: 'return_to_hq' }); }
  unlockAbility(): void { this.sendAction({ type: 'unlock_ability' }); }
  purchaseSkill(nodeId: string): void { this.sendAction({ type: 'purchase_skill', nodeId }); }
  /** Floors: everyone may vote; the server lets only the host's vote decide. */
  chooseBiome(biomeId: string): void { this.sendAction({ type: 'choose_biome', biomeId }); }

  private sendAction(message: ClientMessage): void {
    if (!this.send(message)) this.notifyError('Not connected to the co-op server.');
  }

  setIntent(intent: LocalIntent): void {
    if (this.connection !== 'connected') return;
    this.lastInputAt = Date.now();
    this.pendingIntent = {
      ...intent,
      attack: intent.attack || (this.pendingIntent?.attack ?? false),
      dash: intent.dash || (this.pendingIntent?.dash ?? false),
      ability: intent.ability ?? this.pendingIntent?.ability ?? null,
    };
  }

  onSnapshot(listener: (snapshot: GameSnapshot) => void): Unsubscribe { return subscribe(this.snapshotListeners, listener); }
  onEvents(listener: (events: GameEvent[]) => void): Unsubscribe { return subscribe(this.eventListeners, listener); }
  onWorld(listener: (world: PreparedWorld) => void): Unsubscribe { return subscribe(this.worldListeners, listener); }
  onGenerationStatus(listener: (status: GenerationStatus) => void): Unsubscribe { return subscribe(this.generationListeners, listener); }
  onPhase(listener: (phase: GamePhase) => void): Unsubscribe { return subscribe(this.phaseListeners, listener); }
  onConnectionStatus(listener: (status: ConnectionStatus) => void): Unsubscribe { return subscribe(this.connectionListeners, listener); }
  onContributions(listener: (contributions: Contribution[]) => void): Unsubscribe { return subscribe(this.contributionListeners, listener); }
  onLobby(listener: (lobby: Lobby) => void): Unsubscribe { return subscribe(this.lobbyListeners, listener); }
  onError(listener: (message: string) => void): Unsubscribe { return subscribe(this.errorListeners, listener); }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome': {
        if (!this.pendingStart) {
          this.disconnect(new Error('Unexpected welcome message.'));
          return;
        }
        this.identity = { ...this.identity, id: message.playerId };
        this.saveResume(message.resumeToken);
        this.intentSequence = 0;
        this.reconnectAttempts = 0;
        this.hasConnected = true;
        this.world = message.world;
        this.contributions = message.contributions;
        this.generation = message.generation;
        this.setLobby(message.lobby);
        this.setConnection('connected');
        if (message.world) for (const listener of this.worldListeners) listener(message.world);
        this.setSnapshot(message.snapshot);
        this.setContributions(message.contributions);
        this.setGeneration(message.generation);
        if (message.events.length) this.emitEvents(message.events);
        this.eventSequence = message.eventSequence;
        if (message.historyTruncated) this.notifyError('Reconnected with current state; older event history is unavailable.');
        this.inputTimer = setInterval(() => this.flushIntent(), TICK_MS);
        clearTimeout(this.pendingStart.timer);
        this.pendingStart.resolve();
        this.pendingStart = null;
        this.startPromise = null;
        break;
      }
      case 'lobby':
        this.setLobby(message.lobby);
        break;
      case 'snapshot':
        this.setSnapshot(message.snapshot);
        break;
      case 'events':
        if (message.eventSequence > this.eventSequence) {
          this.eventSequence = message.eventSequence;
          this.emitEvents(message.events);
        }
        break;
      case 'contributions':
        this.setContributions(message.contributions);
        break;
      case 'generation_status':
        this.setGeneration(message.status);
        if (message.status.phase === 'failed' && this.pendingWorld?.requestId === message.status.requestId) {
          this.rejectWorld(new Error(message.status.message));
        }
        break;
      case 'world':
        this.world = message.world;
        for (const listener of this.worldListeners) listener(message.world);
        if (this.pendingWorld?.requestId === message.requestId) {
          clearTimeout(this.pendingWorld.timer);
          this.pendingWorld.resolve(message.world);
          this.pendingWorld = null;
        }
        break;
      case 'error':
        if (message.action === 'hello' && this.resumeToken && this.pendingStart) {
          // Stale or in-use resume credential (server restarted, grace expired, second tab): join fresh.
          this.saveResume(undefined);
          this.eventSequence = 0;
          this.openSocket();
          break;
        }
        if (message.action === 'identity') {
          this.pendingIdentities.shift();
        }
        this.notifyError(message.message);
        if (message.action === 'contribution') this.pendingContributions.clear();
        if ((!message.action || message.action === 'request_world') && (!message.requestId || this.pendingWorld?.requestId === message.requestId)) {
          this.rejectWorld(new Error(message.message));
        }
        if (message.action === 'hello' || this.pendingStart) {
          this.saveResume(undefined);
          this.eventSequence = 0;
          this.disconnect(new Error(message.message), false);
        }
        break;
      case 'pong':
        break;
    }
  }

  private flushIntent(): void {
    if (!this.pendingIntent || Date.now() - this.lastInputAt > 250) return;
    this.send({ type: 'intent', intent: { ...this.pendingIntent, playerId: this.localPlayerId, seq: this.intentSequence++ } });
    this.pendingIntent = { ...this.pendingIntent, attack: false, dash: false, ability: null };
  }

  private setLobby(lobby: Lobby): void {
    this.lobby = lobby;
    const identity = lobby.players.find((player) => player.identity.id === this.localPlayerId)?.identity;
    if (identity) this.identity = identity;
    const pending = this.pendingIdentities[0];
    if (identity && identity.displayName === pending?.displayName && identity.classId === pending.classId) {
      this.pendingIdentities.shift();
    }
    for (const listener of this.lobbyListeners) listener(lobby);
  }

  private setSnapshot(snapshot: GameSnapshot): void {
    const phase = this.getPhase();
    this.snapshot = snapshot;
    for (const listener of this.snapshotListeners) listener(snapshot);
    if (snapshot.phase !== phase) for (const listener of this.phaseListeners) listener(snapshot.phase);
    this.hintReadiness(snapshot);
  }

  /** Tell the server the moment we step on or off the gate so the crew strip updates without waiting a tick. */
  private hintReadiness(snapshot: GameSnapshot): void {
    if (snapshot.phase !== 'headquarters' || snapshot.players.length < 2) {
      this.sentReady = null;
      return;
    }
    const ready = isAtDepartureGate(snapshot, this.localPlayerId);
    if (ready === this.sentReady) return;
    this.sentReady = ready;
    this.send({ type: 'ready', ready });
  }

  private setContributions(contributions: Contribution[]): void {
    this.contributions = contributions;
    for (const contribution of contributions) this.pendingContributions.delete(contribution.id);
    for (const listener of this.contributionListeners) listener(contributions);
  }

  private setGeneration(status: GenerationStatus): void {
    this.generation = status;
    for (const listener of this.generationListeners) listener(status);
  }

  private setConnection(status: ConnectionStatus): void {
    if (this.connection === status) return;
    this.connection = status;
    for (const listener of this.connectionListeners) listener(status);
  }

  private emitEvents(events: GameEvent[]): void {
    for (const listener of this.eventListeners) listener(events);
  }

  private notifyError(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    const parsed = ClientMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.notifyError('Invalid co-op action.');
      return false;
    }
    try {
      this.socket.send(encodeMessage(parsed.data));
      return true;
    } catch {
      this.disconnect(new Error('Unable to send to the co-op server.'));
      return false;
    }
  }

  private rejectWorld(error: Error): void {
    if (!this.pendingWorld) return;
    clearTimeout(this.pendingWorld.timer);
    this.pendingWorld.reject(error);
    this.pendingWorld = null;
  }

  private disconnect(error: Error, notify = true): void {
    if (this.inputTimer) clearInterval(this.inputTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.inputTimer = null;
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = () => {};
      socket.close();
    }
    if (this.pendingStart) {
      clearTimeout(this.pendingStart.timer);
      this.pendingStart.reject(error);
      this.pendingStart = null;
    }
    this.startPromise = null;
    this.rejectWorld(error);
    this.pendingIntent = null;
    this.pendingIdentities = [];
    this.pendingContributions.clear();
    this.setConnection('offline');
    if (notify && !this.disposed) this.notifyError(error.message);
    if (!this.disposed && this.hasConnected && this.options.reconnect !== false && this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => { void this.start().catch(() => {}); }, Math.min(1000 * this.reconnectAttempts, 5000));
    }
  }

  private defaultUrl(): string {
    const url = new URL('/ws', globalThis.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  }
}

function subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
