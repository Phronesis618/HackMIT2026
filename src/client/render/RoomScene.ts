/**
 * RoomScene — draws a RoomSpec + ArtRecipe and the entities in each GameSnapshot.
 * Owner: Agent C (src/client/render); Agent A extended it for the visual overhaul.
 *
 * It never decides gameplay: positions, states and events all come from the snapshot.
 * Effects: exactly ONE Graphics object and ONE tween per event; the tween drives a
 * progress value and the fx module redraws the frame (layered glow/body/core + particles).
 */
import Phaser from 'phaser';
import type { ArtRecipe, EnemyState, GameEvent, GameSnapshot, PlayerState, RoomSpec } from '../../shared/contracts';
import { ATTACK_ARC_RAD, ATTACK_RANGE, DEPTH, PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { hashString } from '../../shared/ids';
import { CLASS_THEME, ENEMY_INFO, type ClassId } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';
import { ENEMY_COMBAT } from '../../sim/combat';
import { drawHostile, drawOperative } from './characters';
import { hexInt } from './color';
import { drawMotif, drawProp, drawSanctuary, drawVignette } from './drawing';
import { drawBackdrop, drawFloor, drawLightPools, drawMotes, drawWalls, makeMotes, type Mote } from './environment';
import * as fx from './fx';

interface EntityView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  facing: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  lastState: string;
  isLocal: boolean;
}

type FxGraphics = Phaser.GameObjects.Graphics & { fxT: number };

export class RoomScene extends Phaser.Scene {
  static readonly KEY = 'room';

  private room: RoomSpec | null = null;
  private art: ArtRecipe | null = null;
  private isHeadquarters = false;
  private roomLayer: Phaser.GameObjects.Layer | null = null;
  private portalGlow: Phaser.GameObjects.Graphics | null = null;
  private telegraphs: Phaser.GameObjects.Graphics | null = null;
  private motesGfx: Phaser.GameObjects.Graphics | null = null;
  private motes: Mote[] = [];
  private portalPulse = 0;
  private players = new Map<string, EntityView>();
  private enemies = new Map<string, EntityView>();
  private anchorView: Phaser.GameObjects.Graphics | null = null;
  private anchorLabel: Phaser.GameObjects.Text | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private localPlayerId = '';
  private enemyPositions = new Map<string, { x: number; y: number; enemyId: EnemyState['enemyId'] }>();
  private playerClasses = new Map<string, ClassId>();
  private seenEffects = new Set<string>();
  private effectSeed = 1;
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
    this.tweens.killAll();
    this.seenEffects.clear();
    this.enemyPositions.clear();
    this.latestSnapshot = null;
    this.clearEntities();
    this.roomLayer?.destroy(true);
    this.portalGlow = null;
    this.telegraphs = null;
    this.motesGfx = null;
    this.anchorView?.destroy();
    this.anchorView = null;
    this.anchorLabel = null;

    const layer = this.add.layer();
    this.roomLayer = layer;
    const roomW = room.width * TILE_SIZE;
    const roomH = room.height * TILE_SIZE;
    const p = art.palette;
    const seed = hashString(room.id) % 100000;

    const backdrop = this.add.graphics().setDepth(DEPTH.background);
    drawBackdrop(backdrop, roomW, roomH, p, art.skyline, seed);
    layer.add(backdrop);

    const floor = this.add.graphics().setDepth(DEPTH.floor);
    drawFloor(floor, room, p, seed);
    layer.add(floor);

    const lights = this.add.graphics().setDepth(DEPTH.floorDecal);
    drawLightPools(lights, room, p);
    layer.add(lights);

