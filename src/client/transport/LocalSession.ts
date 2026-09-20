/**
 * LocalSession — single-player GameSession. Runs the pure simulation in-process at a
 * fixed tick, requests worlds through a WorldProvider, and emits the same snapshots,
 * events and phases a RemoteSession will receive over WebSocket.
 *
 * Owner: Agent A. Multiplayer (RemoteSession + host authority) lands in feat/core.
 */
import {
  ATTRIBUTING_SOURCES,
  IDLE_GENERATION_STATUS,
  GenerationRequestSchema,
  GenerationStatusSchema,
  type Contribution,
  type GameEvent,
  type GameEventInput,
  type GamePhase,
  type GameSnapshot,
  type GenerationStatus,
  type PlayerIdentity,
  type PlayerIntent,
  type PreparedWorld,
} from '../../shared/contracts';
import { TICK_MS } from '../../shared/conventions';
import { randomId } from '../../shared/ids';
import type { ConnectionStatus, GameSession, LocalIntent, Unsubscribe } from '../../shared/session';
import { createSimulation, type Simulation } from '../../sim';
import { parseWorldPrefix, type WorldProvider, type WorldStreamOptions } from './worldProviders';

export interface LocalSessionOptions {
  identity: PlayerIdentity;
  worldProvider: WorldProvider;
  /** Injected for tests; defaults to setInterval/performance.now. */
  scheduler?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval; now: () => number };
}

const MAX_CATCHUP_TICKS = 5;

export class LocalSession implements GameSession {
  readonly mode = 'local' as const;
  readonly localPlayerId: string;

  private identity: PlayerIdentity;
  private readonly sim: Simulation;
  private readonly provider: WorldProvider;
  private readonly scheduler: NonNullable<LocalSessionOptions['scheduler']>;
  private readonly sessionId = randomId('session');

  private contributions: Contribution[] = [];
  private world: PreparedWorld | null = null;
  private generation: GenerationStatus = IDLE_GENERATION_STATUS;
  private connection: ConnectionStatus = 'offline';
  private snapshot: GameSnapshot | null = null;

  private pendingIntent: LocalIntent | null = null;
  private intentSeq = 0;
  private metaEventCounter = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private disposed = false;
  private activeGeneration: AbortController | null = null;
  private lastPhase: GamePhase = 'headquarters';

  private snapshotListeners = new Set<(s: GameSnapshot) => void>();
  private eventListeners = new Set<(e: GameEvent[]) => void>();
  private worldListeners = new Set<(w: PreparedWorld) => void>();
  private generationListeners = new Set<(g: GenerationStatus) => void>();
  private phaseListeners = new Set<(p: GamePhase) => void>();

  constructor(options: LocalSessionOptions) {
    this.identity = options.identity;
    this.localPlayerId = options.identity.id;
    this.provider = options.worldProvider;
    this.scheduler = options.scheduler ?? {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      now: () => performance.now(),
    };
    this.sim = createSimulation();
    this.sim.addPlayer(this.identity);
  }

  // ---- lifecycle -------------------------------------------------------------

  async start(): Promise<void> {
    if (this.disposed) throw new Error('Session has been disposed.');
    if (this.timer !== null) return;
    this.connection = 'connected';
    this.lastTime = this.scheduler.now();
    this.snapshot = this.sim.getSnapshot();
    this.timer = this.scheduler.setInterval(() => this.pump(), TICK_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.activeGeneration?.abort();
    this.activeGeneration = null;
    if (this.timer !== null) this.scheduler.clearInterval(this.timer);
    this.timer = null;
    this.connection = 'offline';
  }

  /** Advance simulation time manually (tests) — same code path as the interval. */
  advance(ms: number): void {
    if (this.disposed) return;
    this.accumulator += ms;
    this.drain();
  }

  private pump(): void {
    if (this.disposed) return;
    const now = this.scheduler.now();
    this.accumulator += now - this.lastTime;
    this.lastTime = now;
    this.drain();
  }

  private drain(): void {
    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      this.accumulator -= TICK_MS;
      this.tick();
      ticks++;
    }
    if (this.accumulator >= TICK_MS) this.accumulator = 0; // dropped frames: do not spiral
  }

  private tick(): void {
    if (this.pendingIntent) {
      const intent: PlayerIntent = { ...this.pendingIntent, playerId: this.localPlayerId, seq: this.intentSeq++ };
      this.sim.applyIntent(intent);
      // buttons are edge-triggered; movement/aim persist until the next setIntent
      this.pendingIntent = { ...this.pendingIntent, attack: false, dash: false, ability: null };
    }
    const events = this.sim.step();
    const followUps = this.handleSimEvents(events);
    this.snapshot = this.sim.getSnapshot();
    const all = followUps.length ? [...events, ...followUps] : events;
    if (all.length) this.emitEvents(all);
    for (const l of this.snapshotListeners) l(this.snapshot);
    this.notifyPhase();
  }

