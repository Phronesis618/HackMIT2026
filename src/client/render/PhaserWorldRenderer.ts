/**
 * PhaserWorldRenderer — the registered WorldRenderer implementation (Agent C).
 * Owns the Phaser.Game instance and forwards contract calls to RoomScene.
 */
import Phaser from 'phaser';
import type { ArtRecipe, GameEvent, GameSnapshot, RoomSpec } from '../../shared/contracts';
import type { WorldRenderer } from '../../shared/render';
import { tokens } from '../../shared/tokens';
import { RoomScene } from './RoomScene';

export class PhaserWorldRenderer implements WorldRenderer {
  private game: Phaser.Game | null = null;
  private scene: RoomScene | null = null;
  private pendingRoom: { room: RoomSpec; art: ArtRecipe; headquarters: boolean } | null = null;

  mount(container: HTMLElement): Promise<void> {
    if (this.game) return Promise.resolve();
    return new Promise((resolve) => {
      const scene = new RoomScene(() => {
        if (this.pendingRoom) {
          scene.buildRoom(this.pendingRoom.room, this.pendingRoom.art, { headquarters: this.pendingRoom.headquarters });
          this.pendingRoom = null;
        }
        resolve();
      });
      this.scene = scene;
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width: tokens.canvas.defaultWidth,
        height: tokens.canvas.defaultHeight,
        backgroundColor: tokens.color.ink900,
        antialias: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [scene],
        banner: false,
      });
    });
  }

  showHeadquarters(room: RoomSpec, art: ArtRecipe): void {
    this.build(room, art, true);
  }

  showRoom(room: RoomSpec, art: ArtRecipe): void {
    this.build(room, art, false);
  }

  private build(room: RoomSpec, art: ArtRecipe, headquarters: boolean): void {
    if (this.scene && this.scene.sys.isActive()) this.scene.buildRoom(room, art, { headquarters });
    else this.pendingRoom = { room, art, headquarters };
  }

  renderSnapshot(snapshot: GameSnapshot, localPlayerId: string): void {
    if (this.scene?.sys.isActive()) this.scene.renderSnapshot(snapshot, localPlayerId);
  }

  playEvents(events: GameEvent[]): void {
    if (this.scene?.sys.isActive()) this.scene.playEvents(events);
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    if (!this.scene?.sys.isActive() || !this.game) return { x: px, y: py };
    // Convert CSS pixels (relative to the canvas element) to game pixels (Scale.FIT).
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const gx = (px / Math.max(1, rect.width)) * this.game.scale.width;
    const gy = (py / Math.max(1, rect.height)) * this.game.scale.height;
    return this.scene.worldPointFromScreen(gx, gy);
  }

  captureThumbnail(): Promise<string | null> {
    const game = this.game;
    if (!game) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        game.renderer.snapshot((result) => {
          if (!(result instanceof HTMLImageElement)) {
            resolve(null);
            return;
          }
          const canvas = document.createElement('canvas');
          const w = 320;
          const h = Math.round((result.height / Math.max(1, result.width)) * w);
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(result, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        });
      } catch {
        resolve(null);
      }
    });
  }

  destroy(): void {
    this.game?.destroy(true);
    this.game = null;
    this.scene = null;
  }
}
