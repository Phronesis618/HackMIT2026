/**
 * PhaserWorldRenderer — the registered WorldRenderer implementation (Agent C).
 * Owns the Phaser.Game instance and forwards contract calls to RoomScene.
 */
import Phaser from 'phaser';
import type { ArtRecipe, GameEvent, GameSnapshot, ReceiptLine, RoomSpec } from '../../shared/contracts';
import type { WorldRenderer } from '../../shared/render';
import { tokens } from '../../shared/tokens';
import { VOID_COLOR } from './color';
import { RoomScene } from './RoomScene';

type WorldLabel = { title: string; tagline: string };

export class PhaserWorldRenderer implements WorldRenderer {
  private game: Phaser.Game | null = null;
  private scene: RoomScene | null = null;
  private mounting: Promise<void> | null = null;
  private pendingRoom: { room: RoomSpec; art: ArtRecipe; headquarters: boolean; loreLines: ReceiptLine[]; world?: WorldLabel } | null = null;

  mount(container: HTMLElement): Promise<void> {
    if (this.mounting) return this.mounting;
    this.mounting = new Promise((resolve) => {
      const scene = new RoomScene(() => {
        if (this.pendingRoom) {
          scene.buildRoom(
            this.pendingRoom.room, this.pendingRoom.art,
            { headquarters: this.pendingRoom.headquarters, world: this.pendingRoom.world }, this.pendingRoom.loreLines,
          );
          this.pendingRoom = null;
        }
        resolve();
      });
      this.scene = scene;
      // Render at the display's real pixel density (and at least the container's CSS size)
      // so Scale.FIT never upscales a 1024px backing store onto a 2x/3x screen. Rooms are
      // framed by camera zoom relative to this size, so world units are unaffected.
      const dpr = typeof window !== 'undefined' ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 1;
      const cssWidth = Math.max(tokens.canvas.defaultWidth, container.getBoundingClientRect?.().width || 0);
      const width = Math.round(cssWidth * dpr);
      const height = Math.round(width * tokens.canvas.defaultHeight / tokens.canvas.defaultWidth);
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width,
        height,
        backgroundColor: VOID_COLOR,
        antialias: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [scene],
        banner: false,
      });
    });
    return this.mounting;
  }

  showHeadquarters(room: RoomSpec, art: ArtRecipe): void {
    this.build(room, art, true, []);
  }

  showRoom(room: RoomSpec, art: ArtRecipe, loreLines: ReceiptLine[] = [], world?: WorldLabel): void {
    this.build(room, art, false, loreLines, world);
  }

  private build(room: RoomSpec, art: ArtRecipe, headquarters: boolean, loreLines: ReceiptLine[], world?: WorldLabel): void {
    if (this.scene && this.scene.sys.isActive()) this.scene.buildRoom(room, art, { headquarters, world }, loreLines);
    else this.pendingRoom = { room, art, headquarters, loreLines, world };
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
    this.mounting = null;
    this.pendingRoom = null;
  }
}
