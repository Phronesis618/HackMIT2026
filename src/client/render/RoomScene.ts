/**
 * RoomScene — draws a RoomSpec + ArtRecipe and the entities in each GameSnapshot.
 * Owner: Agent C (src/client/render). The foundation version is deliberately simple
 * vector art in the shared palette; keep the public methods, evolve the visuals.
 *
 * It never decides gameplay: positions, states and events all come from the snapshot.
 */
import Phaser from 'phaser';
import type { ArtRecipe, EnemyState, GameEvent, GameSnapshot, PlayerState, RoomSpec } from '../../shared/contracts';
import { ATTACK_ARC_RAD, ATTACK_RANGE, DEPTH, PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { ENEMY_INFO } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';
import { drawProp, drawSkyline, drawVignette } from './drawing';

interface EntityView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  facing: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  lastState: string;
  isLocal: boolean;
}

export class RoomScene extends Phaser.Scene {
  static readonly KEY = 'room';

  private room: RoomSpec | null = null;
  private art: ArtRecipe | null = null;
  private isHeadquarters = false;
  private roomLayer: Phaser.GameObjects.Container | null = null;
  private portalGlow: Phaser.GameObjects.Graphics | null = null;
  private portalPulse = 0;
  private players = new Map<string, EntityView>();
  private enemies = new Map<string, EntityView>();
  private anchorView: Phaser.GameObjects.Graphics | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private localPlayerId = '';
  private readonly onReady: () => void;

  /** `onReady` fires from create(); Phaser injects `events`/`sys` only after boot, so a callback is used. */
  constructor(onReady: () => void = () => {}) {
    super(RoomScene.KEY);
    this.onReady = onReady;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(tokens.color.ink900);
    this.onReady();
  }

  // ---- room ------------------------------------------------------------------

  buildRoom(room: RoomSpec, art: ArtRecipe, opts: { headquarters: boolean }): void {
    this.room = room;
    this.art = art;
    this.isHeadquarters = opts.headquarters;
    this.clearEntities();
    this.roomLayer?.destroy(true);
    this.portalGlow = null;
    this.anchorView?.destroy();
    this.anchorView = null;

    const layer = this.add.container(0, 0);
    this.roomLayer = layer;
    const roomW = room.width * TILE_SIZE;
    const roomH = room.height * TILE_SIZE;
    const p = art.palette;

    const sky = this.add.graphics().setDepth(DEPTH.background);
    drawSkyline(sky, art.skyline, roomW, roomH, p);
    layer.add(sky);

    const floor = this.add.graphics().setDepth(DEPTH.floor);
    const walls = this.add.graphics().setDepth(DEPTH.propsBehind);
    const decals = this.add.graphics().setDepth(DEPTH.floorDecal);
    const floorInt = hexToInt(p.floor);
    const floorAltInt = hexToInt(p.floorAlt);
    const wallInt = hexToInt(p.wall);
    const edgeInt = hexToInt(p.wallEdge);
    const hazardInt = hexToInt(p.hazard);
    const accentInt = hexToInt(p.accent);

    for (let row = 0; row < room.height; row++) {
      const line = room.tiles[row] ?? '';
      for (let col = 0; col < room.width; col++) {
        const ch = line[col] ?? ' ';
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        if (ch === ' ') continue;
        if (ch === '#') {
          walls.fillStyle(wallInt, 1).fillRect(x, y, TILE_SIZE, TILE_SIZE);
          const below = room.tiles[row + 1]?.[col];
          if (below && below !== '#' && below !== ' ') {
            walls.fillStyle(edgeInt, 0.9).fillRect(x, y + TILE_SIZE - 3, TILE_SIZE, 3);
          }
          const above = room.tiles[row - 1]?.[col];
          if (above && above !== '#' && above !== ' ') {
            walls.fillStyle(edgeInt, 0.35).fillRect(x, y, TILE_SIZE, 2);
          }
          continue;
        }
        floor.fillStyle((row + col) % 2 === 0 ? floorInt : floorAltInt, 1).fillRect(x, y, TILE_SIZE, TILE_SIZE);
        if (ch === '~') {
          decals.fillStyle(hazardInt, 0.22).fillRect(x, y, TILE_SIZE, TILE_SIZE);
          decals.lineStyle(1, hazardInt, 0.5);
          decals.lineBetween(x + 4, y + TILE_SIZE - 4, x + TILE_SIZE - 4, y + 4);
        }
        if (ch === 'X') {
          decals.fillStyle(accentInt, 0.18).fillRect(x, y, TILE_SIZE, TILE_SIZE);
          decals.lineStyle(1.5, accentInt, 0.8).strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        }
        if (ch === 'A') {
          decals.lineStyle(2, accentInt, 0.9).strokeCircle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 12);
        }
      }
    }
    // Subtle grid to sell the top-down plane.
    decals.lineStyle(1, edgeInt, 0.06);
    for (let col = 0; col <= room.width; col++) decals.lineBetween(col * TILE_SIZE, 0, col * TILE_SIZE, roomH);
    for (let row = 0; row <= room.height; row++) decals.lineBetween(0, row * TILE_SIZE, roomW, row * TILE_SIZE);
    layer.add([floor, decals, walls]);

