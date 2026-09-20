/**
 * WorldRenderer — the boundary between Agent A's GameController and Agent C's
 * Phaser rendering. The renderer draws what it is told; it never decides gameplay.
 *
 * Owner: Agent A (shape). Implementation: Agent C in src/client/render/.
 * Foundation implementation: PhaserWorldRenderer (placeholder art, real wiring).
 */
import type { ArtRecipe, GameEvent, GameSnapshot, ReceiptLine, RoomSpec } from './contracts';
import type { WorldLook } from './laws';

export interface WorldRenderer {
  /** Create the canvas inside `container`. Resolves when the first scene is ready. */
  mount(container: HTMLElement): Promise<void>;
  /**
   * Headquarters view. The HQ is a built-in RoomSpec (src/sim/headquarters.ts) whose
   * 'X' tile is the portal; the renderer may add sanctuary-specific decoration.
   */
  showHeadquarters(room: RoomSpec, art: ArtRecipe): void;
  /**
   * Build a room from trusted data. Called once per room entry; may be called again for a
   * new room. `loreLines` (the creation receipt) lets the renderer surface player-authored
   * worldbuilding in-world, near whatever it actually shaped, instead of as sidebar prose.
   * `world` (title + tagline of the generated world) lets the renderer label rooms and
   * stencil the world's name into the arrival room. Both are validated recipe text.
   */
  showRoom(room: RoomSpec, art: ArtRecipe, loreLines?: ReceiptLine[], world?: WorldPresentation): void;
  /** Called every animation frame with the latest authoritative snapshot. */
  renderSnapshot(snapshot: GameSnapshot, localPlayerId: string): void;
  /** Fire-and-forget visual/audio reactions to events (dash trail, hit flash, ...). */
  playEvents(events: GameEvent[]): void;
  /** Convert a pointer position relative to the canvas into world coordinates (for aiming). */
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** Optional: capture a small JPEG/PNG data URL for keepsakes. May return null. */
  captureThumbnail(): Promise<string | null>;
  destroy(): void;
}

/**
 * What the renderer may know about the world beyond its art: its name, and (agent M1) its
 * bounded look and the `long_dark` light radius. All optional: absent = today's rendering.
 */
export interface WorldPresentation {
  title: string;
  tagline: string;
  look?: WorldLook | null;
  /** `long_dark`: px of sight around each living operative; null/absent = fully lit. */
  lightRadius?: number | null;
}
