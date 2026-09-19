/**
 * LocalSession — single-player GameSession. Runs the pure simulation in-process at a
 * fixed tick, requests worlds through a WorldProvider, and emits the same snapshots,
 * events and phases a RemoteSession will receive over WebSocket.
 *
 * Owner: Agent A. Multiplayer (RemoteSession + host authority) lands in feat/core.
 */
import {
  IDLE_GENERATION_STATUS,
  type Contribution,
  type GameEvent,
  type GameEventInput,
  type GamePhase,
  type GameSnapshot,
  type GenerationStatus,
  type PlayerIdentity,
  type PlayerIntent,
  type PlayerProfile,
  type PreparedWorld,
} from '../../shared/contracts';
import { TICK_MS } from '../../shared/conventions';
import { randomId } from '../../shared/ids';
import { ABILITY_INFO, type AbilityId } from '../../shared/registry';
import type { ConnectionStatus, GameSession, LocalIntent, ProfileStore, PurchaseResult, Unsubscribe } from '../../shared/session';
import { createSimulation, type Simulation } from '../../sim';
import { createMemoryProfileStore } from '../game/profile';
import type { WorldProvider } from './worldProviders';

export interface LocalSessionOptions {
  identity: PlayerIdentity;
  worldProvider: WorldProvider;
  /** Device-local progression. Defaults to an in-memory store (tests). */
  profile?: ProfileStore;
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
  private readonly profileStore: ProfileStore;
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

  private snapshotListeners = new Set<(s: GameSnapshot) => void>();
  private eventListeners = new Set<(e: GameEvent[]) => void>();
  private worldListeners = new Set<(w: PreparedWorld) => void>();
  private generationListeners = new Set<(g: GenerationStatus) => void>();
  private phaseListeners = new Set<(p: GamePhase) => void>();
  private profileListeners = new Set<(p: PlayerProfile) => void>();

  constructor(options: LocalSessionOptions) {
    this.identity = options.identity;
    this.localPlayerId = options.identity.id;
    this.provider = options.worldProvider;
    this.profileStore = options.profile ?? createMemoryProfileStore(options.identity.id);
    this.scheduler = options.scheduler ?? {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      now: () => performance.now(),
    };
    this.sim = createSimulation();
    this.sim.addPlayer(this.identity, this.profileStore.get().unlockedAbilityIds);
  }

  // ---- lifecycle -------------------------------------------------------------

  async start(): Promise<void> {
    if (this.timer) return;
    this.connection = 'connected';
    this.lastTime = this.scheduler.now();
    this.snapshot = this.sim.getSnapshot();
    this.timer = this.scheduler.setInterval(() => this.pump(), TICK_MS);
  }

  dispose(): void {
    if (this.timer) this.scheduler.clearInterval(this.timer);
    this.timer = null;
    this.connection = 'offline';
  }

  /** Advance simulation time manually (tests) — same code path as the interval. */
  advance(ms: number): void {
    this.accumulator += ms;
    this.drain();
  }

  private pump(): void {
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
      // buttons are edge-triggered; movement/aim/interact persist until the next setIntent
      this.pendingIntent = { ...this.pendingIntent, attack: false, dash: false, ability: null };
    }
    const events = this.sim.step();
    const followUps = this.handleSimEvents(events);
    this.snapshot = this.sim.getSnapshot();
    const all = followUps.length ? [...events, ...followUps] : events;
    if (all.length) this.emitEvents(all);
    for (const l of this.snapshotListeners) l(this.snapshot);

