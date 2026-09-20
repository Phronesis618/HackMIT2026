import Phaser from 'phaser';
import type { ArtRecipe, EnemyState, GameEvent, GameSnapshot, PlayerState, ReceiptLine, RoomSpec } from '../../shared/contracts';
import { ATTACK_ARC_RAD, ATTACK_RANGE, DEPTH, LORE_READ_RANGE, PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { ENEMY_INFO } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';
import { drawMotif, drawProp, drawSanctuary, drawSkyline, drawVignette } from './drawing';
import { drawHostile, drawOperative } from './characters';

interface EntityView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  facing: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  lastState: string;
  isLocal: boolean;
}

/** A player-authored idea that shaped a specific spot in this room (from `RoomSpec.attributions`). */
interface LoreMarker {
  x: number;
  y: number;
  quote: string;
  playerName: string;
}

/** Player proximity, in px, before an in-world lore caption reveals its text. */
const LORE_REVEAL_RADIUS = 56;

export class RoomScene extends Phaser.Scene {
  static readonly KEY = 'room';

  private room: RoomSpec | null = null;
  private art: ArtRecipe | null = null;
  private isHeadquarters = false;
  private roomLayer: Phaser.GameObjects.Layer | null = null;
  private portalGlow: Phaser.GameObjects.Graphics | null = null;
  private telegraphs: Phaser.GameObjects.Graphics | null = null;
  private projectilesView: Phaser.GameObjects.Graphics | null = null;
  private portalPulse = 0;
  private players = new Map<string, EntityView>();
  private enemies = new Map<string, EntityView>();
  private anchorView: Phaser.GameObjects.Graphics | null = null;
  private anchorLabel: Phaser.GameObjects.Text | null = null;
  /** In-world DM-style narration: markers over the props/encounters a real idea shaped. */
  private loreMarkers: LoreMarker[] = [];
  private loreView: Phaser.GameObjects.Graphics | null = null;
  private loreCaption: Phaser.GameObjects.Text | null = null;
  /** In-world Integrity/status strip above the room, replacing the old sidebar meter. */
  private statusView: Phaser.GameObjects.Graphics | null = null;
  private statusLabels = new Map<string, Phaser.GameObjects.Text>();
  /** Relics lying in the room and remains dropped by enemies (authoritative, from the snapshot). */
  private loreNodesView: Phaser.GameObjects.Graphics | null = null;
  private loreHint: Phaser.GameObjects.Text | null = null;
  /** Text is rasterised at this multiple so camera zoom on a high-DPI canvas stays crisp. */
  private textResolution = 1;
  private latestSnapshot: GameSnapshot | null = null;
  private localPlayerId = '';
  private enemyPositions = new Map<string, { x: number; y: number }>();
  private seenEffects = new Set<string>();
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

  /** `this.add.text` with the scene's current text resolution folded into the style. */
  private text(x: number, y: number, content: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.add.text(x, y, content, { ...style, resolution: this.textResolution });
  }

  // ---- room ------------------------------------------------------------------

