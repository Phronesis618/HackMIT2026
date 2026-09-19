/**
 * UiModel / UiActions — the boundary between Agent C's React UI and Agent A's
 * controllers. The UI renders UiModel and calls UiActions. It never touches the
 * simulation, the session or the renderer directly.
 *
 * Owner: Agent A (keys/shape). Agent C proposes additions via integration request.
 */
import type { AbilityId, AbilitySlot, ClassId, ImplementationStatus } from './registry';
import type {
  Contribution,
  CreationReceipt,
  GenerationProvenance,
  GenerationStatus,
  MemoryRecord,
  PlayerActionState,
  PlayerProfile,
  RunState,
} from './contracts';
import type { ConnectionStatus, SessionMode } from './session';

export type UiPhase = 'headquarters' | 'preparing' | 'expedition' | 'debrief';

export interface UiPlayer {
  id: string;
  displayName: string;
  classId: ClassId;
  isLocal: boolean;
}

export interface UiWorldSummary {
  worldId: string;
  title: string;
  tagline: string;
  themeSummary: string;
  provenance: GenerationProvenance;
  receipt: CreationReceipt;
  committedRoomCount: number;
  plannedRoomCount: number;
}

export interface UiRoomSummary {
  index: number;
  name: string;
  description: string;
  isFinal: boolean;
}

export interface UiAbilitySlot {
  slot: AbilitySlot;
  abilityId: AbilityId | null; // null = this class has no ability in this slot yet
  name: string;
  key: string; // display key, e.g. "Q"
  /** 'ready' | 'cooldown' | 'locked' (needs unlock) | 'planned' (not implemented) */
  status: 'ready' | 'cooldown' | 'locked' | 'planned';
  cooldownMs: number;
  cooldownTotalMs: number;
}

export interface UiHud {
  hp: number;
  maxHp: number;
  state: PlayerActionState;
  dashReady: boolean;
  dashCooldownMs: number;
  attackReady: boolean;
  enemiesRemaining: number;
  /** Q / E as the HUD should show them (truthful about locked/planned). */
  abilities: UiAbilitySlot[];
  shieldMs: number;
  shardsThisRun: number;
  /** Objective line derived by the simulation (e.g. "Clear 2 hostiles to unlock the exit"). */
  objective: string;
  roomCleared: boolean;
  exitsLocked: boolean;
  /** 0..1 while holding F on the Anchor / a downed ally. */
  interactProgress: number;
  isDown: boolean;
}

export interface UiUnlockOffer {
  abilityId: AbilityId;
  name: string;
  description: string;
  slot: AbilitySlot;
  classId: ClassId | null;
  cost: number;
  owned: boolean;
  affordable: boolean;
  /** false when the ability belongs to another class than the local player's. */
  applicable: boolean;
}

export interface UiModel {
  phase: UiPhase;
  connection: { mode: SessionMode; status: ConnectionStatus };
  localPlayer: UiPlayer;
  players: UiPlayer[];
  contributions: Contribution[];
  generation: GenerationStatus;
  /** From /api/config: whether the server has live-generation credentials at all. */
  liveGenerationAvailable: boolean;
  world: UiWorldSummary | null;
  room: UiRoomSummary | null;
  hud: UiHud | null;
  /** Device-local progression + what the HQ can sell right now. */
  profile: PlayerProfile;
  unlockOffers: UiUnlockOffer[];
  run: RunState;
  memories: MemoryRecord[];
  /** Truthful implementation status, for the class picker and HUD hints. */
  classStatus: Record<ClassId, ImplementationStatus>;
  /** Preview flags (from URL) so the UI can show a "PREVIEW" ribbon. */
  preview: { fixtureWorld: boolean; startRoom: number | null };
  /** Transient message from controllers (e.g. "prepare a world first"). */
  notice: { kind: 'info' | 'error'; text: string } | null;
}

export interface UiActions {
  setDisplayName(name: string): void;
  selectClass(classId: ClassId): void;
  submitContribution(text: string): void;
  requestWorld(): void;
  enterPortal(): void;
  returnToHeadquarters(): void;
  /** Spend shards on a permanent unlock (validated by the session/host). */
  purchaseUnlock(abilityId: AbilityId): void;
  clearMemories(): void;
  dismissNotice(): void;
}