  private handleSimEvents(events: GameEvent[]): GameEvent[] {
    const extra: GameEvent[] = [];
    for (const event of events) {
      if (event.type !== 'exit_reached') continue;
      if (this.sim.getPhase() === 'training') {
        // The range's only exit leads home.
        extra.push(...this.sim.returnToHeadquarters());
      } else if (this.sim.getPhase() === 'headquarters') {
        if (this.world) extra.push(...this.enterRoom(0));
        else this.setGeneration({ ...this.generation, message: 'Prepare a world before entering the portal.' });
      } else if (this.world) {
        if (event.toRoomIndex < this.world.rooms.length) extra.push(...this.enterRoom(event.toRoomIndex));
        else this.setGeneration({ ...this.generation, message: `Room ${event.toRoomIndex + 1} is not committed yet.` });
      }
    }
    return extra;
  }

  // ---- identity --------------------------------------------------------------

  getLocalPlayer(): PlayerIdentity {
    return this.identity;
  }
  setDisplayName(name: string): void {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return;
    this.identity = { ...this.identity, displayName: trimmed };
    this.sim.updatePlayerIdentity(this.identity);
  }
  setClass(classId: PlayerIdentity['classId']): void {
    this.identity = { ...this.identity, classId };
    this.sim.updatePlayerIdentity(this.identity);
  }

  // ---- headquarters actions --------------------------------------------------

