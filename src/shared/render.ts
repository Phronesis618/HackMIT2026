/**
 * WorldRenderer — the boundary between Agent A's GameController and Agent C's
 * Phaser rendering. The renderer draws what it is told; it never decides gameplay.
 *
 * Owner: Agent A (shape). Implementation: Agent C in src/client/render/.
 * Foundation implementation: PhaserWorldRenderer (placeholder art, real wiring).
 */
import type { ArtRecipe, GameEvent, GameSnapshot, RoomSpec } from './contracts';

export interface WorldRenderer {
  /** Create the canvas inside `container`. Resolves when the first scene is ready. */
  mount(container: HTMLElement): Promise<void>;
  /**
   * Headquarters view. The HQ is a built-in RoomSpec (src/sim/headquarters.ts) whose
   * 'X' tile is the portal; the renderer may add sanctuary-specific decoration.
   */
  showHeadquarters(room: RoomSpec, art: ArtRecipe): void;
  /** Build a room from trusted data. Called once per room entry; may be called again for a new room. */
  showRoom(room: RoomSpec, art: ArtRecipe): void;
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