  buildRoom(room: RoomSpec, art: ArtRecipe, opts: { headquarters: boolean }, loreLines: ReceiptLine[] = []): void {
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
    this.anchorView?.destroy();
    this.anchorView = null;
    this.anchorLabel = null;
    this.loreView = null;
    this.loreCaption = null;
    this.loreMarkers = this.computeLoreMarkers(room, loreLines);
    this.statusView = null;
    this.statusLabels.clear();
    this.loreNodesView = null;
    this.loreHint = null;

    const layer = this.add.layer();
    this.roomLayer = layer;
    const roomW = room.width * TILE_SIZE;
    const roomH = room.height * TILE_SIZE;
    const p = art.palette;

    // Frame the whole room. The canvas may be several times the nominal 1024px design
    // width (high-DPI), so the zoom ceiling scales with it and text rasterises to match.
    const cam = this.cameras.main;
    const density = Math.max(1, cam.width / tokens.canvas.defaultWidth);
    const zoom = Math.min(1.6 * density, cam.width / (roomW + 96), cam.height / (roomH + 96));
    this.textResolution = Math.min(4, Math.max(1, Math.ceil(zoom)));

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
        floor.fillStyle((row * 3 + col) % 7 === 0 ? floorAltInt : floorInt, 1).fillRect(x, y, TILE_SIZE, TILE_SIZE);
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
          layer.add(this.text(x + TILE_SIZE / 2, y + TILE_SIZE + 6, 'ANCHOR SITE', {
            fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent,
          }).setOrigin(0.5, 0).setDepth(DEPTH.floorDecal));
        }
        if (!opts.headquarters && ch === '.' && row % 3 === 1 && col % 4 === 1) {
          const motif = art.motifIds[(Math.floor(row / 3) + Math.floor(col / 4)) % art.motifIds.length];
          if (motif) drawMotif(decals, motif, x + TILE_SIZE / 2, y + TILE_SIZE / 2, p);
        }
      }
    }
    // Subtle grid to sell the top-down plane.
    decals.lineStyle(1, edgeInt, 0.06);
    for (let col = 0; col <= room.width; col++) decals.lineBetween(col * TILE_SIZE, 0, col * TILE_SIZE, roomH);
    for (let row = 0; row <= room.height; row++) decals.lineBetween(0, row * TILE_SIZE, roomW, row * TILE_SIZE);
    layer.add([floor, decals, walls]);
    if (opts.headquarters) {
      const sanctuary = this.add.graphics().setDepth(DEPTH.floorDecal + 2);
      const exit = room.exits[0];
      drawSanctuary(sanctuary, roomW, roomH, p, exit ? tileToWorld(exit.x, exit.y) : undefined);
      layer.add(sanctuary);
      layer.add(this.text(roomW - 160, 17, 'CHRONICLE ARCHIVE', {
        fontFamily: tokens.font.mono, fontSize: '10px', color: tokens.color.warmLamp,
      }).setOrigin(0.5).setDepth(DEPTH.overlay));
    }

    const props = this.add.graphics().setDepth(DEPTH.propsBehind + 1);
    for (const prop of room.props) {
      const c = tileToWorld(prop.x, prop.y);
      drawProp(props, prop.propId, c.x, c.y, p, art.glowIntensity);
    }
    layer.add(props);

    if (opts.headquarters) this.drawControlsFloorHint(layer, roomW / 2, 7 * TILE_SIZE, p);

    // Portal / exits glow (animated in update()).
    this.portalGlow = this.add.graphics().setDepth(DEPTH.floorDecal + 3);
    layer.add(this.portalGlow);
    this.telegraphs = this.add.graphics().setDepth(DEPTH.floorDecal + 4);
    layer.add(this.telegraphs);
    this.projectilesView = this.add.graphics().setDepth(DEPTH.effects - 1);
    layer.add(this.projectilesView);

    // DM-style narration: a quiet glow over anything a real idea shaped, plus one
    // reusable caption that reveals the quote when a player walks up to it.
    this.loreView = this.add.graphics().setDepth(DEPTH.floorDecal + 2);
    layer.add(this.loreView);
    this.loreCaption = this
      .text(0, 0, '', {
        fontFamily: tokens.font.body, fontSize: '11px', color: p.text, align: 'center',
        wordWrap: { width: 220 }, backgroundColor: 'rgba(7, 9, 15, 0.78)',
        padding: { left: 7, right: 7, top: 5, bottom: 5 },
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    layer.add(this.loreCaption);

    // Relics and dropped remains: physical lore, drawn from the authoritative snapshot.
    this.loreNodesView = this.add.graphics().setDepth(DEPTH.entities - 1);
    layer.add(this.loreNodesView);
    this.loreHint = this.text(0, 0, 'HOLD F · READ', {
      fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent, letterSpacing: 1,
    }).setOrigin(0.5, 1).setDepth(DEPTH.overlay).setVisible(false);
    layer.add(this.loreHint);

    // In-world Integrity strip (replaces the old sidebar meter); one row per crew member.
    this.statusView = this.add.graphics().setDepth(DEPTH.overlay - 1);
    layer.add(this.statusView);

    const fog = this.add.graphics().setDepth(DEPTH.fog);
    drawVignette(fog, roomW, roomH, art.fog, p);
    layer.add(fog);

    const title = this
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

    // A DM-style beat on arrival: the room's mood in its own words, then it fades and
    // leaves the (now much smaller) sidebar to the mechanical stuff.
    if (room.description) {
      const descriptionCard = this
        .text(roomW / 2, Math.min(96, roomH * 0.3), room.description, {
          fontFamily: tokens.font.body, fontSize: '12px', color: p.text, align: 'center',
          wordWrap: { width: Math.min(roomW - 40, 420) },
          backgroundColor: 'rgba(7, 9, 15, 0.55)',
          padding: { left: 10, right: 10, top: 8, bottom: 8 },
        })
        .setOrigin(0.5, 0)
        .setAlpha(0)
        .setDepth(DEPTH.overlay);
      layer.add(descriptionCard);
      // Fade in, hold, fade back out — one tween (yoyo) instead of a chained pair.
      this.tweens.add({
        targets: descriptionCard, alpha: 1, duration: tokens.motion.slowMs, delay: 320,
        hold: 4200, yoyo: true, onComplete: () => descriptionCard.destroy(),
      });
    }

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
      this.enemyPositions.set(enemy.id, { x: enemy.x, y: enemy.y });
      seenEnemies.add(enemy.id);
      let view = this.enemies.get(enemy.id);
      if (!view) {
        view = this.createEntityView(ENEMY_INFO[enemy.enemyId].name, false, ENEMY_INFO[enemy.enemyId].radius, 'enemy');
        this.enemies.set(enemy.id, view);
      }
      this.updateEnemyView(view, enemy);
      const warning = enemy.telegraph;
      const g = this.telegraphs;
      if (warning && g) {
        const color = hexToInt(tokens.canvas.telegraph);
        g.fillStyle(color, 0.16).lineStyle(2, color, 0.9);
        if (warning.kind === 'burst' || warning.kind === 'ring' || warning.kind === 'spiral') {
          g.fillCircle(warning.x, warning.y, warning.range).strokeCircle(warning.x, warning.y, warning.range);
        } else {
          g.beginPath().slice(warning.x, warning.y, warning.range,
            warning.facing - warning.arcRad / 2, warning.facing + warning.arcRad / 2, false).fillPath().strokePath();
        }
      }
    }
    for (const [id, view] of this.enemies) {
      if (!seenEnemies.has(id)) {
        view.container.destroy(true);
        this.enemies.delete(id);
      }
    }

    const bolts = this.projectilesView;
    if (bolts) {
      bolts.clear();
      const boltColor = hexToInt(tokens.canvas.projectile);
      for (const pr of snapshot.projectiles ?? []) {
        const angle = Math.atan2(pr.vy, pr.vx);
        const trail = Math.min(20, 8 + pr.radius * 2);
        bolts.lineStyle(Math.max(2, pr.radius), boltColor, 0.35)
          .lineBetween(pr.x - Math.cos(angle) * trail, pr.y - Math.sin(angle) * trail, pr.x, pr.y);
        bolts.fillStyle(boltColor, 1).fillCircle(pr.x, pr.y, pr.radius);
        bolts.lineStyle(1, 0xffffff, 0.75).strokeCircle(pr.x, pr.y, pr.radius);
      }
    }

    if (snapshot.anchor && !this.anchorView) {
      this.anchorView = this.add.graphics().setDepth(DEPTH.entities);
      this.anchorLabel = this.text(0, 0, '', {
        fontFamily: tokens.font.mono, fontSize: '12px', color: this.art.palette.text,
      }).setOrigin(0.5).setDepth(DEPTH.overlay);
      this.roomLayer?.add([this.anchorView, this.anchorLabel]);
    }
    if (snapshot.anchor && this.anchorView) {
      const a = snapshot.anchor;
      const accent = hexToInt(this.art.palette.accent);
      this.anchorView.clear();
      this.anchorView.fillStyle(accent, 0.15).fillCircle(a.x, a.y, 20 + Math.sin(this.time.now / 300) * 3);
      this.anchorView.fillStyle(accent, a.state === 'planted' ? 1 : 0.6).fillCircle(a.x, a.y, 6);
      this.anchorView.lineStyle(2, accent, 0.8).strokeTriangle(a.x, a.y - 17, a.x - 10, a.y + 7, a.x + 10, a.y + 7);
      this.anchorView.lineStyle(3, accent, 0.2).strokeCircle(a.x, a.y, 28);
      const progress = a.state === 'planted' ? 1 : a.state === 'planting' ? a.progress : 0;
      if (progress > 0) {
        this.anchorView.lineStyle(3, accent, 1).beginPath()
          .arc(a.x, a.y, 28, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2, false).strokePath();
      }
      this.anchorLabel?.setPosition(a.x, a.y - 42).setVisible(true).setText(
        a.state === 'planted' ? 'ANCHOR PLANTED' : a.state === 'planting' ? `PLANTING · ${Math.floor(a.progress * 100)}%` : 'ANCHOR DORMANT',
      );
    } else if (!snapshot.anchor) {
      this.anchorView?.clear();
      this.anchorLabel?.setVisible(false);
    }

    this.updateLoreCaption(snapshot, localPlayerId);
    this.updateLoreNodes(snapshot, localPlayerId);
    if (!this.isHeadquarters) this.updateStatusStrip(snapshot, localPlayerId);
  }

  /**
   * Relics read as small standing tablets; remains as a shard where the enemy fell. Sealed
   * ones breathe, a relic being read fills an arc, collected relics stay as dim furniture.
   */
  private updateLoreNodes(snapshot: GameSnapshot, localPlayerId: string): void {
    const g = this.loreNodesView;
    if (!g || !this.art) return;
    g.clear();
    const accent = hexToInt(this.art.palette.accent);
    const warm = hexToInt(tokens.color.warmLamp);
    const ink = hexToInt(this.art.palette.wall);
    const t = this.time.now / 1000;
    const me = snapshot.players.find((p) => p.id === localPlayerId);
    let hintTarget: { x: number; y: number } | null = null;
    for (const node of snapshot.loreNodes ?? []) {
      const collected = node.state === 'collected';
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + node.x * 0.02);
      if (node.kind === 'relic') {
        if (!collected) g.fillStyle(accent, 0.06 + 0.06 * pulse).fillCircle(node.x, node.y + 4, 22 + pulse * 3);
        g.fillStyle(0x000000, 0.3).fillEllipse(node.x + 2, node.y + 10, 22, 8);
        g.fillStyle(ink, 1).fillRoundedRect(node.x - 7, node.y - 11, 14, 20, 3);
        g.lineStyle(1.5, accent, collected ? 0.25 : 0.85).strokeRoundedRect(node.x - 7, node.y - 11, 14, 20, 3);
        g.lineStyle(1, accent, collected ? 0.2 : 0.7);
        for (let i = 0; i < 3; i++) g.lineBetween(node.x - 4, node.y - 6 + i * 5, node.x + (i === 1 ? 2 : 4), node.y - 6 + i * 5);
        if (node.state === 'reading') {
          g.lineStyle(3, accent, 1).beginPath()
            .arc(node.x, node.y, 18, -Math.PI / 2, -Math.PI / 2 + node.progress * Math.PI * 2, false).strokePath();
        } else if (!collected && me && Math.hypot(me.x - node.x, me.y - node.y) <= LORE_READ_RANGE + 12) {
          hintTarget = node;
        }
      } else {
        const spin = t * 1.8;
        g.fillStyle(warm, 0.08 + 0.08 * pulse).fillCircle(node.x, node.y, 16 + pulse * 3);
        g.lineStyle(1.5, warm, 0.9).beginPath();
        for (let i = 0; i < 4; i++) {
          const a = spin + i * Math.PI / 2;
          const r = i % 2 === 0 ? 8 : 4;
          const px = node.x + Math.cos(a) * r;
          const py = node.y + Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath().strokePath();
        g.fillStyle(warm, 0.9).fillCircle(node.x, node.y, 2);
      }
    }
    if (this.loreHint) {
      if (hintTarget) this.loreHint.setPosition(hintTarget.x, hintTarget.y - 18).setVisible(true);
      else this.loreHint.setVisible(false);
    }
  }

  /** The discovery moment: title + text over the room, then it fades and lives in the Codex. */
  private revealLore(title: string, text: string, x: number, y: number): void {
    if (!this.room || !this.art) return;
    const p = this.art.palette;
    this.burst(x, y, hexToInt(tokens.color.warmLamp), 18);
    const roomW = this.room.width * TILE_SIZE;
    const roomH = this.room.height * TILE_SIZE;
    const top = Math.min(96, roomH * 0.3);
    const heading = this.text(roomW / 2, top, title.toUpperCase(), {
      fontFamily: tokens.font.display, fontSize: '13px', color: tokens.color.warmLamp, letterSpacing: 3, align: 'center',
    }).setOrigin(0.5, 1).setAlpha(0).setDepth(DEPTH.overlay);
    const body = this.text(roomW / 2, top + 6, text, {
      fontFamily: tokens.font.body, fontSize: '12px', color: p.text, align: 'center',
      wordWrap: { width: Math.min(roomW - 40, 420) }, backgroundColor: 'rgba(7, 9, 15, 0.7)',
      padding: { left: 10, right: 10, top: 8, bottom: 8 },
    }).setOrigin(0.5, 0).setAlpha(0).setDepth(DEPTH.overlay);
    this.roomLayer?.add([heading, body]);
    this.tweens.add({
      targets: [heading, body], alpha: 1, duration: tokens.motion.baseMs, hold: 6000, yoyo: true,
      onComplete: () => { heading.destroy(); body.destroy(); },
    });
  }

  /** Reveals the nearest lore marker's quote only while a player stands close to it. */
  private updateLoreCaption(snapshot: GameSnapshot, localPlayerId: string): void {
    const caption = this.loreCaption;
    if (!caption || this.loreMarkers.length === 0) return;
    const me = snapshot.players.find((p) => p.id === localPlayerId);
    let nearest: LoreMarker | null = null;
    let nearestDistance = LORE_REVEAL_RADIUS;
    if (me) {
      for (const marker of this.loreMarkers) {
        const d = Math.hypot(me.x - marker.x, me.y - marker.y);
        if (d <= nearestDistance) {
          nearest = marker;
          nearestDistance = d;
        }
      }
    }
    if (!nearest) {
      caption.setVisible(false);
      return;
    }
    const text = `“${nearest.quote}”\n— ${nearest.playerName}`;
    if (caption.text !== text) caption.setText(text);
    caption.setPosition(nearest.x, nearest.y - 30).setVisible(true);
  }

  /** In-world Integrity strip above the room: one compact bar per crew member. */
  private updateStatusStrip(snapshot: GameSnapshot, localPlayerId: string): void {
    const bars = this.statusView;
    if (!bars) return;
    bars.clear();
    const rowH = 15;
    const barX = 14;
    const barW = 108;
    snapshot.players.forEach((player, i) => {
      const y = -50 + i * rowH;
      const pct = player.maxHp > 0 ? Math.max(0, Math.min(1, player.hp / player.maxHp)) : 0;
      const down = player.state === 'down';
      const isLocal = player.id === localPlayerId;
      const fillColor = down ? hexToInt(tokens.color.danger) : pct <= 0.25 ? hexToInt(tokens.color.danger) : hexToInt(tokens.color.success);
      const edgeColor = hexToInt(isLocal ? tokens.canvas.localPlayerAccent : tokens.canvas.remotePlayerAccent);
      bars.fillStyle(0x000000, 0.55).fillRoundedRect(barX, y, barW, 8, 3);
      if (!down) bars.fillStyle(fillColor, 0.95).fillRoundedRect(barX, y, barW * pct, 8, 3);
      bars.lineStyle(1, edgeColor, isLocal ? 0.9 : 0.5).strokeRoundedRect(barX, y, barW, 8, 3);

      let label = this.statusLabels.get(player.id);
      if (!label) {
        label = this.text(0, 0, '', { fontFamily: tokens.font.mono, fontSize: '9px', color: tokens.color.mist100 }).setOrigin(0, 0.5).setDepth(DEPTH.overlay);
        this.roomLayer?.add(label);
        this.statusLabels.set(player.id, label);
      }
      label.setPosition(barX + barW + 6, y + 4);
      const text = `${player.displayName}${down ? ' · down' : ''}`;
      if (label.text !== text) label.setText(text);
    });
    for (const [id, label] of this.statusLabels) {
      if (!snapshot.players.some((p) => p.id === id)) {
        label.destroy();
        this.statusLabels.delete(id);
      }
    }
  }

  private createEntityView(name: string, isLocal: boolean, radius: number, kind: 'player' | 'enemy'): EntityView {
    const container = this.add.container(0, 0).setDepth(DEPTH.entities);
    this.roomLayer?.add(container);
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35).fillEllipse(0, radius * 0.9, radius * 2.2, radius * 0.9);
    const body = this.add.graphics();
    const facing = this.add.graphics();
    const hpBar = this.add.graphics();
    const label = this
      .text(0, -radius - 14, name, {
        fontFamily: tokens.font.body,
        fontSize: '12px',
        color: kind === 'player' ? tokens.color.mist100 : tokens.color.mist300,
      })
      .setOrigin(0.5)
      .setAlpha(kind === 'player' ? 0.95 : 0.7);
    container.add([shadow, body, facing, hpBar, label]);
    const view: EntityView = { container, body, facing, label, hpBar, lastState: '', isLocal };
    return view;
  }

  private updatePlayerView(view: EntityView, player: PlayerState): void {
    view.container.setPosition(player.x, player.y);
    view.container.setDepth(DEPTH.entities + player.y / 10000);
    view.container.setAlpha(player.state === 'down' ? 0.45 : (player.shroudMs ?? 0) > 0 ? 0.5 : player.invulnerableMs > 0 ? 0.7 : 1);
    const appearance = `${player.classId}:${player.state}`;
    if (view.lastState !== appearance) {
      view.lastState = appearance;
      drawOperative(view.body, player, view.isLocal);
    }
    const moving = player.state === 'moving';
    view.body.setRotation(player.facing);
    view.body.setPosition(0, Math.sin(this.time.now / (moving ? 65 : 400)) * (moving ? 1.8 : 0.6));
    view.body.setScale(player.state === 'dashing' ? 1.2 : 1, player.state === 'dashing' ? 0.8 : 1);
    view.facing.clear();
    view.facing.lineStyle(1, hexToInt(tokens.canvas.localPlayerAccent), view.isLocal ? 0.6 : 0);
    view.facing.beginPath().arc(0, 0, PLAYER_RADIUS + 12, -0.3, 0.3).strokePath();
    view.facing.setRotation(player.facing);
    if ((player.shieldMs ?? 0) > 0) view.facing.lineStyle(3, hexToInt(tokens.canvas.localPlayerAccent), 0.9).strokeCircle(0, 0, PLAYER_RADIUS + 7);
    if ((player.rallyMs ?? 0) > 0) view.facing.lineStyle(2, hexToInt(tokens.color.success), 0.9).strokeCircle(0, 0, PLAYER_RADIUS + 11);
    if (player.state === 'down' && (player.reviveProgress ?? 0) > 0) {
      view.facing.lineStyle(3, hexToInt(tokens.color.success), 1).beginPath()
        .arc(0, 0, PLAYER_RADIUS + 10, -Math.PI / 2 - player.facing,
          -Math.PI / 2 - player.facing + player.reviveProgress! * Math.PI * 2, false).strokePath();
    }
    if (view.label.text !== player.displayName) view.label.setText(player.displayName);
    this.drawHpBar(view.hpBar, player.hp, player.maxHp, PLAYER_RADIUS, hexToInt(tokens.color.success));
  }

  private updateEnemyView(view: EntityView, enemy: EnemyState): void {
    const radius = ENEMY_INFO[enemy.enemyId].radius;
    view.container.setPosition(enemy.x, enemy.y);
    view.container.setDepth(DEPTH.entities + enemy.y / 10000);
    const appearance = `${enemy.enemyId}:${enemy.state}`;
    if (view.lastState !== appearance) {
      view.lastState = appearance;
      drawHostile(view.body, enemy);
    }
    view.body.setRotation(enemy.facing);
    view.container.setAlpha(enemy.state === 'dead' ? 0.2 : 1);
    view.facing.clear();
    if (enemy.state === 'attacking') {
      view.facing.lineStyle(2, hexToInt(tokens.canvas.telegraph), 0.8);
      view.facing.beginPath().arc(0, 0, radius + 16, -0.6, 0.6).strokePath();
    }
    view.facing.setRotation(enemy.facing);
    if ((enemy.markMs ?? 0) > 0) view.facing.lineStyle(2, hexToInt(tokens.color.warmLamp), 0.9).strokeCircle(0, 0, radius + 5);
    if ((enemy.stunMs ?? 0) > 0) view.facing.lineStyle(2, hexToInt(tokens.color.mist100), 0.9).strokeCircle(0, 0, radius + 9);
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

  /**
   * Turns `RoomSpec.attributions` (compiled, position-anchored) into in-world markers by
   * pairing each one with the original player's words from the creation receipt. This is
   * the DM-style alternative to listing contributions as sidebar prose: a real idea shows
   * up as a small glowing waypoint near the exact prop/encounter/hazard it shaped, and only
   * speaks when a player walks up to it. Fixture worlds have no attributions, so this is a
   * no-op until a live-generated world with real contributions is played.
   */
  private computeLoreMarkers(room: RoomSpec, loreLines: ReceiptLine[]): LoreMarker[] {
    if (room.attributions.length === 0) return [];
    const byContribution = new Map(loreLines.map((line) => [line.contributionId, line]));
    const markers: LoreMarker[] = [];
    for (const attribution of room.attributions) {
      if (!attribution.target || attribution.target.roomIndex !== room.index) continue;
      const line = byContribution.get(attribution.contributionId);
      if (!line || !line.used) continue;
      const c = tileToWorld(attribution.target.x, attribution.target.y);
      markers.push({ x: c.x, y: c.y, quote: line.text, playerName: line.playerName });
    }
    return markers;
  }

  /**
   * Crude Isaac-style floor tutorial: WASD + mouse + the action keys, drawn once on the
   * headquarters floor instead of repeating the same sentence in the HUD every room.
   */
  private drawControlsFloorHint(layer: Phaser.GameObjects.Layer, cx: number, cy: number, palette: ArtRecipe['palette']): void {
    const g = this.add.graphics().setDepth(DEPTH.floorDecal + 1);
    const ink = hexToInt(palette.wallEdge);
    const accent = hexToInt(palette.accent);
    const key = (x: number, y: number, w: number, h: number): void => {
      g.fillStyle(hexToInt(palette.wall), 0.9).fillRoundedRect(x - w / 2, y - h / 2, w, h, 4);
      g.lineStyle(1.5, ink, 0.8).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 4);
    };
    const labels: Phaser.GameObjects.Text[] = [];
    const letter = (x: number, y: number, text: string): void => {
      labels.push(this.text(x, y, text, { fontFamily: tokens.font.mono, fontSize: '11px', color: palette.text }).setOrigin(0.5));
    };
    const caption = (x: number, y: number, text: string): void => {
      labels.push(this.text(x, y, text, { fontFamily: tokens.font.mono, fontSize: '8px', color: palette.text }).setOrigin(0.5).setAlpha(0.6));
    };

    // WASD cluster, left side.
    const wasdX = cx - 150;
    key(wasdX, cy - 16, 22, 22);
    letter(wasdX, cy - 16, 'W');
    for (const [dx, ch] of [[-24, 'A'], [0, 'S'], [24, 'D']] as const) {
      key(wasdX + dx, cy + 8, 22, 22);
      letter(wasdX + dx, cy + 8, ch);
    }
    caption(wasdX, cy + 30, 'MOVE');

    // Mouse glyph, aim.
    const mouseX = cx - 70;
    g.lineStyle(1.5, ink, 0.85).fillStyle(hexToInt(palette.wall), 0.9);
    g.fillRoundedRect(mouseX - 12, cy - 24, 24, 34, 12).strokeRoundedRect(mouseX - 12, cy - 24, 24, 34, 12);
    g.lineStyle(1.5, accent, 0.9).lineBetween(mouseX, cy - 24, mouseX, cy - 8);
    caption(mouseX, cy + 22, 'AIM');

    // Action keys, right side: attack, dash, abilities, interact.
    const actions: Array<[string, string]> = [['J', 'ATTACK'], ['SHIFT', 'DASH'], ['Q', 'Q'], ['E', 'E'], ['F', 'HOLD']];
    actions.forEach(([label, cap], i) => {
      const x = cx + 10 + i * 40;
      const w = label.length > 1 ? 34 : 22;
      key(x, cy - 6, w, 22);
      letter(x, cy - 6, label);
      caption(x, cy + 16, cap);
    });

    layer.add(g);
    layer.add(labels);
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

  private burst(x: number, y: number, color: number, radius: number): void {
    const g = this.effect(x, y);
    g.lineStyle(2, color, 1).strokeCircle(0, 0, radius / 2);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      g.lineBetween(Math.cos(a) * radius, Math.sin(a) * radius, Math.cos(a) * (radius + 8), Math.sin(a) * (radius + 8));
    }
    this.tweens.add({ targets: g, alpha: 0, scale: 1.8, duration: tokens.motion.baseMs * 1.5, onComplete: () => g.destroy() });
  }

  playEvents(events: GameEvent[]): void {
    if (!this.art) return;
    for (const event of events) {
      if (this.seenEffects.has(event.id)) continue;
      this.seenEffects.add(event.id);
      if (this.seenEffects.size > 4000) this.seenEffects.delete(this.seenEffects.values().next().value!);
      switch (event.type) {
        case 'player_dashed': {
          const g = this.effect(event.x, event.y);
          const accent = hexToInt(event.playerId === this.localPlayerId ? tokens.canvas.localPlayerAccent : tokens.canvas.remotePlayerAccent);
          g.lineStyle(3, accent, 0.9).lineBetween(
            0, 0,
            -Math.cos(event.facing) * 40,
            -Math.sin(event.facing) * 40,
          );
          g.fillStyle(accent, 0.3).fillCircle(0, 0, PLAYER_RADIUS + 6);
          this.tweens.add({ targets: g, alpha: 0, duration: tokens.motion.baseMs, onComplete: () => g.destroy() });
          break;
        }
        case 'player_attacked': {
          const g = this.effect(event.x, event.y);
          const range = event.range ?? ATTACK_RANGE;
          const arc = event.arcRad ?? ATTACK_ARC_RAD;
          g.lineStyle(3, hexToInt(tokens.canvas.telegraph), 0.9);
          g.beginPath();
          g.arc(0, 0, range, event.facing - arc / 2, event.facing + arc / 2, false);
          g.strokePath();
          if (arc < 0.3) g.lineBetween(0, 0, Math.cos(event.facing) * range, Math.sin(event.facing) * range);
          this.tweens.add({ targets: g, alpha: 0, scale: 1.1, duration: tokens.motion.fastMs * 1.5, onComplete: () => g.destroy() });
          break;
        }
        case 'enemy_attacked': {
          const color = hexToInt(tokens.canvas.projectile);
          const g = this.effect(event.x, event.y);
          g.lineStyle(2, color, 0.85).lineBetween(0, 0, Math.cos(event.facing) * 26, Math.sin(event.facing) * 26);
          g.fillStyle(color, 0.4).fillCircle(0, 0, 10);
          this.tweens.add({ targets: g, alpha: 0, scale: 1.4, duration: tokens.motion.fastMs, onComplete: () => g.destroy() });
          break;
        }
        case 'enemy_damaged':
        case 'player_damaged': {
          const target = event.type === 'enemy_damaged'
            ? this.enemyPositions.get(event.enemyId)
            : this.players.get(event.playerId)?.container;
          if (target) {
            const g = this.effect(target.x, target.y);
            g.fillStyle(0xffffff, 0.8).fillCircle(0, 0, 15);
            this.tweens.add({ targets: g, alpha: 0, duration: tokens.motion.fastMs, onComplete: () => g.destroy() });
          }
          if (event.type === 'player_damaged' && event.playerId === this.localPlayerId) this.cameras.main.shake(80, 0.002);
          break;
        }
        case 'enemy_defeated': {
          const target = this.enemyPositions.get(event.enemyId);
          if (target) this.burst(target.x, target.y, hexToInt(tokens.canvas.enemyAccent), 16);
          break;
        }
        case 'player_downed': {
          const target = this.players.get(event.playerId)?.container;
          if (target) this.burst(target.x, target.y, hexToInt(tokens.color.danger), PLAYER_RADIUS + 8);
          break;
        }
        case 'ability_used': {
          this.burst(event.x, event.y, hexToInt(this.art.palette.accent), PLAYER_RADIUS + 14);
          break;
        }
        case 'player_healed':
        case 'player_revived': {
          const target = this.players.get(event.playerId)?.container;
          if (target) this.burst(target.x, target.y, hexToInt(tokens.color.success), PLAYER_RADIUS + 10);
          break;
        }
        case 'lore_discovered': {
          this.revealLore(event.title, event.text, event.x, event.y);
          break;
        }
        case 'anchor_planted': {
          const anchor = this.latestSnapshot?.anchor;
          if (anchor && event.worldId === this.latestSnapshot?.worldId && event.roomIndex === this.latestSnapshot.roomIndex) {
            this.burst(anchor.x, anchor.y, hexToInt(this.art.palette.accent), 28);
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

  // ---- per-frame ---------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (!this.room || !this.art || !this.portalGlow) return;
    this.portalPulse += delta / 1000;
    const accent = hexToInt(this.art.palette.accent);
    const g = this.portalGlow;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.portalPulse * 2.2);

    if (this.loreView && this.loreMarkers.length > 0) {
      this.loreView.clear();
      for (const marker of this.loreMarkers) {
        const lp = 0.5 + 0.5 * Math.sin(this.portalPulse * 1.6 + marker.x * 0.01);
        this.loreView.fillStyle(accent, 0.07 + 0.05 * lp).fillCircle(marker.x, marker.y, 18 + lp * 3);
        this.loreView.lineStyle(1.5, accent, 0.55 + 0.3 * lp);
        this.loreView.beginPath()
          .moveTo(marker.x, marker.y - 7).lineTo(marker.x + 7, marker.y).lineTo(marker.x, marker.y + 7).lineTo(marker.x - 7, marker.y)
          .closePath().strokePath();
      }
    }
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
        const open = this.latestSnapshot?.roomCleared === true;
        g.fillStyle(accent, open ? 0.1 + 0.15 * pulse : 0.04).fillRect(exit.x * TILE_SIZE, exit.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        const angle = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 }[exit.direction];
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        g.lineStyle(2, accent, open ? 0.95 : 0.25);
        g.lineBetween(c.x - dx * 8 - dy * 7, c.y - dy * 8 + dx * 7, c.x + dx * 7, c.y + dy * 7);
        g.lineBetween(c.x - dx * 8 + dy * 7, c.y - dy * 8 - dx * 7, c.x + dx * 7, c.y + dy * 7);
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