  submitContribution(text: string): Contribution | null {
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed || this.contributions.length >= 24) return null;
    const contribution: Contribution = {
      id: randomId('contrib'),
      playerId: this.localPlayerId,
      playerName: this.identity.displayName,
      text: trimmed,
      submittedAt: Date.now(),
    };
    this.contributions = [...this.contributions, contribution];
    this.emitEvents([this.metaEvent({ type: 'contribution_submitted', contributionId: contribution.id, playerId: this.localPlayerId })]);
    return contribution;
  }

  getContributions(): Contribution[] {
    return this.contributions;
  }

  unlockAbility(): void {
    if (this.disposed) return;
    const events = this.sim.unlockAbility(this.localPlayerId);
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const listener of this.snapshotListeners) listener(this.snapshot);
  }

  enterTraining(): boolean {
    if (this.disposed || this.sim.getPhase() !== 'headquarters') return false;
    const events = this.sim.enterTraining();
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const listener of this.snapshotListeners) listener(this.snapshot);
    this.notifyPhase();
    return true;
  }

  async requestWorld(): Promise<PreparedWorld> {
    if (this.disposed) throw new Error('Session has been disposed.');
    this.activeGeneration?.abort();
    const controller = new AbortController();
    this.activeGeneration = controller;
    const requestId = randomId('req');
    const startedAt = Date.now();
    const request = GenerationRequestSchema.parse({
      requestId,
      sessionId: this.sessionId,
      contributions: this.contributions,
      plannedRoomCount: 3,
    });
    const current = () => !this.disposed && this.activeGeneration === controller && !controller.signal.aborted;
    this.setGeneration({ phase: 'queued', message: 'Requesting a world…', requestId, startedAt, elapsedMs: 0 });
    return new Promise<PreparedWorld>((resolve, reject) => {
      const aborted = () => reject(new DOMException('World request cancelled.', 'AbortError'));
      if (controller.signal.aborted) {
        aborted();
        return;
      }
      controller.signal.addEventListener('abort', aborted, { once: true });
      const options: WorldStreamOptions = {
        signal: controller.signal,
        onStatus: (rawStatus) => {
          if (!current()) return;
          const status = GenerationStatusSchema.parse(rawStatus);
          if (status.requestId !== requestId) throw new Error('Mismatched generation status.');
          this.setGeneration(status);
          if (status.phase === 'failed') throw new Error(status.message);
        },
      };
      const provider = this.provider;
      const consume = async () => {
        let previous: PreparedWorld | undefined;
        try {
          const worlds = provider.prepareWorldStream
            ? provider.prepareWorldStream(request, options)
            : (async function* () { yield await provider.prepareWorld(request, options); })();
          for await (const rawWorld of worlds) {
            if (!current()) return;
            const world = parseWorldPrefix(rawWorld, request, previous);
            const first = !previous;
            previous = structuredClone(world);
            this.world = world;
            this.sim.setWorld(world);
            this.setGeneration({
              phase: ATTRIBUTING_SOURCES.has(world.provenance.source) ? 'ready' : 'fallback',
              message: `${world.provenance.label}: ${world.rooms.length}/${world.plannedRoomCount} rooms ready.`,
              requestId, startedAt, elapsedMs: Date.now() - startedAt,
            });
            if (!current()) return;
            for (const l of this.worldListeners) l(world);
            if (!current()) return;
            if (first) {
              this.emitEvents([
                this.metaEvent({
                  type: 'world_prepared', worldId: world.worldId, worldTitle: world.recipe.title,
                  source: world.provenance.source, playerIds: this.sim.getPlayerIds(),
                }),
              ]);
              resolve(world);
            }
          }
          if (current() && (!previous || previous.rooms.length < previous.plannedRoomCount)) {
            throw new Error('World stream ended before all rooms were committed.');
          }
        } catch (error) {
          if (current()) {
            const detail = error instanceof Error ? error.message : 'World generation failed.';
            const message = previous ? `Committed rooms remain playable. ${detail}` : detail;
            this.setGeneration({ phase: 'failed', message: message.slice(0, 200), requestId, startedAt, elapsedMs: Date.now() - startedAt });
            reject(error);
          }
        } finally {
          controller.signal.removeEventListener('abort', aborted);
          if (this.activeGeneration === controller) this.activeGeneration = null;
          controller.abort();
        }
      };
      void consume();
    });
  }

  enterPortal(): void {
    if (this.disposed || !this.world || this.sim.getPhase() !== 'headquarters') return;
    const events = this.enterRoom(0);
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const l of this.snapshotListeners) l(this.snapshot);
  }

  /** Preview helper: jump straight to a committed room index (used by ?room=N). */
  enterRoomIndex(index: number): void {
    if (this.disposed || !this.world || !Number.isInteger(index) || index < 0 || index >= this.world.rooms.length) return;
    const events = this.enterRoom(index);
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const l of this.snapshotListeners) l(this.snapshot);
  }

  returnToHeadquarters(): void {
    if (this.disposed || this.sim.getPhase() === 'headquarters') return;
    const events = this.sim.returnToHeadquarters();
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    this.notifyPhase();
    for (const l of this.snapshotListeners) l(this.snapshot);
  }

  private enterRoom(index: number): GameEvent[] {
    const events = this.sim.enterRoom(index);
    this.notifyPhase();
    return events;
  }

  private notifyPhase(): void {
    const phase = this.sim.getPhase();
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    for (const listener of this.phaseListeners) listener(phase);
  }

  // ---- live state ------------------------------------------------------------

  getPhase(): GamePhase {
    return this.sim.getPhase();
  }
  getConnectionStatus(): ConnectionStatus {
    return this.connection;
  }
  getWorld(): PreparedWorld | null {
    return this.world;
  }
  getGenerationStatus(): GenerationStatus {
    return this.generation;
  }
  getSnapshot(): GameSnapshot | null {
    return this.snapshot;
  }

  setIntent(intent: LocalIntent): void {
    const prev = this.pendingIntent;
    this.pendingIntent = {
      ...intent,
      attack: intent.attack || (prev?.attack ?? false),
      dash: intent.dash || (prev?.dash ?? false),
      ability: intent.ability ?? prev?.ability ?? null,
    };
  }

  // ---- subscriptions ---------------------------------------------------------

  onSnapshot(listener: (s: GameSnapshot) => void): Unsubscribe {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }
  onEvents(listener: (e: GameEvent[]) => void): Unsubscribe {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  onWorld(listener: (w: PreparedWorld) => void): Unsubscribe {
    this.worldListeners.add(listener);
    return () => this.worldListeners.delete(listener);
  }
  onGenerationStatus(listener: (g: GenerationStatus) => void): Unsubscribe {
    this.generationListeners.add(listener);
    return () => this.generationListeners.delete(listener);
  }
  onPhase(listener: (p: GamePhase) => void): Unsubscribe {
    this.phaseListeners.add(listener);
    return () => this.phaseListeners.delete(listener);
  }

  // ---- internals -------------------------------------------------------------

  private emitEvents(events: GameEvent[]): void {
    for (const l of this.eventListeners) l(events);
  }

  private setGeneration(status: GenerationStatus): void {
    this.generation = status;
    for (const l of this.generationListeners) l(status);
  }

  private metaEvent(partial: GameEventInput): GameEvent {
    const tick = this.sim.getTick();
    return { ...partial, id: `meta:${++this.metaEventCounter}`, tick, timeMs: tick * TICK_MS } as GameEvent;
  }
}