    const decals = this.add.graphics().setDepth(DEPTH.floorDecal + 1);
    for (let row = 0; row < room.height; row++) {
      const line = room.tiles[row] ?? '';
      for (let col = 0; col < room.width; col++) {
        const ch = line[col] ?? ' ';
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        if (ch === 'A') {
          layer.add(
            this.add
              .text(x + TILE_SIZE / 2, y + TILE_SIZE + 6, 'ANCHOR SITE', { fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent })
              .setOrigin(0.5, 0)
              .setDepth(DEPTH.floorDecal),
          );
        }
        if (!opts.headquarters && ch === '.' && row % 4 === 1 && col % 6 === 2) {
          const motif = art.motifIds[(Math.floor(row / 4) + Math.floor(col / 6)) % art.motifIds.length];
          if (motif) drawMotif(decals, motif, x + TILE_SIZE / 2, y + TILE_SIZE / 2, p);
        }
      }
    }
    layer.add(decals);

    const walls = this.add.graphics().setDepth(DEPTH.propsBehind);
    drawWalls(walls, room, p, seed);
    layer.add(walls);

    if (opts.headquarters) {
      const sanctuary = this.add.graphics().setDepth(DEPTH.floorDecal + 2);
      const exit = room.exits[0];
      drawSanctuary(sanctuary, roomW, roomH, p, exit ? tileToWorld(exit.x, exit.y) : undefined);
      layer.add(sanctuary);
      layer.add(
        this.add
          .text(roomW - 160, 17, 'CHRONICLE ARCHIVE', { fontFamily: tokens.font.mono, fontSize: '10px', color: tokens.color.warmLamp })
          .setOrigin(0.5)
          .setDepth(DEPTH.overlay),
      );
    }

    const props = this.add.graphics().setDepth(DEPTH.propsBehind + 1);
    for (const prop of room.props) {
      const c = tileToWorld(prop.x, prop.y);
      drawProp(props, prop.propId, c.x, c.y, p, art.glowIntensity);
    }
    layer.add(props);

    this.portalGlow = this.add.graphics().setDepth(DEPTH.floorDecal + 3);
    layer.add(this.portalGlow);
    this.telegraphs = this.add.graphics().setDepth(DEPTH.floorDecal + 4);
    layer.add(this.telegraphs);

    this.motes = makeMotes(roomW, roomH, seed, opts.headquarters ? 30 : 48);
    this.motesGfx = this.add.graphics().setDepth(DEPTH.effects - 1);
    layer.add(this.motesGfx);

    const fog = this.add.graphics().setDepth(DEPTH.fog);
    drawVignette(fog, roomW, roomH, art.fog * 0.6, p);
    layer.add(fog);