    const props = this.add.graphics().setDepth(DEPTH.propsBehind + 1);
    for (const prop of room.props) {
      const c = tileToWorld(prop.x, prop.y);
      drawProp(props, prop.propId, c.x, c.y, p, art.glowIntensity);
    }
    layer.add(props);

    // Portal / exits glow (animated in update()).
    this.portalGlow = this.add.graphics().setDepth(DEPTH.floorDecal + 1);
    layer.add(this.portalGlow);

    const fog = this.add.graphics().setDepth(DEPTH.fog);
    drawVignette(fog, roomW, roomH, art.fog, p);
    layer.add(fog);

    const title = this.add
      .text(roomW / 2, -28, opts.headquarters ? room.name.toUpperCase() : `${room.index + 1} · ${room.name.toUpperCase()}`, {
        fontFamily: tokens.font.display,
        fontSize: '14px',
        color: p.text,
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setAlpha(0.8)
      .setDepth(DEPTH.overlay);
    layer.add(title);

    // Camera: frame the whole room.
    const cam = this.cameras.main;
    const zoom = Phaser.Math.Clamp(Math.min(cam.width / (roomW + 96), cam.height / (roomH + 96)), 0.7, 1.6);
    cam.setZoom(zoom);
    cam.centerOn(roomW / 2, roomH / 2 - 8);
    cam.fadeIn(280, 0, 0, 0);
  }

  // ---- entities ---------------------------------------------------------------

  renderSnapshot(snapshot: GameSnapshot, localPlayerId: string): void {
    this.latestSnapshot = snapshot;
    this.localPlayerId = localPlayerId;
    if (!this.art) return;

    const seenPlayers = new Set<string>();
    for (const player of snapshot.players) {
      seenPlayers.add(player.id);
      let view = this.players.get(player.id);
      if (!view) {
        view = this.createEntityView(player.displayName, player.id === localPlayerId, PLAYER_RADIUS, 'player');
        this.players.set(player.id, view);
      }
      this.updatePlayerView(view, player);
    }
    for (const [id, view] of this.players) {
      if (!seenPlayers.has(id)) {
        view.container.destroy(true);
        this.players.delete(id);
      }
    }

    const seenEnemies = new Set<string>();
    for (const enemy of snapshot.enemies) {
      seenEnemies.add(enemy.id);
      let view = this.enemies.get(enemy.id);
      if (!view) {
        view = this.createEntityView(ENEMY_INFO[enemy.enemyId].name, false, ENEMY_INFO[enemy.enemyId].radius, 'enemy');
        this.enemies.set(enemy.id, view);
      }
      this.updateEnemyView(view, enemy);
    }
    for (const [id, view] of this.enemies) {
      if (!seenEnemies.has(id)) {
        view.container.destroy(true);
        this.enemies.delete(id);
      }
    }

    if (snapshot.anchor && !this.anchorView) {
      this.anchorView = this.add.graphics().setDepth(DEPTH.entities);
    }
    if (snapshot.anchor && this.anchorView) {
      const a = snapshot.anchor;
      const accent = hexToInt(this.art.palette.accent);
      this.anchorView.clear();
      this.anchorView.fillStyle(accent, 0.15).fillCircle(a.x, a.y, 20 + Math.sin(this.time.now / 300) * 3);
      this.anchorView.fillStyle(accent, a.state === 'planted' ? 1 : 0.6).fillCircle(a.x, a.y, 6);
    }
  }

  private createEntityView(name: string, isLocal: boolean, radius: number, kind: 'player' | 'enemy'): EntityView {
    const container = this.add.container(0, 0).setDepth(DEPTH.entities);
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35).fillEllipse(0, radius * 0.9, radius * 2.2, radius * 0.9);
    const body = this.add.graphics();
    const facing = this.add.graphics();
    const hpBar = this.add.graphics();
    const label = this.add
      .text(0, -radius - 14, name, {
        fontFamily: tokens.font.body,
        fontSize: '11px',
        color: kind === 'player' ? tokens.color.mist100 : tokens.color.mist300,
      })
      .setOrigin(0.5)
      .setAlpha(kind === 'player' ? 0.95 : 0.7);
    container.add([shadow, body, facing, hpBar, label]);
    const view: EntityView = { container, body, facing, label, hpBar, lastState: '', isLocal };
    if (kind === 'player') this.drawPlayerBody(view, radius, 'idle');
    else this.drawEnemyBody(view, radius, 'idle');
    return view;
  }

