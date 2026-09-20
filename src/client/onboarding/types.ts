/**
 * Shapes for the onboarding layer. Nothing here imports React, the DOM or the renderer:
 * every trigger is a pure predicate over a context object, which is what makes each lesson
 * testable without a browser (docs/design/ONBOARDING.md §5).
 */
import type { GameEvent, GameSnapshot, PreparedWorld } from '../../shared/contracts';
import type { UiModel, UiPhase } from '../../shared/ui';

export type LessonGroup = 'hub' | 'controls' | 'rooms' | 'terrain' | 'laws' | 'finale';

/**
 * `device`: a fact about the world. Learned once, never repeated on this browser.
 * `run`: a control. Repeatable in a later session if the player never actually did it,
 * but retired for good the moment they do — prompted or not.
 */
export type LessonScope = 'device' | 'run';

/** What the local player has done since this run began, plus a few facts about the run. */
export interface RunFacts {
  /** Changes when the phase or the world changes; lets `run`-scoped lessons reset. */
  runId: string;
  moved: boolean;
  attacked: boolean;
  dashed: boolean;
  usedQ: boolean;
  usedE: boolean;
  usedR: boolean;
  unlockedE: boolean;
  openedMap: boolean;
  revivedSomeone: boolean;
  tookWeapon: boolean;
  contributed: boolean;
  /** A teammate is down right now. */
  teammateDown: boolean;
  /** The local player has been hit at least once this run: the trigger for the dash lesson. */
  tookDamage: boolean;
  /** Distinct room ids entered this run. */
  roomsEntered: number;
  /** Rooms cleared this run: the trigger for the Q lesson. */
  roomsCleared: number;
}

export function emptyFacts(runId = 'boot'): RunFacts {
  return {
    runId,
    moved: false,
    attacked: false,
    dashed: false,
    usedQ: false,
    usedE: false,
    usedR: false,
    unlockedE: false,
    openedMap: false,
    revivedSomeone: false,
    tookWeapon: false,
    contributed: false,
    teammateDown: false,
    tookDamage: false,
    roomsEntered: 0,
    roomsCleared: 0,
  };
}

export interface LessonContext {
  nowMs: number;
  phase: UiPhase;
  /** Milliseconds since the current phase began. */
  phaseMs: number;
  snapshot: GameSnapshot | null;
  model: UiModel;
  localPlayerId: string;
  /** Events delivered since the previous tick. */
  events: readonly GameEvent[];
  facts: RunFacts;
  /** The prepared world, for `recipe.terrainSkins` and the laws the UI model does not carry. */
  world: PreparedWorld | null;
  /** Feature ids present in the room the player is standing in, raw from `RoomSpec.tiles`. */
  terrainHere: readonly string[];
  /** Solo, or the co-op host. Guests get different hub wording. */
  isHost: boolean;
  isCoOp: boolean;
  /**
   * Something is covering the stage or demanding the player's whole attention: an enemy
   * telegraph, a live boss pattern, a lit canister fuse, the biome-choice overlay, the menu,
   * the departure ritual. No prompt appears while this is true.
   */
  blocked: boolean;
}

export interface Lesson {
  id: string;
  group: LessonGroup;
  scope: LessonScope;
  /** Rendered as key caps beside the words; not counted against the word budget. */
  keys?: readonly string[];
  /** The line. A function when the world writes half of it (terrain skins, law names). */
  text: string | ((ctx: LessonContext) => string | null);
  /** Higher wins when two lessons are ready in the same tick. */
  priority: number;
  /** Upper bound on how long the prompt stays if the player never does the thing. */
  holdMs: number;
  /** Recorded in Field Notes but never shown as a prompt: the live UI already says it. */
  silent?: boolean;
  trigger: (ctx: LessonContext) => boolean;
  /** The player did the thing. Retires the lesson for good on this device. */
  satisfied?: (ctx: LessonContext) => boolean;
}

export interface ActivePrompt {
  id: string;
  group: LessonGroup;
  keys: readonly string[];
  text: string;
  shownAtMs: number;
  expiresAtMs: number;
}

/** One line the player has actually been shown, kept for the Field Notes page. */
export interface FieldNote {
  id: string;
  group: LessonGroup;
  keys: readonly string[];
  text: string;
  atMs: number;
}

export interface OnboardingView {
  prompt: ActivePrompt | null;
  notes: readonly FieldNote[];
  hintsOff: boolean;
}