    const title = this.add
      .text(roomW / 2, -28, opts.headquarters ? room.name.toUpperCase() : `${room.index + 1} · ${room.name.toUpperCase()}`, {
        fontFamily: tokens.font.display,
        fontSize: '14px',
        color: p.text,
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setAlpha(0.85)
      .setDepth(DEPTH.overlay);
    layer.add(title);

    // Camera: frame the whole room.
    const cam = this.cameras.main;
    const zoom = Math.min(1.6, cam.width / (roomW + 96), cam.height / (roomH + 96));
    cam.setZoom(zoom);
    cam.centerOn(roomW / 2, roomH / 2 - 8);
    cam.fadeIn(280, 0, 0, 0);
  }

  // ---- entities ---------------------------------------------------------------

  renderSnapshot(snapshot: GameSnapshot, localPlayerId: string): void {
    if (!this.art || snapshot.roomId !== this.room?.id) return;
    this.latestSnapshot = snapshot;
    this.localPlayerId = localPlayerId;

    const seenPlayers = new Set<string>();
    for (const player of snapshot.players) {
      seenPlayers.add(player.id);
      this.playerClasses.set(player.id, player.classId);
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
    this.telegraphs?.clear();
    for (const enemy of snapshot.enemies) {
      this.enemyPositions.set(enemy.id, { x: enemy.x, y: enemy.y, enemyId: enemy.enemyId });
      seenEnemies.add(enemy.id);
      let view = this.enemies.get(enemy.id);
      if (!view) {
        view = this.createEntityView(ENEMY_INFO[enemy.enemyId].name, false, ENEMY_INFO[enemy.enemyId].radius, 'enemy');
        this.enemies.set(enemy.id, view);
      }
      this.updateEnemyView(view, enemy);
      if (enemy.telegraph && this.telegraphs) this.drawTelegraph(this.telegraphs, enemy);
    }
    for (const [id, view] of this.enemies) {
      if (!seenEnemies.has(id)) {
        view.container.destroy(true);
        this.enemies.delete(id);
      }
    }

    if (snapshot.anchor && !this.anchorView) {
      this.anchorView = this.add.graphics().setDepth(DEPTH.entities);
      this.anchorLabel = this.add
        .text(0, 0, '', { fontFamily: tokens.font.mono, fontSize: '12px', color: this.art.palette.text })
        .setOrigin(0.5)
        .setDepth(DEPTH.overlay);
      this.roomLayer?.add([this.anchorView, this.anchorLabel]);
    }
    if (snapshot.anchor && this.anchorView) {
      const a = snapshot.anchor;
      const accent = hexToInt(this.art.palette.accent);
      const t = this.time.now / 1000;
      this.anchorView.clear();
      this.anchorView.fillStyle(accent, 0.15).fillCircle(a.x, a.y, 20 + Math.sin(t * 3.3) * 3);
      this.anchorView.fillStyle(accent, a.state === 'planted' ? 1 : 0.6).fillCircle(a.x, a.y, 6);
      this.anchorView.lineStyle(2, accent, 0.8).strokeTriangle(a.x, a.y - 17, a.x - 10, a.y + 7, a.x + 10, a.y + 7);
      this.anchorView.lineStyle(3, accent, 0.2).strokeCircle(a.x, a.y, 28);
      const progress = a.state === 'planted' ? 1 : a.state === 'planting' ? a.progress : 0;
      if (progress > 0) {
        this.anchorView.lineStyle(3, accent, 1).beginPath().arc(a.x, a.y, 28, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, false).strokePath();
      }
      if (a.state === 'planted') {
        for (let i = 0; i < 3; i++) this.anchorView.lineStyle(1.5, accent, 0.35 - i * 0.1).strokeCircle(a.x, a.y, 36 + i * 16 + ((t * 30) % 16));
      }
      this.anchorLabel
        ?.setPosition(a.x, a.y - 42)
        .setVisible(true)
        .setText(a.state === 'planted' ? 'ANCHOR PLANTED' : a.state === 'planting' ? `PLANTING · ${Math.floor(a.progress * 100)}%` : 'ANCHOR DORMANT');
    } else if (!snapshot.anchor) {
      this.anchorView?.clear();
      this.anchorLabel?.setVisible(false);
    }
  }

  /** Windup telegraph: danger zone brightens and a ring fills as the strike approaches. */
  private drawTelegraph(g: Phaser.GameObjects.Graphics, enemy: EnemyState): void {
    const warning = enemy.telegraph;
    if (!warning) return;
    const total = ENEMY_COMBAT[enemy.enemyId].windup;
    const progress = total > 0 ? 1 - Math.min(1, warning.remainingMs / total) : 1;
    const color = fx.enemyAccent(enemy.enemyId);
    const hot = hexToInt(tokens.canvas.telegraph);
    const alpha = 0.12 + progress * 0.25;
    if (warning.kind === 'burst') {
      g.fillStyle(color, alpha).fillCircle(warning.x, warning.y, warning.range);
      g.lineStyle(2, hot, 0.9).strokeCircle(warning.x, warning.y, warning.range);
      g.lineStyle(3, hot, 1).beginPath().arc(warning.x, warning.y, warning.range, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, false).strokePath();
    } else if (warning.kind === 'beam') {
      const ex = warning.x + Math.cos(warning.facing) * warning.range;
      const ey = warning.y + Math.sin(warning.facing) * warning.range;
      g.lineStyle(22, color, alpha * 0.6).lineBetween(warning.x, warning.y, ex, ey);
      g.lineStyle(2, hot, 0.9).lineBetween(warning.x, warning.y, ex, ey);
      g.lineStyle(4, hot, 1).lineBetween(warning.x, warning.y, warning.x + Math.cos(warning.facing) * warning.range * progress, warning.y + Math.sin(warning.facing) * warning.range * progress);
    } else {
      const a0 = warning.facing - warning.arcRad / 2;
      const a1 = warning.facing + warning.arcRad / 2;
      const band = warning.range * 0.5;
      g.lineStyle(band, color, alpha).beginPath().arc(warning.x, warning.y, warning.range - band / 2, a0, a1, false).strokePath();
      g.lineStyle(2, hot, 0.9).beginPath().arc(warning.x, warning.y, warning.range, a0, a1, false).strokePath();
      g.lineStyle(2, hot, 0.9).lineBetween(warning.x, warning.y, warning.x + Math.cos(a0) * warning.range, warning.y + Math.sin(a0) * warning.range);
      g.lineStyle(2, hot, 0.9).lineBetween(warning.x, warning.y, warning.x + Math.cos(a1) * warning.range, warning.y + Math.sin(a1) * warning.range);
      g.lineStyle(3, hot, 1).beginPath().arc(warning.x, warning.y, warning.range, a0, a0 + (a1 - a0) * progress, false).strokePath();
    }
  }

  private createEntityView(name: string, isLocal: boolean, radius: number, kind: 'player' | 'enemy'): EntityView {
    const container = this.add.container(0, 0).setDepth(DEPTH.entities);
    this.roomLayer?.add(container);
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.4).fillEllipse(0, radius * 0.9, radius * 2.4, radius);
    const body = this.add.graphics();
    const facing = this.add.graphics();
    const hpBar = this.add.graphics();
    const label = this.add
      .text(0, -radius - 16, name, {
        fontFamily: tokens.font.body,
        fontSize: '12px',
        color: kind === 'player' ? tokens.color.mist100 : tokens.color.mist300,
        fontStyle: kind === 'player' ? 'bold' : 'normal',
      })
      .setOrigin(0.5)
      .setAlpha(kind === 'player' ? 0.95 : 0.7);
    container.add([shadow, facing, body, hpBar, label]);
    return { container, body, facing, label, hpBar, lastState: '', isLocal };
  }

  private updatePlayerView(view: EntityView, player: PlayerState): void {
    view.container.setPosition(player.x, player.y);
    view.container.setDepth(DEPTH.entities + player.y / 10000);
    view.container.setAlpha(player.state === 'down' ? 0.6 : (player.shroudMs ?? 0) > 0 ? 0.55 : 1);
    drawOperative(view.body, player, view.isLocal, this.time.now);
    view.body.setRotation(player.facing);
    view.body.setScale(player.state === 'dashing' ? 1.4 : 1.2, player.state === 'dashing' ? 1.02 : 1.2);
    const theme = CLASS_THEME[player.classId];
    view.facing.clear();
    if ((player.shieldMs ?? 0) > 0) {
      const pulse = 0.7 + 0.3 * Math.sin(this.time.now / 80);
      const accent = hexInt(theme.primary);
      view.facing.lineStyle(9, accent, 0.18).beginPath().arc(0, 0, PLAYER_RADIUS + 9, -1.35, 1.35, false).strokePath();
      view.facing.lineStyle(3.5, accent, 0.95 * pulse).beginPath().arc(0, 0, PLAYER_RADIUS + 13, -1.35, 1.35, false).strokePath();
      view.facing.lineStyle(1.2, 0xffffff, 0.9).beginPath().arc(0, 0, PLAYER_RADIUS + 13, -1.2, 1.2, false).strokePath();
    } else if (view.isLocal) {
      view.facing.lineStyle(1.5, hexInt(theme.primary), 0.55).beginPath().arc(0, 0, PLAYER_RADIUS + 12, -0.35, 0.35, false).strokePath();
    }
    view.facing.setRotation(player.facing);
    if (view.label.text !== player.displayName) view.label.setText(player.displayName);
    this.drawHpBar(view.hpBar, player.hp, player.maxHp, PLAYER_RADIUS, hexToInt(tokens.color.success));
  }

  private updateEnemyView(view: EntityView, enemy: EnemyState): void {
    const radius = ENEMY_INFO[enemy.enemyId].radius;
    view.container.setPosition(enemy.x, enemy.y);
    view.container.setDepth(DEPTH.entities + enemy.y / 10000);
    drawHostile(view.body, enemy, this.time.now);
    view.body.setRotation(enemy.facing);
    view.container.setAlpha(enemy.state === 'dead' ? 0.25 : (enemy.slowMs ?? 0) > 0 ? 0.85 : 1);
    view.facing.clear();
    if (enemy.state === 'attacking') {
      view.facing.lineStyle(2, hexToInt(tokens.canvas.telegraph), 0.9).beginPath().arc(0, 0, radius + 12, -Math.PI / 3, Math.PI / 3, false).strokePath();
    }
    if ((enemy.slowMs ?? 0) > 0) view.facing.lineStyle(1.5, 0x5ef0b0, 0.7).strokeCircle(0, 0, radius + 5);
    view.facing.setRotation(enemy.facing);
    if (enemy.hp < enemy.maxHp && enemy.state !== 'dead') this.drawHpBar(view.hpBar, enemy.hp, enemy.maxHp, radius, fx.enemyAccent(enemy.enemyId));
    else view.hpBar.clear();
  }

  private drawHpBar(g: Phaser.GameObjects.Graphics, hp: number, maxHp: number, radius: number, color: number): void {
    g.clear();
    if (hp >= maxHp) return;
    const w = radius * 2.6;
    const y = radius + 7;
    g.fillStyle(0x000000, 0.65).fillRect(-w / 2 - 1, y - 1, w + 2, 6);
    g.fillStyle(color, 1).fillRect(-w / 2, y, (w * Math.max(0, hp)) / maxHp, 4);
    g.fillStyle(0xffffff, 0.35).fillRect(-w / 2, y, (w * Math.max(0, hp)) / maxHp, 1.5);
  }

  private clearEntities(): void {
    for (const v of this.players.values()) v.container.destroy(true);
    for (const v of this.enemies.values()) v.container.destroy(true);
    this.players.clear();
    this.enemies.clear();
  }

  // ---- events (fire-and-forget effects) -----------------------------------------

  private effect(x: number, y: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics().setPosition(x, y).setDepth(DEPTH.effects);
    this.roomLayer?.add(g);
    return g;
  }

  /** One node, one tween: `draw(t)` repaints the effect for progress t in [0, 1]. */
  private animate(x: number, y: number, durationMs: number, draw: (g: Phaser.GameObjects.Graphics, t: number) => void, initial?: (g: Phaser.GameObjects.Graphics) => void): void {
    const g = this.effect(x, y) as FxGraphics;
    g.fxT = 0;
    if (initial) initial(g);
    else draw(g, 0);
    this.tweens.add({
      targets: g,
      fxT: 1,
      duration: durationMs,
      ease: 'Linear',
      onUpdate: () => draw(g, g.fxT),
      onComplete: () => g.destroy(),
    });
  }

  private floatText(x: number, y: number, text: string, color: string, size = 13): void {
    const t = this.add
      .text(x, y, text, { fontFamily: tokens.font.display, fontSize: `${size}px`, color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay);
    this.roomLayer?.add(t);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private classColor(playerId: string): number {
    const classId = this.playerClasses.get(playerId) ?? 'bastion';
    return hexInt(CLASS_THEME[classId].primary);
  }

  playEvents(events: GameEvent[]): void {
    if (!this.art) return;
    for (const event of events) {
      if (this.seenEffects.has(event.id)) continue;
      this.seenEffects.add(event.id);
      if (this.seenEffects.size > 4000) this.seenEffects.delete(this.seenEffects.values().next().value!);
      const seed = this.effectSeed++;
      switch (event.type) {
        case 'player_dashed': {
          const classId = this.playerClasses.get(event.playerId) ?? 'bastion';
          const color = this.classColor(event.playerId);
          this.animate(event.x, event.y, 260, (g, t) => fx.drawDashTrail(g, t, { facing: event.facing, color, classId }));
          break;
        }
        case 'player_attacked': {
          const classId = this.playerClasses.get(event.playerId) ?? 'bastion';
          const color = this.classColor(event.playerId);
          const range = event.range ?? ATTACK_RANGE;
          const arc = event.arcRad ?? ATTACK_ARC_RAD;
          this.animate(
            event.x,
            event.y,
            classId === 'shade' ? 200 : 260,
            (g, t) => fx.drawSlash(g, t, { facing: event.facing, range, arc, color, classId, seed }),
            (g) => {
              g.lineStyle(3, hexToInt(tokens.canvas.telegraph), 0.9);
              g.beginPath();
              g.arc(0, 0, range, event.facing - arc / 2, event.facing + arc / 2, false);
              g.strokePath();
            },
          );
          break;
        }
        case 'enemy_damaged': {
          const target = this.enemyPositions.get(event.enemyId);
          if (target) {
            this.animate(target.x, target.y, 320, (g, t) => fx.drawImpact(g, t, this.classColor(event.byPlayerId), seed, 1));
            this.floatText(target.x + (seed % 5) * 3 - 6, target.y - 24, `${event.amount}`, tokens.canvas.telegraph, event.amount >= 30 ? 16 : 13);
          }
          break;
        }
        case 'player_damaged': {
          const target = this.players.get(event.playerId)?.container;
          if (target) this.animate(target.x, target.y, 320, (g, t) => fx.drawImpact(g, t, hexToInt(tokens.color.danger), seed, 1.2));
          if (event.playerId === this.localPlayerId) this.cameras.main.shake(110, 0.004);
          break;
        }
        case 'enemy_defeated': {
          const target = this.enemyPositions.get(event.enemyId);
          if (target) {
            const radius = ENEMY_INFO[target.enemyId].radius;
            this.animate(target.x, target.y, 520, (g, t) => fx.drawDefeat(g, t, fx.enemyAccent(target.enemyId), radius, seed));
          }
          break;
        }
        case 'enemy_telegraphed': {
          const target = this.enemyPositions.get(event.enemyId);
          if (target) this.animate(target.x, target.y, 260, (g, t) => fx.drawTelegraphWarning(g, t, fx.enemyAccent(target.enemyId), ENEMY_INFO[target.enemyId].radius));
          break;
        }
        case 'enemy_attacked': {
          const target = this.enemyPositions.get(event.enemyId);
          const tele = this.latestSnapshot?.enemies.find((e) => e.id === event.enemyId)?.telegraph;
          const enemyId = target?.enemyId ?? 'husk';
          const spec = ENEMY_COMBAT[enemyId];
          const kind = tele?.kind ?? (enemyId === 'sentinel' ? 'beam' : enemyId === 'lurker' ? 'charge' : enemyId === 'guardian' ? 'burst' : 'melee');
          this.animate(event.x, event.y, 340, (g, t) =>
            fx.drawEnemyStrike(g, t, { kind, facing: event.facing, range: tele?.range ?? spec.range, arc: tele?.arcRad ?? spec.arc, color: fx.enemyAccent(enemyId), seed }),
          );
          break;
        }
        case 'player_downed': {
          const target = this.players.get(event.playerId)?.container;
          if (target) this.animate(target.x, target.y, 600, (g, t) => fx.drawDefeat(g, t, hexToInt(tokens.color.danger), PLAYER_RADIUS + 6, seed));
          break;
        }
        case 'ability_used':
          this.playAbility(event, seed);
          break;
        case 'player_healed': {
          const target = this.players.get(event.playerId)?.container;
          if (target) {
            this.animate(target.x, target.y, 500, (g, t) => fx.drawRally(g, t, hexToInt(tokens.color.success), 34, seed));
            this.floatText(target.x, target.y - 26, `+${event.amount}`, tokens.color.success);
          }
          break;
        }
        case 'player_revived': {
          const target = this.players.get(event.playerId)?.container;
          if (target) this.animate(target.x, target.y, 700, (g, t) => fx.drawRevive(g, t, hexToInt(tokens.color.success)));
          break;
        }
        case 'room_cleared': {
          if (this.room && event.roomId === this.room.id) {
            const cx = (this.room.width * TILE_SIZE) / 2;
            const cy = (this.room.height * TILE_SIZE) / 2;
            this.animate(cx, cy, 900, (g, t) => fx.drawShockwave(g, t, 160, hexToInt(tokens.color.success), seed, false));
            this.floatText(cx, cy - 12, 'ROOM CLEAR', tokens.color.success, 24);
          }
          break;
        }
        case 'ability_unlocked': {
          const target = this.players.get(event.playerId)?.container;
          if (target) this.floatText(target.x, target.y - 30, 'UNLOCKED', tokens.canvas.localPlayerAccent, 14);
          break;
        }
        case 'anchor_planted': {
          const anchor = this.latestSnapshot?.anchor;
          if (anchor && event.worldId === this.latestSnapshot?.worldId && event.roomIndex === this.latestSnapshot.roomIndex) {
            this.animate(anchor.x, anchor.y, 1100, (g, t) => fx.drawShockwave(g, t, 200, hexToInt(this.art!.palette.accent), seed, true));
            this.cameras.main.flash(400, 124, 245, 255, false);
          }
          break;
        }
        case 'room_entered': {
          if (event.roomId === this.room?.id) this.cameras.main.flash(200, 124, 245, 255, false);
          break;
        }
        default:
          break;
      }
    }
  }

  private playAbility(event: Extract<GameEvent, { type: 'ability_used' }>, seed: number): void {
    const color = this.classColor(event.playerId);
    const white = 0xffffff;
    switch (event.abilityId) {
      case 'bastion.q.bulwark':
        this.animate(event.x, event.y, 500, (g, t) => fx.drawShockwave(g, t, 40, color, seed, false));
        break;
      case 'bastion.e.shockwave':
        this.animate(event.x, event.y, 650, (g, t) => fx.drawShockwave(g, t, 135, color, seed, true));
        this.cameras.main.shake(140, 0.005);
        break;
      case 'bastion.r.aegis_slam':
        this.animate(event.x, event.y, 1000, (g, t) => fx.drawShockwave(g, t, 175, color, seed, true));
        this.cameras.main.shake(320, 0.012);
        this.cameras.main.flash(180, 124, 245, 255, false);
        this.floatText(event.x, event.y - 40, 'AEGIS SLAM', CLASS_THEME.bastion.primary, 18);
        break;
      case 'shade.q.blink_strike':
        this.animate(event.x, event.y, 380, (g, t) => fx.drawBlink(g, t, event.facing, 112, color));
        break;
      case 'shade.e.shroud':
        this.animate(event.x, event.y, 700, (g, t) => fx.drawShroud(g, t, color, seed));
        break;
      case 'shade.r.blade_storm':
        this.animate(event.x, event.y, 900, (g, t) => fx.drawBladeStorm(g, t, 120, color));
        this.cameras.main.shake(200, 0.006);
        this.floatText(event.x, event.y - 40, 'BLADE STORM', CLASS_THEME.shade.primary, 18);
        break;
      case 'beacon.q.flare': {
        const hit = event.hitEnemyIds[0] ? this.enemyPositions.get(event.hitEnemyIds[0]) : null;
        const fx0 = hit ?? { x: event.x + Math.cos(event.facing) * 160, y: event.y + Math.sin(event.facing) * 160 };
        this.animate(fx0.x, fx0.y, 520, (g, t) => fx.drawFlare(g, t, color, seed));
        break;
      }
      case 'beacon.e.rally':
        this.animate(event.x, event.y, 800, (g, t) => fx.drawRally(g, t, color, 200, seed));
        break;
      case 'beacon.r.solar_lance':
        this.animate(event.x, event.y, 800, (g, t) => fx.drawBeam(g, t, event.facing, 420, color, 52));
        this.cameras.main.shake(200, 0.006);
        this.cameras.main.flash(160, 255, 207, 138, false);
        this.floatText(event.x, event.y - 40, 'SOLAR LANCE', CLASS_THEME.beacon.primary, 18);
        break;
      case 'weaver.q.tether': {
        const hit = event.hitEnemyIds[0] ? this.enemyPositions.get(event.hitEnemyIds[0]) : null;
        const to = hit ? { x: hit.x - event.x, y: hit.y - event.y } : { x: Math.cos(event.facing) * 220, y: Math.sin(event.facing) * 220 };
        this.animate(event.x, event.y, 450, (g, t) => fx.drawTether(g, t, { x: 0, y: 0 }, to, color, seed));
        break;
      }
      case 'weaver.e.rewind':
        this.animate(event.x, event.y, 600, (g, t) => fx.drawRewind(g, t, color));
        break;
      case 'weaver.r.collapse': {
        const cx = event.x + Math.cos(event.facing) * 200;
        const cy = event.y + Math.sin(event.facing) * 200;
        this.animate(cx, cy, 1200, (g, t) => fx.drawSingularity(g, t, 200, color, seed));
        this.cameras.main.shake(260, 0.007);
        this.floatText(event.x, event.y - 40, 'COLLAPSE', CLASS_THEME.weaver.primary, 18);
        break;
      }
      default:
        this.animate(event.x, event.y, 400, (g, t) => fx.drawImpact(g, t, white, seed, 1.5));
    }
  }

  // ---- per-frame ---------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (!this.room || !this.art || !this.portalGlow) return;
    this.portalPulse += delta / 1000;
    const t = this.portalPulse;
    const accent = hexToInt(this.art.palette.accent);
    const g = this.portalGlow;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    for (const exit of this.room.exits) {
      const c = tileToWorld(exit.x, exit.y);
      if (this.isHeadquarters) {
        // The portal: layered rings + rotating arcs, the luminous heart of the HQ.
        g.fillStyle(accent, 0.06 + 0.08 * pulse).fillCircle(c.x, c.y, 44 + pulse * 6);
        g.fillStyle(accent, 0.12 + 0.1 * pulse).fillCircle(c.x, c.y, 26);
        g.lineStyle(2, accent, 0.9).strokeCircle(c.x, c.y, 18 + pulse * 2);
        g.lineStyle(1.5, accent, 0.6);
        for (let i = 0; i < 3; i++) {
          const a0 = t * 1.4 + (i * Math.PI * 2) / 3;
          g.beginPath();
          g.arc(c.x, c.y, 30, a0, a0 + 1.2, false);
          g.strokePath();
        }
        g.lineStyle(1, 0xffffff, 0.35);
        for (let i = 0; i < 2; i++) {
          const a0 = -t * 2.1 + i * Math.PI;
          g.beginPath();
          g.arc(c.x, c.y, 38, a0, a0 + 0.6, false);
          g.strokePath();
        }
      } else {
        const open = this.latestSnapshot?.phase === 'training' || this.latestSnapshot?.roomCleared === true;
        g.fillStyle(accent, open ? 0.12 + 0.18 * pulse : 0.04).fillRect(exit.x * TILE_SIZE, exit.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        const angle = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[exit.direction];
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        g.lineStyle(2, accent, open ? 0.95 : 0.25);
        g.lineBetween(c.x - dx * 8 - dy * 7, c.y - dy * 8 + dx * 7, c.x + dx * 7, c.y + dy * 7);
        g.lineBetween(c.x - dx * 8 + dy * 7, c.y - dy * 8 - dx * 7, c.x + dx * 7, c.y + dy * 7);
        if (open) g.lineStyle(1.5, 0xffffff, 0.4 + 0.4 * pulse).strokeCircle(c.x, c.y, 14 + pulse * 4);
      }
    }
    if (this.motesGfx) drawMotes(this.motesGfx, this.motes, t, this.room.width * TILE_SIZE, this.room.height * TILE_SIZE, this.art.palette);
  }

  worldPointFromScreen(px: number, py: number): { x: number; y: number } {
    const v = this.cameras.main.getWorldPoint(px, py);
    return { x: v.x, y: v.y };
  }

  getLatestSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }
}
