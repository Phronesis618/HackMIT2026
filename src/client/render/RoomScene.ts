/**
 * RoomScene — draws a RoomSpec + ArtRecipe and the entities in each GameSnapshot.
 * Owner: Agent C (src/client/render); Agent A extended it for the visual overhaul.
 *
 * It never decides gameplay: positions, states and events all come from the snapshot.
 * Effects: exactly ONE Graphics object and ONE tween per event; the tween drives a
 * progress value and the fx module redraws the frame (layered glow/body/core + particles).
 */
import Phaser from 'phaser';
import type { ArtRecipe, EnemyState, GameEvent, GameSnapshot, PlayerState, ReceiptLine, RoomSpec } from '../../shared/contracts';
import { ATTACK_ARC_RAD, ATTACK_RANGE, DEPTH, LORE_READ_RANGE, PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { hashString } from '../../shared/ids';
import { guardianTitle } from '../../shared/finale';
import { CLASS_THEME, ENEMY_INFO, type ClassId } from '../../shared/registry';
import { hexToInt, tokens } from '../../shared/tokens';
import { ENEMY_COMBAT } from '../../sim/combat';
import { drawHostile, drawOperative } from './characters';
import { hexInt, VOID_COLOR } from './color';
import { drawAnchorRitual } from './anchorRitual';
import { collectTerrainTiles, drawTerrain, terrainCaption, type TerrainTile } from './terrain';
import { drawHeadquartersStations, type HeadquartersStationView } from './headquarters';
import { drawMotif, drawProp, drawSanctuary, drawVignette } from './drawing';
import { drawBackdrop, drawFloor, drawLightPools, drawMotes, drawWalls, makeMotes, type Mote } from './environment';
import { artForRoom } from './biomeArt';
import { drawRoomKindDynamic, drawRoomKindStatic, featurePrompt, roomKindState, type RoomKindState } from './roomKinds';
import { drawDoorFrames, drawDoorStates, selectDoorViews, stepSeal, type DoorView } from './doors';
import { drawFloorDressing, drawOverhead, drawWallDressing, FLOOR_PATTERN, MOTE_STYLE, stencilColors, type MoteStyle } from './dressing';
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
  private motesGfx: Phaser.GameObjects.Graphics | null = null;
  private motes: Mote[] = [];
  private moteStyle: MoteStyle = 'sparks';
  private projectilesView: Phaser.GameObjects.Graphics | null = null;
  /** In-world DM-style narration: markers over the props/encounters a real idea shaped. */
  private loreMarkers: LoreMarker[] = [];
  private loreView: Phaser.GameObjects.Graphics | null = null;
  private loreCaption: Phaser.GameObjects.Text | null = null;
  /** In-world Integrity/status strip above the room. */
  private statusView: Phaser.GameObjects.Graphics | null = null;
  private bossLabel: Phaser.GameObjects.Text | null = null;
  private terrainView: Phaser.GameObjects.Graphics | null = null;
  private terrainHint: Phaser.GameObjects.Text | null = null;
  private terrainTiles: TerrainTile[] = [];
  private headquartersStations: HeadquartersStationView | null = null;
  private statusLabels = new Map<string, Phaser.GameObjects.Text>();
  private portalPulse = 0;
  /** Floors rooms only: per-door look for the latest snapshot and the eased shutter position. */
  private doorsView: Phaser.GameObjects.Graphics | null = null;
  private doorViews: DoorView[] = [];
  private doorSeal = 0;
  private kindView: Phaser.GameObjects.Graphics | null = null;
  private kindHint: Phaser.GameObjects.Text | null = null;
  private kindState: RoomKindState = { roomCleared: false, featureUsed: false, choiceOpen: false };
  private players = new Map<string, EntityView>();
  private enemies = new Map<string, EntityView>();
  private anchorView: Phaser.GameObjects.Graphics | null = null;
  private anchorLabel: Phaser.GameObjects.Text | null = null;
  /** Relics lying in the room and remains dropped by enemies (authoritative, from the snapshot). */
  private loreNodesView: Phaser.GameObjects.Graphics | null = null;
  private loreHint: Phaser.GameObjects.Text | null = null;
  /** Text is rasterised at this multiple so camera zoom on a high-DPI canvas stays crisp. */
  private textResolution = 1;
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
    this.cameras.main.setBackgroundColor(VOID_COLOR);
    this.onReady();
  }

  /** `this.add.text` with the scene's current text resolution folded into the style. */
  private text(x: number, y: number, content: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    return this.add.text(x, y, content, { ...style, resolution: this.textResolution });
  }

  // ---- room ------------------------------------------------------------------

  buildRoom(
    room: RoomSpec,
    art: ArtRecipe,
    opts: { headquarters: boolean; world?: { title: string; tagline: string } },
    loreLines: ReceiptLine[] = [],
  ): void {
    // Floors: the biome's own motifs and palette turn (no-op for legacy rooms and the hub).
    art = artForRoom(room, art);
    this.room = room;
    this.art = art;
    this.isHeadquarters = opts.headquarters;
    this.moteStyle = opts.headquarters ? 'fireflies' : MOTE_STYLE[art.motifIds[0] ?? art.skyline];
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
    this.loreView = null;
    this.loreCaption = null;
    this.loreMarkers = this.computeLoreMarkers(room, loreLines);
    this.statusView = null;
    this.bossLabel = null;
    this.terrainView = null;
    this.terrainHint = null;
    this.terrainTiles = collectTerrainTiles(room);
    this.headquartersStations = null;
    this.statusLabels.clear();
    this.loreNodesView = null;
    this.loreHint = null;
    this.doorsView = null;
    this.doorViews = [];
    this.doorSeal = 0;
    this.kindView = null;
    this.kindHint = null;
    this.kindState = { roomCleared: false, featureUsed: false, choiceOpen: false };

    const layer = this.add.layer();
    this.roomLayer = layer;
    const roomW = room.width * TILE_SIZE;
    const roomH = room.height * TILE_SIZE;
    const p = art.palette;
    const seed = hashString(room.id) % 100000;

    // Frame the whole room. The canvas may be several times the nominal 1024px design
    // width (high-DPI), so the zoom ceiling scales with it and text rasterises to match.
    const cam = this.cameras.main;
    const density = Math.max(1, cam.width / tokens.canvas.defaultWidth);
    const zoom = Math.min(1.6 * density, cam.width / (roomW + 96), cam.height / (roomH + 96));
    this.textResolution = Math.min(4, Math.max(1, Math.ceil(zoom)));

    const backdrop = this.add.graphics().setDepth(DEPTH.background);
    drawBackdrop(backdrop, roomW, roomH, p, art.skyline, seed);
    layer.add(backdrop);

    // The dominant motif decides the construction style of the whole room (see dressing.ts).
    const dominant = art.motifIds[0] ?? art.skyline;
    const floor = this.add.graphics().setDepth(DEPTH.floor);
    drawFloor(floor, room, p, seed, opts.headquarters ? 'plates' : FLOOR_PATTERN[dominant]);
    layer.add(floor);

    const lights = this.add.graphics().setDepth(DEPTH.floorDecal);
    drawLightPools(lights, room, p);
    layer.add(lights);

    if (!opts.headquarters) {
      const clutter = this.add.graphics().setDepth(DEPTH.floorDecal + 1);
      drawFloorDressing(clutter, room, p, art.motifIds, seed);
      layer.add(clutter);
    }

    const decals = this.add.graphics().setDepth(DEPTH.floorDecal + 1);
    for (let row = 0; row < room.height; row++) {
      const line = room.tiles[row] ?? '';
      for (let col = 0; col < room.width; col++) {
        const ch = line[col] ?? ' ';
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        if (ch === 'A') {
          layer.add(this.text(x + TILE_SIZE / 2, y + TILE_SIZE + 6, 'ANCHOR SITE', {
            fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent,
          }).setOrigin(0.5, 0).setDepth(DEPTH.floorDecal));
        }
        if (!opts.headquarters && ch === '.' && row % 4 === 1 && col % 6 === 2) {
          const motif = art.motifIds[(Math.floor(row / 4) + Math.floor(col / 6)) % art.motifIds.length];
          if (motif) drawMotif(decals, motif, x + TILE_SIZE / 2, y + TILE_SIZE / 2, p);
        }
      }
    }
    layer.add(decals);
    room.anchorRelays?.forEach((relay, index) => {
      const point = tileToWorld(relay.x, relay.y);
      layer.add(this.text(point.x, point.y + 24, `RELAY ${index + 1}`, {
        fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent,
      }).setOrigin(0.5).setDepth(DEPTH.floorDecal));
    });

    const walls = this.add.graphics().setDepth(DEPTH.propsBehind);
    drawWalls(walls, room, p, seed);
    layer.add(walls);
    this.terrainView = this.add.graphics().setDepth(DEPTH.propsBehind + 0.5);
    layer.add(this.terrainView);
    drawTerrain(this.terrainView, room, this.terrainTiles, undefined, p, this.time.now);
    if (room.kind !== undefined) {
      // Floors room: what the room is for, readable from the door (roomKinds.ts).
      const kindStatic = this.add.graphics().setDepth(DEPTH.floorDecal + 2);
      drawRoomKindStatic(kindStatic, room, p);
      layer.add(kindStatic);
      this.kindView = this.add.graphics().setDepth(DEPTH.propsBehind + 1.5);
      layer.add(this.kindView);
      this.kindHint = this.text(0, 0, '', {
        fontFamily: tokens.font.mono, fontSize: '9px', color: p.text, letterSpacing: 1,
        backgroundColor: 'rgba(4, 5, 10, 0.8)', padding: { left: 6, right: 6, top: 3, bottom: 3 },
      }).setOrigin(0.5, 1).setDepth(DEPTH.overlay - 1).setVisible(false);
      layer.add(this.kindHint);
    }
    if (room.kind !== undefined) {
      // Floors room: real doorways on the border wall. Frames are static; the light, the
      // chevron and the combat shutter are redrawn per frame in update().
      const frames = this.add.graphics().setDepth(DEPTH.propsBehind + 0.2);
      drawDoorFrames(frames, room, p);
      layer.add(frames);
      this.doorsView = this.add.graphics().setDepth(DEPTH.propsBehind + 0.6);
      layer.add(this.doorsView);
      this.doorViews = selectDoorViews(room, null);
    }
    if (!opts.headquarters) {
      const dressing = this.add.graphics().setDepth(DEPTH.propsBehind);
      drawWallDressing(dressing, room, p, art.motifIds, seed);
      layer.add(dressing);
    }

    if (opts.headquarters) {
      const sanctuary = this.add.graphics().setDepth(DEPTH.floorDecal + 2);
      const exit = room.exits[0];
      drawSanctuary(sanctuary, roomW, roomH, p, exit ? tileToWorld(exit.x, exit.y) : undefined);
      layer.add(sanctuary);
      this.headquartersStations = drawHeadquartersStations(this, layer, room, this.textResolution);
    }

    const props = this.add.graphics().setDepth(DEPTH.propsBehind + 1);
    for (const prop of room.props) {
      if (opts.headquarters && prop.id.startsWith('hq-station-')) continue;
      const c = tileToWorld(prop.x, prop.y);
      drawProp(props, prop.propId, c.x, c.y, p, art.glowIntensity);
    }
    layer.add(props);

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

    // In-world Integrity strip; one row per crew member.
    this.statusView = this.add.graphics().setDepth(DEPTH.overlay - 1);
    layer.add(this.statusView);
    this.terrainHint = this.text(0, 0, '', {
      fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent,
      backgroundColor: 'rgba(7, 9, 15, 0.85)', padding: { left: 6, right: 6, top: 4, bottom: 4 },
    }).setOrigin(0.5, 0).setDepth(DEPTH.overlay - 1).setVisible(false);
    layer.add(this.terrainHint);
    // A DM-style beat on arrival: the room's mood in its own words, then it fades out.
    if (room.description && !opts.headquarters) {
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
      this.tweens.add({ targets: descriptionCard, alpha: 1, duration: tokens.motion.slowMs, delay: 320, hold: 4200, yoyo: true, onComplete: () => descriptionCard.destroy() });
    }

    this.motes = makeMotes(roomW, roomH, seed, opts.headquarters ? 30 : this.moteStyle === 'embers' || this.moteStyle === 'sparks' ? 64 : 48);
    this.motesGfx = this.add.graphics().setDepth(DEPTH.effects - 2);
    layer.add(this.motesGfx);

    if (!opts.headquarters) {
      // Overhead structure (cables, vault ribs, lantern strings, canopy…) at low alpha.
      const overhead = this.add.graphics().setDepth(DEPTH.fog - 1);
      drawOverhead(overhead, room, p, art.motifIds, seed);
      layer.add(overhead);
    }

    const fog = this.add.graphics().setDepth(DEPTH.fog);
    drawVignette(fog, roomW, roomH, art.fog * 0.6, p);
    layer.add(fog);

    const title = this
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

    if (!opts.headquarters && opts.world) {
      // Which world this is, in every room; the full title stencilled into the floor of
      // the arrival room so the generated name is the first thing players read.
      layer.add(this.text(roomW / 2, -13, opts.world.title.toUpperCase(), {
        fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent, letterSpacing: 2,
      }).setOrigin(0.5).setAlpha(0.7).setDepth(DEPTH.overlay));
      if (room.index === 0) this.drawWorldStencil(layer, room, opts.world, p);
    }

    // Camera: frame the whole room (zoom computed above).
    cam.setZoom(zoom);
    cam.centerOn(roomW / 2, roomH / 2 - 8);
    cam.fadeIn(280, 0, 0, 0);
  }

  // ---- entities ---------------------------------------------------------------

  renderSnapshot(snapshot: GameSnapshot, localPlayerId: string): void {
    if (!this.art || snapshot.roomId !== this.room?.id) return;
    this.latestSnapshot = snapshot;
    this.localPlayerId = localPlayerId;
    this.headquartersStations?.update(snapshot, localPlayerId);
    if (this.doorsView) this.doorViews = selectDoorViews(this.room, snapshot.floor);
    if (this.kindView) {
      this.kindState = roomKindState(this.room, snapshot);
      const prompt = featurePrompt(this.room, this.kindState);
      const me = snapshot.players.find((player) => player.id === localPlayerId);
      const focus = this.room.focus ? tileToWorld(this.room.focus.x, this.room.focus.y) : null;
      const near = me && focus ? Math.hypot(me.x - focus.x, me.y - focus.y) < TILE_SIZE * 4.5 : false;
      if (prompt && focus && near) {
        if (this.kindHint?.text !== prompt) this.kindHint?.setText(prompt);
        this.kindHint?.setPosition(focus.x, focus.y - (this.room.feature === 'biome_exit' ? 34 : 30)).setVisible(true);
      } else this.kindHint?.setVisible(false);
    }

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
      const t = this.time.now / 1000;
      this.anchorView.clear();
      drawAnchorRitual(this.anchorView, a, this.time.now, accent, Math.hypot(this.room.width, this.room.height) * TILE_SIZE);
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
        .setText(a.ritual
          ? a.ritual.stage === 'locked' ? 'CIRCUIT LOCKED'
            : a.ritual.stage === 'relays' ? `${a.ritual.activeRelay}/3 RELAYS`
              : a.ritual.stage === 'core' ? 'F · RELEASE THE SIGNAL' : 'WORLD SECURED'
          : a.state === 'planted' ? 'ANCHOR PLANTED' : a.state === 'planting' ? `PLANTING · ${Math.floor(a.progress * 100)}%` : 'ANCHOR DORMANT');
    } else if (!snapshot.anchor) {
      this.anchorView?.clear();
      this.anchorLabel?.setVisible(false);
    }

    this.updateLoreCaption(snapshot, localPlayerId);
    this.updateLoreNodes(snapshot, localPlayerId);
    if (this.terrainView) drawTerrain(this.terrainView, this.room, this.terrainTiles, snapshot.terrain, this.art.palette, this.time.now);
    const local = snapshot.players.find((player) => player.id === localPlayerId);
    const caption = local ? terrainCaption(this.room, this.terrainTiles, snapshot.terrain, local) : null;
    if (caption && local && !this.loreCaption?.visible && !this.loreHint?.visible) {
      this.terrainHint?.setPosition(local.x, local.y + 30).setText(caption).setVisible(true);
    }
    else this.terrainHint?.setVisible(false);
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
    const edge = hexToInt(this.art.palette.wallEdge);
    const t = this.time.now / 1000;
    const me = snapshot.players.find((p) => p.id === localPlayerId);
    let hintTarget: { x: number; y: number } | null = null;
    for (const node of snapshot.loreNodes ?? []) {
      const collected = node.state === 'collected';
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + node.x * 0.02);
      if (node.kind === 'relic') {
        // A stele: stone base, tall slab leaning slightly, etched lines that catch the light,
        // and a column of light above it while it still has something to say.
        const alpha = collected ? 0.3 : 1;
        if (!collected) {
          g.fillStyle(accent, 0.05 + 0.05 * pulse).fillCircle(node.x, node.y + 8, 30 + pulse * 4);
          g.fillStyle(accent, 0.03 + 0.03 * pulse).fillRect(node.x - 9, node.y - 64 - pulse * 6, 18, 60 + pulse * 6);
        }
        g.fillStyle(0x000000, 0.35).fillEllipse(node.x + 3, node.y + 14, 38, 12);
        g.fillStyle(edge, 0.9 * alpha).fillRoundedRect(node.x - 14, node.y + 6, 28, 8, 3);
        g.fillStyle(ink, 1).fillRoundedRect(node.x - 10, node.y - 26, 20, 34, 4);
        g.lineStyle(1.5, accent, 0.85 * alpha).strokeRoundedRect(node.x - 10, node.y - 26, 20, 34, 4);
        g.lineStyle(1, accent, 0.55 * alpha).strokeRoundedRect(node.x - 7, node.y - 23, 14, 28, 3);
        g.lineStyle(1.2, accent, (0.45 + 0.4 * pulse) * alpha);
        for (let i = 0; i < 5; i++) {
          const w = i === 0 ? 8 : i === 4 ? 6 : 10;
          g.lineBetween(node.x - 5, node.y - 18 + i * 5, node.x - 5 + w, node.y - 18 + i * 5);
        }
        g.fillStyle(accent, (0.6 + 0.4 * pulse) * alpha).fillCircle(node.x, node.y - 30, 2);
        if (node.state === 'reading') {
          g.lineStyle(3, accent, 1).beginPath()
            .arc(node.x, node.y - 8, 26, -Math.PI / 2, -Math.PI / 2 + node.progress * Math.PI * 2, false).strokePath();
        } else if (!collected && me && Math.hypot(me.x - node.x, me.y - node.y) <= LORE_READ_RANGE + 12) {
          hintTarget = node;
        }
      } else {
        // Remains: a cluster of three shards over a warm ember glow, slowly turning.
        const spin = t * 1.2;
        g.fillStyle(warm, 0.1 + 0.1 * pulse).fillCircle(node.x, node.y, 22 + pulse * 4);
        g.fillStyle(warm, 0.05).fillCircle(node.x, node.y, 34 + pulse * 6);
        for (let s = 0; s < 3; s++) {
          const base = spin + s * (Math.PI * 2 / 3);
          const cx = node.x + Math.cos(base) * 7;
          const cy = node.y + Math.sin(base) * 7;
          g.fillStyle(ink, 1).lineStyle(1.5, warm, 0.95).beginPath();
          for (let i = 0; i < 4; i++) {
            const a = base * 1.5 + i * Math.PI / 2;
            const r = i % 2 === 0 ? 9 : 4;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath().fillPath().strokePath();
        }
        g.fillStyle(0xffffff, 0.7 + 0.3 * pulse).fillCircle(node.x, node.y, 2.5);
      }
    }
    if (this.loreHint) {
      if (hintTarget) this.loreHint.setPosition(hintTarget.x, hintTarget.y - 40).setVisible(true);
      else this.loreHint.setVisible(false);
    }
  }

  /** The discovery moment: title + text over the room, then it fades and lives in the Codex. */
  private revealLore(title: string, source: string, text: string, x: number, y: number): void {
    if (!this.room || !this.art) return;
    const p = this.art.palette;
    this.animate(x, y, 600, (g, t) => fx.drawFlare(g, t, hexToInt(tokens.color.warmLamp), 7));
    const roomW = this.room.width * TILE_SIZE;
    const roomH = this.room.height * TILE_SIZE;
    const top = Math.min(72, roomH * 0.22);
    const width = Math.min(roomW - 40, 480);
    const heading = this.text(roomW / 2, top, title.toUpperCase(), {
      fontFamily: tokens.font.display, fontSize: '15px', color: tokens.color.warmLamp, letterSpacing: 3, align: 'center',
      wordWrap: { width },
    }).setOrigin(0.5, 1).setAlpha(0).setDepth(DEPTH.overlay);
    const provenance = this.text(roomW / 2, top + 4, source, {
      fontFamily: tokens.font.mono, fontSize: '9px', color: p.accent, letterSpacing: 1, align: 'center', wordWrap: { width },
    }).setOrigin(0.5, 0).setAlpha(0).setDepth(DEPTH.overlay);
    const body = this.text(roomW / 2, top + 22, text, {
      fontFamily: tokens.font.body, fontSize: '13px', color: p.text, align: 'center', lineSpacing: 3,
      wordWrap: { width }, backgroundColor: 'rgba(7, 9, 15, 0.78)',
      padding: { left: 14, right: 14, top: 10, bottom: 10 },
    }).setOrigin(0.5, 0).setAlpha(0).setDepth(DEPTH.overlay);
    this.roomLayer?.add([heading, provenance, body]);
    // Long enough to actually read three sentences; still leaves the room playable underneath.
    const hold = 5000 + Math.min(7000, text.length * 28);
    this.tweens.add({
      targets: [heading, provenance, body], alpha: 1, duration: tokens.motion.baseMs, hold, yoyo: true,
      onComplete: () => { heading.destroy(); provenance.destroy(); body.destroy(); },
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
    const boss = snapshot.enemies.find((enemy) => enemy.enemyId === 'guardian' && enemy.hp > 0);
    if (boss && this.room) {
      const width = Math.min(340, this.room.width * TILE_SIZE - 48);
      const x = (this.room.width * TILE_SIZE - width) / 2;
      const y = this.room.height * TILE_SIZE + 9;
      bars.fillStyle(0x000000, 0.8).fillRect(x, y, width, 7);
      bars.fillStyle(hexToInt(tokens.color.danger), 0.95).fillRect(x, y, width * boss.hp / boss.maxHp, 7);
      for (const fraction of [1 / 3, 2 / 3]) {
        bars.lineStyle(2, 0x080b15, 1).lineBetween(x + width * fraction, y, x + width * fraction, y + 7);
      }
      if (!this.bossLabel) {
        this.bossLabel = this.text(this.room.width * TILE_SIZE / 2, y + 16, '', {
          fontFamily: tokens.font.mono, fontSize: '10px', color: tokens.color.danger,
        }).setOrigin(0.5).setDepth(DEPTH.overlay);
        this.roomLayer?.add(this.bossLabel);
      }
      this.bossLabel.setVisible(true).setText(`${guardianTitle(boss)}${(boss.recoveryMs ?? 0) > 0 ? ' · EXPOSED' : ''}`);
    } else this.bossLabel?.setVisible(false);
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

  /** Windup telegraph: danger zone brightens and a ring fills as the strike approaches. */
  private drawTelegraph(g: Phaser.GameObjects.Graphics, enemy: EnemyState): void {
    const warning = enemy.telegraph;
    if (!warning) return;
    const total = enemy.bossPhase === 3 ? 900 : ENEMY_COMBAT[enemy.enemyId].windup;
    const progress = total > 0 ? 1 - Math.min(1, warning.remainingMs / total) : 1;
    const color = fx.enemyAccent(enemy.enemyId);
    const hot = hexToInt(tokens.canvas.telegraph);
    const alpha = 0.12 + progress * 0.25;
    if (warning.kind === 'burst' || warning.kind === 'ring' || warning.kind === 'spiral') {
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
    const label = this
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
    if (enemy.enemyId === 'guardian' && enemy.hp > 0) {
      for (let i = 0; i < (enemy.bossPhase ?? 1); i++) {
        view.facing.lineStyle(1, hexToInt(tokens.color.danger), 0.45)
          .beginPath().arc(0, 0, radius + 6 + i * 5, this.time.now / 700 + i * 2, this.time.now / 700 + i * 2 + 1.5, false).strokePath();
      }
      if ((enemy.recoveryMs ?? 0) > 0) view.facing.lineStyle(3, hexToInt(tokens.color.success), 0.85).strokeCircle(0, 0, radius + 3);
    }
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

  /** The generated world's title and tagline, set into the arrival room's floor below the spawn. */
  private drawWorldStencil(
    layer: Phaser.GameObjects.Layer,
    room: RoomSpec,
    world: { title: string; tagline: string },
    palette: ArtRecipe['palette'],
  ): void {
    let spawn = { col: Math.floor(room.width / 2), row: Math.floor(room.height / 2) };
    room.tiles.forEach((line, row) => {
      const col = line.indexOf('P');
      if (col >= 0) spawn = { col, row };
    });
    // Prefer the open floor below the spawn; fall back to above it when the spawn hugs the south wall.
    const below = room.tiles[spawn.row + 2]?.[spawn.col] === '.' && room.tiles[spawn.row + 3]?.[spawn.col] === '.';
    const roomW = room.width * TILE_SIZE;
    const title = world.title.toUpperCase();
    const fontSize = title.length > 22 ? 11 : title.length > 16 ? 13 : 15;
    const letterSpacing = title.length > 22 ? 2 : 3;
    // Estimate the title width so the plate fits it and the whole stencil stays inside the room.
    const estimated = title.length * (fontSize * 0.68 + letterSpacing);
    const halfW = Math.min(roomW / 2 - TILE_SIZE, Math.max(150, estimated / 2 + 22));
    const cx = Math.min(Math.max(spawn.col * TILE_SIZE + TILE_SIZE / 2, halfW + TILE_SIZE / 2), roomW - halfW - TILE_SIZE / 2);
    const cy = below ? (spawn.row + 2.6) * TILE_SIZE : (spawn.row - 2.2) * TILE_SIZE;
    const colors = stencilColors(palette);
    const plate = this.add.graphics().setDepth(DEPTH.floorDecal + 2);
    plate.fillStyle(hexToInt(palette.background), 0.22).fillRoundedRect(cx - halfW, cy - 24, halfW * 2, 46, 6);
    plate.lineStyle(1, hexToInt(colors.glow), 0.35).strokeRoundedRect(cx - halfW, cy - 24, halfW * 2, 46, 6);
    plate.lineStyle(1, hexToInt(colors.glow), 0.5).lineBetween(cx - halfW + 20, cy - 2, cx + halfW - 20, cy - 2);
    layer.add(plate);
    layer.add(this.text(cx, cy - 12, title, {
      fontFamily: tokens.font.display, fontSize: `${fontSize}px`, color: colors.glow, letterSpacing,
    }).setOrigin(0.5).setAlpha(0.8).setDepth(DEPTH.floorDecal + 3));
    layer.add(this.text(cx, cy + 9, world.tagline, {
      fontFamily: tokens.font.body, fontSize: '9px', color: palette.text, align: 'center', wordWrap: { width: halfW * 2 - 24 },
    }).setOrigin(0.5).setAlpha(0.7).setDepth(DEPTH.floorDecal + 3));
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
          const rawKind = tele?.kind ?? (enemyId === 'sentinel' ? 'beam' : enemyId === 'lurker' ? 'charge' : enemyId === 'guardian' ? 'burst' : 'melee');
          const kind: 'melee' | 'beam' | 'charge' | 'burst' =
            rawKind === 'melee' || rawKind === 'beam' || rawKind === 'charge' || rawKind === 'burst' ? rawKind : rawKind === 'ring' || rawKind === 'spiral' ? 'burst' : 'beam';
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
        case 'lore_discovered': {
          this.revealLore(event.title, event.source, event.text, event.x, event.y);
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
    if (this.doorsView) {
      this.doorSeal = stepSeal(this.doorSeal, this.doorViews.some((door) => door.state === 'sealed') ? 1 : 0, delta);
      this.doorsView.clear();
      drawDoorStates(this.doorsView, this.doorViews, this.art.palette, this.doorSeal, t, this.room.kind === 'exit');
    }
    if (this.kindView) {
      this.kindView.clear();
      drawRoomKindDynamic(this.kindView, this.room, this.art.palette, this.kindState, t);
    }
    for (const exit of this.doorsView ? [] : this.room.exits) {
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
    if (this.motesGfx) drawMotes(this.motesGfx, this.motes, t, this.room.width * TILE_SIZE, this.room.height * TILE_SIZE, this.art.palette, this.moteStyle);
    if (this.loreView && this.loreMarkers.length > 0) {
      this.loreView.clear();
      for (const marker of this.loreMarkers) {
        const lp = 0.5 + 0.5 * Math.sin(t * 1.6 + marker.x * 0.01);
        this.loreView.fillStyle(accent, 0.07 + 0.05 * lp).fillCircle(marker.x, marker.y, 18 + lp * 3);
        this.loreView.lineStyle(1.5, accent, 0.55 + 0.3 * lp).strokeCircle(marker.x, marker.y, 7 + lp * 2);
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