    // Ended runs return to HQ automatically once the countdown expires (retry from the portal).
    const run = this.sim.getRun();
    if (this.sim.getPhase() === 'expedition' && (run.status === 'anchored' || run.status === 'collapsed') && run.returnCountdownMs <= 0) {
      this.returnToHeadquarters();
    }
  }

  private handleSimEvents(events: GameEvent[]): GameEvent[] {
    const extra: GameEvent[] = [];
    for (const event of events) {
      if (event.type === 'run_ended') {
        this.bankRunShards();
        continue;
      }
      if (event.type !== 'exit_reached') continue;
      if (this.sim.getPhase() === 'headquarters') {
        if (this.world) extra.push(...this.enterRoom(0));
        else this.setGeneration({ ...this.generation, message: 'Prepare a world before entering the portal.' });
      } else if (this.world) {
        if (event.toRoomIndex < this.world.rooms.length) extra.push(...this.enterRoom(event.toRoomIndex));
        else this.setGeneration({ ...this.generation, message: `Room ${event.toRoomIndex + 1} is not committed yet.` });
      }
    }
    return extra;
  }

  /** Shards earned in the run that just ended become permanent profile shards (once per run). */
  private bankRunShards(): void {
    const me = this.sim.getSnapshot().players.find((p) => p.id === this.localPlayerId);
    const earned = Math.round(me?.shards ?? 0);
    const profile = this.profileStore.get();
    this.saveProfile({ ...profile, shards: profile.shards + earned, runsPlayed: profile.runsPlayed + 1, updatedAt: Date.now() });
  }

  // ---- progression -------------------------------------------------------------

  getProfile(): PlayerProfile {
    return this.profileStore.get();
  }

  purchaseUnlock(abilityId: AbilityId): PurchaseResult {
    const info = ABILITY_INFO[abilityId];
    if (!info) return { ok: false, reason: 'Unknown ability.' };
    if (info.cost <= 0) return { ok: false, reason: `${info.name} is already available.` };
    if (info.classId && info.classId !== this.identity.classId) return { ok: false, reason: `${info.name} belongs to ${info.classId}.` };
    const profile = this.profileStore.get();
    if (profile.unlockedAbilityIds.includes(abilityId)) return { ok: false, reason: `${info.name} is already unlocked.` };
    if (profile.shards < info.cost) return { ok: false, reason: `Need ${info.cost} shards (you have ${profile.shards}).` };
    const next: PlayerProfile = {
      ...profile,
      shards: profile.shards - info.cost,
      unlockedAbilityIds: [...profile.unlockedAbilityIds, abilityId],
      updatedAt: Date.now(),
    };
    this.saveProfile(next);
    this.sim.setPlayerUnlocks(this.localPlayerId, next.unlockedAbilityIds);
    this.snapshot = this.sim.getSnapshot();
    this.emitEvents([this.metaEvent({ type: 'ability_unlocked', playerId: this.localPlayerId, abilityId, cost: info.cost })]);
    return { ok: true, profile: next };
  }

  onProfile(listener: (profile: PlayerProfile) => void): Unsubscribe {
    this.profileListeners.add(listener);
    return () => this.profileListeners.delete(listener);
  }

  private saveProfile(profile: PlayerProfile): void {
    this.profileStore.save(profile);
    for (const l of this.profileListeners) l(this.profileStore.get());
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
    this.sim.setPlayerUnlocks(this.localPlayerId, this.profileStore.get().unlockedAbilityIds);
    this.snapshot = this.sim.getSnapshot();
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

  async requestWorld(): Promise<PreparedWorld> {
    const requestId = randomId('req');
    const startedAt = Date.now();
    this.setGeneration({ phase: 'queued', message: 'Requesting a world…', requestId, startedAt, elapsedMs: 0 });
    try {
      const world = await this.provider.prepareWorld({
        requestId,
        sessionId: this.sessionId,
        contributions: this.contributions,
        plannedRoomCount: 3,
      });
      this.world = world;
      this.sim.setWorld(world);
      this.setGeneration({
        phase: world.provenance.source === 'live' ? 'ready' : 'fallback',
        message: `${world.provenance.label}: “${world.recipe.title}” ready.`,
        requestId,
        startedAt,
        elapsedMs: Date.now() - startedAt,
      });
      for (const l of this.worldListeners) l(world);
      this.emitEvents([
        this.metaEvent({
          type: 'world_prepared',
          worldId: world.worldId,
          worldTitle: world.recipe.title,
          source: world.provenance.source,
          playerIds: this.sim.getPlayerIds(),
        }),
      ]);
      return world;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setGeneration({ phase: 'failed', message, requestId, startedAt, elapsedMs: Date.now() - startedAt });
      throw err;
    }
  }

  enterPortal(): void {
    if (!this.world || this.sim.getPhase() !== 'headquarters') return;
    const events = this.enterRoom(0);
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const l of this.snapshotListeners) l(this.snapshot);
  }

  /** Preview helper: jump straight to a committed room index (used by ?room=N). */
  enterRoomIndex(index: number): void {
    if (!this.world || index >= this.world.rooms.length) return;
    const events = this.enterRoom(index);
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const l of this.snapshotListeners) l(this.snapshot);
  }

  returnToHeadquarters(): void {
    if (this.sim.getPhase() === 'headquarters') return;
    const events = this.sim.returnToHeadquarters();
    this.handleSimEvents(events); // banks shards for an aborted run
    this.snapshot = this.sim.getSnapshot();
    if (events.length) this.emitEvents(events);
    for (const l of this.phaseListeners) l('headquarters');
    for (const l of this.snapshotListeners) l(this.snapshot);
  }

  private enterRoom(index: number): GameEvent[] {
    const wasPhase = this.sim.getPhase();
    const events = this.sim.enterRoom(index);
    if (wasPhase !== 'expedition') for (const l of this.phaseListeners) l('expedition');
    return events;
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
      // buttons: OR until consumed; held flags (interact) and axes: latest wins
      attack: intent.attack || (prev?.attack ?? false),
      dash: intent.dash || (prev?.dash ?? false),
      ability: intent.ability ?? prev?.ability ?? null,
    };
  }

  /** Clear all held input (blur, focus loss, scene transition). */
  clearIntent(): void {
    this.pendingIntent = this.pendingIntent
      ? { ...this.pendingIntent, moveX: 0, moveY: 0, attack: false, dash: false, ability: null, interact: false }
      : null;
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
