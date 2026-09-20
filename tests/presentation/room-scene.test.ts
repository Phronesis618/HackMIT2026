import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomScene } from '../../src/client/render/RoomScene';
import { RoomSpecSchema, WorldFixtureSchema, type GameSnapshot, type ReceiptLine } from '../../src/shared/contracts';
import { ATTACK_ARC_RAD, ATTACK_RANGE, DEPTH, tileToWorld } from '../../src/shared/conventions';
import { sampleEvents, sampleSnapshot } from '../../src/shared/samples';
import { CLASS_THEME } from '../../src/shared/registry';
import { hexToInt } from '../../src/shared/tokens';
import * as fx from '../../src/client/render/fx';
import { DASH_TRAIL_MS, DASH_TRAIL_RADIUS } from '../../src/sim/effects';
import { headquartersArt, headquartersRoom } from '../../src/sim/headquarters';
import { floorsFixture } from './floorsFixture';
import { tokens } from '../../src/shared/tokens';
import fixtureData from '../../fixtures/worlds/vantage-spire.json';

const stage = vi.hoisted(() => {
  class Display {
    x = 0;
    y = 0;
    depth = 0;
    text = '';
    visible = true;
    children: Display[] = [];
    add = vi.fn((children: Display | Display[]) => {
      this.children.push(...(Array.isArray(children) ? children : [children]));
      return this;
    });
    destroy = vi.fn((recursive = false) => {
      if (recursive) this.children.forEach((child) => child.destroy(true));
    });
    setPosition = vi.fn((x: number, y: number) => { this.x = x; this.y = y; return this; });
    setDepth = vi.fn((depth: number) => { this.depth = depth; return this; });
    setText = vi.fn((text: string) => { this.text = text; return this; });
    setVisible = vi.fn((visible: boolean) => { this.visible = visible; return this; });
    setOrigin = vi.fn(() => this);
    setAlpha = vi.fn(() => this);
    setMask = vi.fn(() => this);
    createGeometryMask = vi.fn(() => ({}));
    setRotation = vi.fn(() => this);
    setScale = vi.fn(() => this);
    fillStyle = vi.fn(() => this);
    lineStyle = vi.fn(() => this);
    fillRect = vi.fn(() => this);
    strokeRect = vi.fn(() => this);
    fillCircle = vi.fn(() => this);
    fillEllipse = vi.fn(() => this);
    strokeEllipse = vi.fn(() => this);
    fillTriangle = vi.fn(() => this);
    fillRoundedRect = vi.fn(() => this);
    strokeCircle = vi.fn(() => this);
    strokeTriangle = vi.fn(() => this);
    strokeRoundedRect = vi.fn(() => this);
    lineBetween = vi.fn(() => this);
    beginPath = vi.fn(() => this);
    arc = vi.fn(() => this);
    moveTo = vi.fn(() => this);
    lineTo = vi.fn(() => this);
    closePath = vi.fn(() => this);
    strokePath = vi.fn(() => this);
    fillPath = vi.fn(() => this);
    slice = vi.fn(() => this);
    clear = vi.fn(() => this);
    setPadding = vi.fn(() => this);
  }
  const nodes: Display[] = [];
  const node = () => { const item = new Display(); nodes.push(item); return item; };
  const camera = {
    width: 960, height: 600,
    setZoom: vi.fn(), centerOn: vi.fn(), fadeIn: vi.fn(), flash: vi.fn(), shake: vi.fn(),
  };
  const tweens = {
    add: vi.fn((config: { targets: Display; onComplete: () => void }) => config),
    killAll: vi.fn(),
  };
  return { nodes, node, camera, tweens };
});

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      add = {
        graphics: stage.node, layer: stage.node, container: stage.node,
        text: (x: number, y: number, text: string) => stage.node().setPosition(x, y).setText(text),
      };
      make = { graphics: stage.node };
      cameras = { main: stage.camera };
      tweens = stage.tweens;
      time = { now: 0 };
    },
  },
}));
vi.mock('../../src/client/render/drawing', () => ({
  drawMotif: vi.fn(), drawProp: vi.fn(), drawSanctuary: vi.fn(), drawSkyline: vi.fn(), drawVignette: vi.fn(),
}));
vi.mock('../../src/client/render/characters', () => ({ drawOperative: vi.fn(), drawHostile: vi.fn() }));
vi.mock('../../src/client/render/environment', () => ({
  drawBackdrop: vi.fn(), drawFloor: vi.fn(), drawWalls: vi.fn(), drawLightPools: vi.fn(), drawMotes: vi.fn(), makeMotes: vi.fn(() => []), propHasLight: vi.fn(),
}));
vi.mock('../../src/client/render/fx', () => ({
  drawSlash: vi.fn(), drawDashTrail: vi.fn(), drawImpact: vi.fn(), drawDefeat: vi.fn(), drawEnemyStrike: vi.fn(), drawShockwave: vi.fn(),
  drawBladeStorm: vi.fn(), drawBeam: vi.fn(), drawSingularity: vi.fn(), drawFlare: vi.fn(), drawRally: vi.fn(), drawTether: vi.fn(),
  drawShroud: vi.fn(), drawRewind: vi.fn(), drawBlink: vi.fn(), drawRevive: vi.fn(), drawTelegraphWarning: vi.fn(), enemyAccent: vi.fn(() => 0xff5c7a),
  drawBurnTrail: vi.fn(),
}));

