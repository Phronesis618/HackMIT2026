/**
 * GameSession — the ONE client-facing interface for "being in a RELAY session".
 *
 * Owner: Agent A.
 *  - LocalSession (src/client/transport/LocalSession.ts) runs the simulation in-process.
 *  - RemoteSession (future, Agent A) will speak the WebSocket protocol in protocol.ts.
 *  Renderer, UI and Chronicle only ever see this interface, so single-player and
 *  two-laptop multiplayer share every other line of client code.
 */
import type {
  Contribution,
  GameEvent,
  GamePhase,
  GameSnapshot,
  GenerationStatus,
  PlayerIdentity,
  PlayerIntent,
  PlayerProfile,
  PreparedWorld,
} from './contracts';
import type { AbilityId } from './registry';

export type Unsubscribe = () => void;

/** Result of an unlock purchase. Validated by the authority (local session or LAN host). */
export type PurchaseResult = { ok: true; profile: PlayerProfile } | { ok: false; reason: string };

/**
 * Device-local progression store. The foundation adapter lives in src/client/game/profile.ts;
 * Agent C may replace it with the Chronicle persistence adapter later. Never cross-device.
 */
export interface ProfileStore {
  get(): PlayerProfile;
  save(profile: PlayerProfile): void;
}

/** Intent without identity/sequence — the session stamps those. */
export type LocalIntent = Omit<PlayerIntent, 'playerId' | 'seq'>;

export type SessionMode = 'local' | 'remote';
export type ConnectionStatus = 'offline' | 'connecting' | 'connected';

export interface GameSession {
  readonly mode: SessionMode;
  readonly localPlayerId: string;

  /** Connect / initialise. Resolves once the session can accept actions. */
  start(): Promise<void>;
  dispose(): void;

  // --- identity ---
  getLocalPlayer(): PlayerIdentity;
  setDisplayName(name: string): void;
  setClass(classId: PlayerIdentity['classId']): void;

  // --- headquarters actions ---
  submitContribution(text: string): Contribution | null;
  getContributions(): Contribution[];
  /** Asks the authority (server or host) to prepare a world from current contributions. */
  requestWorld(): Promise<PreparedWorld>;
  /** Moves everyone into room 0 of the prepared world. No-op without a world. */
  enterPortal(): void;
  returnToHeadquarters(): void;

  // --- progression (device-local profile; host-validated in LAN) ---
  getProfile(): PlayerProfile;
  /** Spend shards on a permanent unlock. Checks availability, cost, ownership, duplicates. */
  purchaseUnlock(abilityId: AbilityId): PurchaseResult;
  onProfile(listener: (profile: PlayerProfile) => void): Unsubscribe;

  // --- live state ---
  getPhase(): GamePhase;
  getConnectionStatus(): ConnectionStatus;
  getWorld(): PreparedWorld | null;
  getGenerationStatus(): GenerationStatus;
  getSnapshot(): GameSnapshot | null;

  /** Per-frame input from the local player. Applied at the next simulation tick. */
  setIntent(intent: LocalIntent): void;

  // --- subscriptions ---
  onSnapshot(listener: (snapshot: GameSnapshot) => void): Unsubscribe;
  /** Batched, ordered, id-unique events. Chronicle and renderer effects hang off this. */
  onEvents(listener: (events: GameEvent[]) => void): Unsubscribe;
  onWorld(listener: (world: PreparedWorld) => void): Unsubscribe;
  onGenerationStatus(listener: (status: GenerationStatus) => void): Unsubscribe;
  onPhase(listener: (phase: GamePhase) => void): Unsubscribe;
}