  private drawPlayerBody(view: EntityView, radius: number, state: PlayerState['state']): void {
    const accent = hexToInt(view.isLocal ? tokens.canvas.localPlayerAccent : tokens.canvas.remotePlayerAccent);
    const outline = hexToInt(tokens.canvas.playerOutline);
    const g = view.body;
    g.clear();
    if (state === 'dashing') g.fillStyle(accent, 0.25).fillCircle(0, 0, radius + 10);
    g.fillStyle(hexToInt(tokens.color.ink600), 1).fillCircle(0, 0, radius);
    g.lineStyle(2, state === 'hit' ? hexToInt(tokens.color.danger) : outline, 1).strokeCircle(0, 0, radius);
    g.fillStyle(accent, 1).fillCircle(0, 0, radius * 0.45);
    if (state === 'attacking') {
      const f = view.facing;
      f.clear();
      f.fillStyle(hexToInt(tokens.canvas.telegraph), 0.35);
      f.slice(0, 0, ATTACK_RANGE, -ATTACK_ARC_RAD / 2, ATTACK_ARC_RAD / 2, false);
      f.fillPath();
    }
  }

  private drawEnemyBody(view: EntityView, radius: number, state: EnemyState['state']): void {
    const danger = hexToInt(tokens.canvas.enemyAccent);
    const g = view.body;
    g.clear();
    g.fillStyle(hexToInt(tokens.color.ink700), 1).fillCircle(0, 0, radius);
    g.lineStyle(2, danger, state === 'hit' ? 1 : 0.8).strokeCircle(0, 0, radius);
    g.fillStyle(danger, state === 'dead' ? 0.2 : 0.9);
    g.fillTriangle(-radius * 0.4, radius * 0.3, 0, -radius * 0.5, radius * 0.4, radius * 0.3);
  }

  private updatePlayerView(view: EntityView, player: PlayerState): void {
    view.container.setPosition(player.x, player.y);
    view.container.setDepth(DEPTH.entities + player.y / 10000);
    view.container.setAlpha(player.invulnerableMs > 0 ? 0.7 : 1);
    if (view.lastState !== player.state) {
      view.lastState = player.state;
      this.drawPlayerBody(view, PLAYER_RADIUS, player.state);
    }
    // facing wedge (redrawn only when not attacking; attack telegraph reuses the layer)
    if (player.state !== 'attacking') {
      const f = view.facing;
      f.clear();
      f.fillStyle(hexToInt(view.isLocal ? tokens.canvas.localPlayerAccent : tokens.canvas.remotePlayerAccent), 0.9);
      f.fillTriangle(PLAYER_RADIUS + 2, 0, PLAYER_RADIUS - 4, -5, PLAYER_RADIUS - 4, 5);
    }
    view.facing.setRotation(player.facing);
    if (view.label.text !== player.displayName) view.label.setText(player.displayName);
    this.drawHpBar(view.hpBar, player.hp, player.maxHp, PLAYER_RADIUS, hexToInt(tokens.color.success));
  }

  private updateEnemyView(view: EntityView, enemy: EnemyState): void {
    const radius = ENEMY_INFO[enemy.enemyId].radius;
    view.container.setPosition(enemy.x, enemy.y);
    view.container.setDepth(DEPTH.entities + enemy.y / 10000);
    if (view.lastState !== enemy.state) {
      view.lastState = enemy.state;
      this.drawEnemyBody(view, radius, enemy.state);
    }
    view.facing.setRotation(enemy.facing);
    if (enemy.hp < enemy.maxHp) this.drawHpBar(view.hpBar, enemy.hp, enemy.maxHp, radius, hexToInt(tokens.canvas.enemyAccent));
    else view.hpBar.clear();
  }