const fixture = WorldFixtureSchema.parse(fixtureData);
const firstRoom = fixture.rooms[0]!;
const localId = sampleSnapshot.players[0]!.id;
const effects = () => stage.nodes.filter((n) => n.depth === DEPTH.effects);

function setup() {
  const scene = new RoomScene();
  scene.buildRoom(firstRoom, fixture.art, { headquarters: false });
  scene.renderSnapshot(sampleSnapshot, localId);
  return scene;
}

describe('room presentation against authoritative contracts', () => {
  beforeEach(() => {
    stage.nodes.length = 0;
    vi.clearAllMocks();
  });

  it('places dash and attack effects at event positions, deduplicates delivery and releases completed effects', () => {
    const scene = setup();
    const dash = sampleEvents.find((e) => e.type === 'player_dashed')!;
    const attack = sampleEvents.find((e) => e.type === 'player_attacked')!;
    scene.playEvents([dash, attack, dash, attack]);
    expect(effects()).toHaveLength(2);
    expect(effects()[0]!.setPosition).toHaveBeenCalledWith(dash.x, dash.y);
    expect(effects()[1]!.arc).toHaveBeenCalledWith(
      0, 0, ATTACK_RANGE, attack.facing - ATTACK_ARC_RAD / 2, attack.facing + ATTACK_ARC_RAD / 2, false,
    );
    // 1 for the room-description fade card (buildRoom) + 2 for the dash/attack effects.
    expect(stage.tweens.add).toHaveBeenCalledTimes(3);
    for (const [config] of stage.tweens.add.mock.calls) {
      config.onComplete();
      expect(config.targets.destroy).toHaveBeenCalledOnce();
    }
  });

  it('draws a canister blast where terrain_detonated says it happened, and survives a kill nobody made', () => {
    const scene = setup();
    scene.renderSnapshot(sampleSnapshot, localId);
    scene.playEvents([
      { id: '9:0', type: 'terrain_detonated', tick: 9, timeMs: 150, x: 208, y: 144, radius: 76, hitPlayerIds: [], hitEnemyIds: [] },
      { id: '9:1', type: 'enemy_damaged', tick: 9, timeMs: 150, enemyId: sampleSnapshot.enemies[0]!.id, byPlayerId: null, amount: 48, remainingHp: 0 },
    ]);
    expect(effects()[0]!.setPosition).toHaveBeenCalledWith(208, 144);
    for (const [config] of stage.tweens.add.mock.calls) config.onComplete();
  });

  /**
   * A24. The `dash_echo` trail burns enemies in the simulation; before this it had no picture at
   * all. It is drawn from `snapshot.trails` — the same points the sim charges for — in the
   * operative's own colour, and nothing is drawn when the field is absent.
   */
  it('draws the dash_echo burn trail from the snapshot, in the operative’s colour', () => {
    const scene = setup();
    const mine = { playerId: localId, x: 100, y: 120, remainingMs: 1500 };
    const theirs = { playerId: sampleSnapshot.players[1]!.id, x: 160, y: 120, remainingMs: 400 };
    scene.renderSnapshot({ ...sampleSnapshot, trails: [mine, theirs] }, localId);
    const drawn = vi.mocked(fx.drawBurnTrail).mock.calls.at(-1)!;
    expect(drawn[1]).toHaveLength(2);
    expect(drawn[1][0]).toMatchObject({ x: 100, y: 120, remainingMs: 1500 });
    expect(drawn[2]).toBe(DASH_TRAIL_MS);
    expect(drawn[3]).toBe(DASH_TRAIL_RADIUS);
    // Two operatives, two class colours: the trail says whose it is.
    expect(drawn[1][0]!.color).toBe(hexToInt(CLASS_THEME[sampleSnapshot.players[0]!.classId].primary));
    expect(drawn[1][1]!.color).toBe(hexToInt(CLASS_THEME[sampleSnapshot.players[1]!.classId].primary));
    // No trail in the snapshot is still one call, so the last frame's points are cleared away.
    vi.mocked(fx.drawBurnTrail).mockClear();
    scene.renderSnapshot(sampleSnapshot, localId);
    expect(vi.mocked(fx.drawBurnTrail).mock.calls.at(-1)![1]).toEqual([]);
  });

  it('retains the last enemy location when the death snapshot removes it before events arrive', () => {
    const scene = setup();
    scene.renderSnapshot({ ...sampleSnapshot, enemies: [] }, localId);
    scene.playEvents(sampleEvents.filter((e) => e.type === 'enemy_damaged' || e.type === 'enemy_defeated'));
    expect(effects()).toHaveLength(2);
    for (const effect of effects()) {
      expect(effect.setPosition).toHaveBeenCalledWith(sampleSnapshot.enemies[0]!.x, sampleSnapshot.enemies[0]!.y);
    }
  });

  it('shakes only for local damage and plays down feedback once at the actual player position', () => {
    const scene = setup();
    const hit = sampleEvents.find((e) => e.type === 'player_damaged')!;
    const remote = sampleSnapshot.players[1]!;
    scene.playEvents([{ ...hit, id: 'test-remote-hit', playerId: remote.id }]);
    expect(stage.camera.shake).not.toHaveBeenCalled();
    scene.playEvents([hit, hit, { id: 'test-down', tick: 700, timeMs: 0, type: 'player_downed', playerId: localId }]);
    expect(stage.camera.shake).toHaveBeenCalledOnce();
    expect(effects()).toHaveLength(3);
    expect(effects()[2]!.setPosition).toHaveBeenCalledWith(sampleSnapshot.players[0]!.x, sampleSnapshot.players[0]!.y);
  });

  it('clears room effects, remembered enemy locations and event IDs on room changes', () => {
    const scene = setup();
    const attack = sampleEvents.find((e) => e.type === 'player_attacked')!;
    scene.playEvents([attack]);
    const previousEffect = effects()[0]!;
    scene.buildRoom(fixture.rooms[1]!, fixture.art, { headquarters: false });
    expect(stage.tweens.killAll).toHaveBeenCalledTimes(2);
    expect(previousEffect.destroy).toHaveBeenCalled();
    scene.playEvents(sampleEvents.filter((e) => e.type === 'enemy_damaged' || e.type === 'enemy_defeated'));
    expect(effects()).toHaveLength(1);
    scene.playEvents([attack]);
    expect(effects()).toHaveLength(2);
  });

  it('ignores snapshots and room-entry reveals for another room', () => {
    const scene = setup();
    const before = stage.nodes.length;
    scene.renderSnapshot({ ...sampleSnapshot, roomId: 'test-stale-room', players: [] }, localId);
    expect(stage.nodes).toHaveLength(before);
    expect(scene.getLatestSnapshot()).toBe(sampleSnapshot);
    const entry = sampleEvents.find((e) => e.type === 'room_entered')!;
    scene.playEvents([{ ...entry, id: 'test-stale-entry', roomId: 'test-stale-room' }]);
    expect(stage.camera.flash).not.toHaveBeenCalled();
    scene.playEvents([entry]);
    expect(stage.camera.flash).toHaveBeenCalledOnce();
  });

  it('shows only authoritative Anchor progress, clears missing anchors and rejects other-world completion effects', () => {
    const scene = new RoomScene();
    const room = fixture.rooms[2]!;
    scene.buildRoom(room, fixture.art, { headquarters: false });
    const snapshot: GameSnapshot = {
      ...sampleSnapshot, roomId: room.id, roomIndex: room.index, enemies: [],
      anchor: { x: 600, y: 240, state: 'planting', progress: 0.5 },
    };
    scene.renderSnapshot(snapshot, localId);
    const label = stage.nodes.find((n) => n.text === 'PLANTING · 50%')!;
    expect(label).toBeDefined();
    expect(stage.nodes.some((n) => n.arc.mock.calls.length > 0 && n.depth === DEPTH.entities)).toBe(true);
    const ring = stage.nodes.find((n) => n.depth === DEPTH.entities && n.arc.mock.calls.length > 0)!;
    expect(ring.arc).toHaveBeenCalledWith(600, 240, 28, -Math.PI / 2, Math.PI / 2, false);
    scene.playEvents([{
      id: 'test-foreign-anchor', tick: 900, timeMs: 0, type: 'anchor_planted',
      worldId: 'test-other-world', roomIndex: 2, playerIds: [localId],
    }]);
    expect(effects()).toHaveLength(0);
    scene.renderSnapshot({ ...snapshot, anchor: { ...snapshot.anchor!, state: 'planted', progress: 1 } }, localId);
    expect(label.text).toBe('ANCHOR PLANTED');
    scene.playEvents([{
      id: 'test-anchor', tick: 901, timeMs: 0, type: 'anchor_planted',
      worldId: sampleSnapshot.worldId!, roomIndex: 2, playerIds: [localId],
    }]);
    expect(effects()).toHaveLength(1);
    scene.renderSnapshot({ ...snapshot, anchor: { ...snapshot.anchor!, state: 'dormant', progress: 0 } }, localId);
    expect(label.text).toBe('ANCHOR DORMANT');
    scene.renderSnapshot({ ...snapshot, anchor: null }, localId);
    expect(label.visible).toBe(false);
  });

  it('no longer stencils the controls into the headquarters floor (they live in the menu)', () => {
    const scene = new RoomScene();
    scene.buildRoom(headquartersRoom, headquartersArt, { headquarters: true });
    const labels = stage.nodes.map((n) => n.text);
    for (const key of ['W', 'A', 'S', 'D', 'SHIFT', 'MOVE', 'AIM', 'ATTACK']) expect(labels).not.toContain(key);
  });

  it('draws floors doorways instead of legacy exit pads, and seals them while the sim locks the doors', () => {
    const { world, runtime, entrance: room } = floorsFixture('door-test');
    const scene = new RoomScene();
    scene.buildRoom(room, world.art, { headquarters: false });
    const doors = stage.nodes.find((n) => n.depth === DEPTH.propsBehind + 0.6)!;
    expect(doors).toBeDefined();
    const floor = {
      biomeId: room.biomeId!, roomId: room.roomId!, tier: 0, path: [room.biomeId!],
      map: runtime.mapRooms(room.biomeId!, [room.roomId!]), doorsLocked: true, biomeChoice: null,
    };
    scene.renderSnapshot({ ...sampleSnapshot, roomId: room.id, floor }, localId);
    const danger = parseInt(tokens.color.danger.slice(1), 16);
    for (let i = 0; i < 20; i++) scene.update(0, 16);
    expect(doors.fillStyle).toHaveBeenCalledWith(danger, 0.95);
    // unlocked: after the shutter has eased open the red bars are gone
    scene.renderSnapshot({ ...sampleSnapshot, roomId: room.id, floor: { ...floor, doorsLocked: false } }, localId);
    for (let i = 0; i < 20; i++) scene.update(0, 16);
    doors.fillStyle.mockClear();
    scene.update(0, 16);
    expect(doors.fillStyle).not.toHaveBeenCalledWith(danger, 0.95);

    // legacy rooms keep their exit chevrons and get no doorway layer
    stage.nodes.length = 0;
    setup();
    expect(stage.nodes.find((n) => n.depth === DEPTH.propsBehind + 0.6)).toBeUndefined();
  });

  it('leaves crew Integrity and the room title to the React HUD: no in-canvas strip, no title text', () => {
    setup();
    const bars = stage.nodes.find((n) => n.depth === DEPTH.overlay - 1 && n.fillRoundedRect.mock.calls.length > 0);
    expect(bars).toBeUndefined();
    const labels = stage.nodes.map((n) => n.text);
    expect(labels).not.toContain(`${firstRoom.index + 1} · ${firstRoom.name.toUpperCase()}`);
    expect(labels).not.toContain(sampleSnapshot.players[0]!.displayName + ' · down');
  });

  // A11: for 30 s after a disconnect the body stands in the room. Say so on the nameplate.
  it('marks a seat whose client has gone away, and leaves every other nameplate alone', () => {
    const scene = setup();
    const [me, ally] = sampleSnapshot.players;
    expect(stage.nodes.map((n) => n.text)).toContain(ally!.displayName);
    scene.renderSnapshot({ ...sampleSnapshot, players: [me!, { ...ally!, connected: false }] }, localId);
    const labels = stage.nodes.map((n) => n.text);
    expect(labels).toContain(`${ally!.displayName} · offline`);
    expect(labels).toContain(me!.displayName);
    expect(labels).not.toContain(`${me!.displayName} · offline`);
    scene.renderSnapshot(sampleSnapshot, localId);
    expect(stage.nodes.map((n) => n.text)).not.toContain(`${ally!.displayName} · offline`);
  });

  it('draws relics and remains from the snapshot, prompts to read nearby relics and plays the reveal on discovery', () => {
    const scene = setup();
    const me = sampleSnapshot.players[0]!;
    const nodesView = stage.nodes.find((n) => n.depth === DEPTH.entities - 1)!;
    const hint = stage.nodes.find((n) => n.text === 'HOLD F · READ')!;
    expect(hint.visible).toBe(false);
    scene.renderSnapshot({
      ...sampleSnapshot,
      loreNodes: [
        { id: 'relic', kind: 'relic', x: me.x + 20, y: me.y, fragmentIndex: 0, state: 'sealed', progress: 0 },
        { id: 'remains-x', kind: 'remains', x: 300, y: 200, fragmentIndex: 4, state: 'sealed', progress: 0 },
      ],
    }, localId);
    expect(nodesView.fillRoundedRect).toHaveBeenCalled();
    expect(nodesView.closePath).toHaveBeenCalled();
    expect(hint.visible).toBe(true);
    scene.renderSnapshot({
      ...sampleSnapshot,
      loreNodes: [{ id: 'relic', kind: 'relic', x: me.x + 20, y: me.y, fragmentIndex: 0, state: 'reading', progress: 0.5 }],
    }, localId);
    expect(hint.visible).toBe(false);
    expect(nodesView.arc).toHaveBeenCalled();

    scene.playEvents([{
      id: 'test-lore', tick: 800, timeMs: 0, type: 'lore_discovered', playerId: localId, fragmentIndex: 0,
      kind: 'relic', title: 'Departures board', source: 'a split-flap board', text: 'Every line reads DELAYED.', x: me.x + 20, y: me.y,
    }]);
    expect(effects()).toHaveLength(1);
    expect(stage.nodes.some((n) => n.text === 'DEPARTURES BOARD')).toBe(true);
    expect(stage.nodes.some((n) => n.text === 'Every line reads DELAYED.')).toBe(true);
  });

  it('reveals a contributed idea in-world only once a player walks up to what it shaped', () => {
    const marker = tileToWorld(5, 4);
    const room = RoomSpecSchema.parse({
      ...firstRoom,
      attributions: [{
        contributionId: 'sample-contrib-1', kind: 'prop', featureDescription: 'a crate',
        target: { roomIndex: firstRoom.index, x: 5, y: 4 },
      }],
    });
    const loreLines: ReceiptLine[] = [{
      contributionId: 'sample-contrib-1', playerId: 'sample-player-local', playerName: 'Ari',
      text: 'a crate stuffed with old maps', used: true, featureDescription: 'a crate',
    }];
    const scene = new RoomScene();
    scene.buildRoom(room, fixture.art, { headquarters: false }, loreLines);
    const caption = stage.nodes.find((n) => n.depth === DEPTH.overlay && n.visible === false)!;
    expect(caption).toBeDefined();

    const near: GameSnapshot = { ...sampleSnapshot, roomId: room.id, players: [{ ...sampleSnapshot.players[0]!, x: marker.x, y: marker.y }] };
    scene.renderSnapshot(near, localId);
    expect(caption.visible).toBe(true);
    expect(caption.text).toContain('a crate stuffed with old maps');
    expect(caption.text).toContain('Ari');

    const far: GameSnapshot = { ...sampleSnapshot, roomId: room.id, players: [{ ...sampleSnapshot.players[0]!, x: marker.x + 500, y: marker.y + 500 }] };
    scene.renderSnapshot(far, localId);
    expect(caption.visible).toBe(false);
  });
});
