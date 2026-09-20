/**
 * UiModel / UiActions — the boundary between Agent C's React UI and Agent A's
 * controllers. The UI renders UiModel and calls UiActions. It never touches the
 * simulation, the session or the renderer directly.
 *
 * Owner: Agent A (keys/shape). Agent C proposes additions via integration request.
 */
import type {
  ClassId,
  ImplementationStatus,
  MotifId,
} from './registry';
import type {
  AnchorState,
  Attunement,
  Contribution,
  CreationReceipt,
  GenerationProvenance,
  GenerationStatus,
  LoreFragment,
  MemoryRecord,
  Palette,
  PlayerActionState,
} from './contracts';
import type { ConnectionStatus, SessionMode } from './session';

export type UiPhase = 'headquarters' | 'preparing' | 'training' | 'expedition' | 'debrief';

export interface UiPlayer {
  id: string;
  displayName: string;
  classId: ClassId;
  isLocal: boolean;
  /** Live vitals from the authoritative snapshot (absent before the first snapshot). */
  hp?: number;
  maxHp?: number;
  state?: PlayerActionState;
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
  /** Every fragment the world holds; the Codex shows undiscovered ones as ???. */
  lore: LoreFragment[];
  /** World-grown skill nodes (see src/shared/skills.ts). */
  attunements: Attunement[];
  /** Visual identity for reveal/loading UI (from the compiled ArtRecipe). */
  palette?: Palette;
  motifIds?: MotifId[];
  /** Names of the rooms committed so far. */
  roomNames?: string[];
}

export interface UiRoomSummary {
  index: number;
  name: string;
  description: string;
  isFinal: boolean;
}

export interface UiHud {
  hp: number;
  maxHp: number;
  state: PlayerActionState;
  dashReady: boolean;
  dashCooldownMs: number;
  attackReady: boolean;
  enemiesRemaining: number;
  resources?: number;
  abilityEUnlocked?: boolean;
  abilityQCooldownMs?: number;
  abilityECooldownMs?: number;
  reviveProgress?: number;
  roomCleared?: boolean;
  anchor?: AnchorState | null;
  /** Ultimate charge 0..100 and the short post-fire lockout. */
  ultCharge?: number;
  abilityRCooldownMs?: number;
  /** Training range only: which target is awake and how it attacks (for the practice notes). */
  training?: { awakeEnemyIds: string[] } | null;
}

export interface UiModel {
  phase: UiPhase;
  connection: { mode: SessionMode; status: ConnectionStatus; isHost?: boolean };
  audioMuted?: boolean;
  localPlayer: UiPlayer;
  players: UiPlayer[];
  contributions: Contribution[];
  generation: GenerationStatus;
  /** From /api/config: whether the server has live-generation credentials at all. */
  liveGenerationAvailable: boolean;
  world: UiWorldSummary | null;
  room: UiRoomSummary | null;
  hud: UiHud | null;
  /** Indices into `world.lore` discovered this run (authoritative, from the snapshot). */
  discoveredLore: number[];
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
  clearMemories(): void;
  dismissNotice(): void;
  toggleAudio?(): void;
  unlockAbility?(): void;
  /** Solo only: enter the HQ training range (respawning targets, every ability unlocked). */
  enterTraining?(): void;
}
