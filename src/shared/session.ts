/**
 * GameSession — the ONE client-facing interface for "being in a RELAY session".
 *
 * Owner: Agent A.
 *  - LocalSession (src/client/transport/LocalSession.ts) runs the simulation in-process.
 *  - RemoteSession speaks the WebSocket protocol in protocol.ts.
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
  PreparedWorld,
} from './contracts';

export type Unsubscribe = () => void;

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
  removeContribution?(contributionId: string): boolean;
  getContributions(): Contribution[];
  /** Asks the authority (server or host) to prepare a world from current contributions. */
  requestWorld(): Promise<PreparedWorld>;
  /** Moves everyone into room 0 of the prepared world. No-op without a world. */
  enterPortal(): void;
  returnToHeadquarters(): void;
  /** Optional: HQ practice range. Solo sessions implement it; co-op returns false. */
  enterTraining?(): boolean;

  // --- live state ---
  getPhase(): GamePhase;
  getConnectionStatus(): ConnectionStatus;
  getIsHost?(): boolean;
  unlockAbility?(): void;
  /** S1: buy one skill-tree node for the local operative; the sim is authoritative. */
  purchaseSkill?(nodeId: string): void;
  /** Floors: vote for (solo/host: decide) the next biome while `snapshot.floor.biomeChoice` is open. */
  chooseBiome?(biomeId: string): void;
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
  onError?(listener: (message: string) => void): Unsubscribe;
}