  private drawHpBar(g: Phaser.GameObjects.Graphics, hp: number, maxHp: number, radius: number, color: number): void {
    g.clear();
    if (hp >= maxHp) return;
    const w = radius * 2.4;
    const y = radius + 6;
    g.fillStyle(0x000000, 0.6).fillRect(-w / 2, y, w, 4);
    g.fillStyle(color, 1).fillRect(-w / 2, y, (w * Math.max(0, hp)) / maxHp, 4);
  }

  private clearEntities(): void {
    for (const v of this.players.values()) v.container.destroy(true);
    for (const v of this.enemies.values()) v.container.destroy(true);
    this.players.clear();
    this.enemies.clear();
  }

  // ---- events (fire-and-forget effects) -----------------------------------------

  playEvents(events: GameEvent[]): void {
    if (!this.art) return;
    for (const event of events) {
      switch (event.type) {
        case 'player_dashed': {
          const g = this.add.graphics().setDepth(DEPTH.effects);
          const accent = hexToInt(event.playerId === this.localPlayerId ? tokens.canvas.localPlayerAccent : tokens.canvas.remotePlayerAccent);
          g.lineStyle(3, accent, 0.9).lineBetween(
            event.x,
            event.y,
            event.x - Math.cos(event.facing) * 40,
            event.y - Math.sin(event.facing) * 40,
          );
          g.fillStyle(accent, 0.3).fillCircle(event.x, event.y, PLAYER_RADIUS + 6);
          this.tweens.add({ targets: g, alpha: 0, duration: tokens.motion.baseMs, onComplete: () => g.destroy() });
          break;
        }
        case 'player_attacked': {
          const g = this.add.graphics().setDepth(DEPTH.effects);
          g.lineStyle(3, hexToInt(tokens.canvas.telegraph), 0.9);
          g.beginPath();
          g.arc(event.x, event.y, ATTACK_RANGE, event.facing - ATTACK_ARC_RAD / 2, event.facing + ATTACK_ARC_RAD / 2, false);
          g.strokePath();
          this.tweens.add({ targets: g, alpha: 0, scale: 1.1, duration: tokens.motion.fastMs * 1.5, onComplete: () => g.destroy() });
          break;
        }
        case 'enemy_damaged':
        case 'player_damaged': {
          this.cameras.main.shake(80, 0.002);
          break;
        }
        case 'room_entered': {
          this.cameras.main.flash(200, 124, 245, 255, false);
          break;
        }
        default:
          break;
      }
    }
  }

  // ---- per-frame ---------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (!this.room || !this.art || !this.portalGlow) return;
    this.portalPulse += delta / 1000;
    const accent = hexToInt(this.art.palette.accent);
    const g = this.portalGlow;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.portalPulse * 2.2);
    for (const exit of this.room.exits) {
      const c = tileToWorld(exit.x, exit.y);
      if (this.isHeadquarters) {
        // The portal: layered rings + rotating arcs, the luminous heart of the HQ.
        g.fillStyle(accent, 0.06 + 0.08 * pulse).fillCircle(c.x, c.y, 44 + pulse * 6);
        g.fillStyle(accent, 0.12 + 0.1 * pulse).fillCircle(c.x, c.y, 26);
        g.lineStyle(2, accent, 0.9).strokeCircle(c.x, c.y, 18 + pulse * 2);
        g.lineStyle(1.5, accent, 0.6);
        for (let i = 0; i < 3; i++) {
          const a0 = this.portalPulse * 1.4 + (i * Math.PI * 2) / 3;
          g.beginPath();
          g.arc(c.x, c.y, 30, a0, a0 + 1.2, false);
          g.strokePath();
        }
      } else {
        g.fillStyle(accent, 0.1 + 0.15 * pulse).fillRect(exit.x * TILE_SIZE, exit.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  worldPointFromScreen(px: number, py: number): { x: number; y: number } {
    const v = this.cameras.main.getWorldPoint(px, py);
    return { x: v.x, y: v.y };
  }

  getLatestSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }
}
