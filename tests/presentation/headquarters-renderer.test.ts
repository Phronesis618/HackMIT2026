import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { createHubState, createHubStateBus, type HubRelic, type LastRun } from '../../src/client/chronicle/hubState';
import { drawHeadquartersStations, QUARTERMASTER_SPEECH_MS } from '../../src/client/render/headquarters';
import { tileToWorld } from '../../src/shared/conventions';
import { sampleSnapshot } from '../../src/shared/samples';
import { headquartersRoom } from '../../src/sim/headquarters';

class Node {
  visible = true;
  text = '';
  x = 0;
  y = 0;
  setDepth = vi.fn(() => this);
  setOrigin = vi.fn(() => this);
  setVisible = vi.fn((visible: boolean) => { this.visible = visible; return this; });
  setText = vi.fn((text: string) => { this.text = text; return this; });
  setPosition = vi.fn((x: number, y: number) => { this.x = x; this.y = y; return this; });
  fillStyle = vi.fn(() => this);
  lineStyle = vi.fn(() => this);
  fillRect = vi.fn(() => this);
  fillCircle = vi.fn(() => this);
  fillEllipse = vi.fn(() => this);
  fillRoundedRect = vi.fn(() => this);
  strokeRoundedRect = vi.fn(() => this);
  strokeEllipse = vi.fn(() => this);
  strokeCircle = vi.fn(() => this);
  lineBetween = vi.fn(() => this);
  beginPath = vi.fn(() => this);
  moveTo = vi.fn(() => this);
  lineTo = vi.fn(() => this);
  closePath = vi.fn(() => this);
  fillPath = vi.fn(() => this);
  strokePath = vi.fn(() => this);
  fillTriangle = vi.fn(() => this);
  strokeTriangle = vi.fn(() => this);
  clear = vi.fn(() => this);
}

function setup() {
  const nodes: Node[] = [];
  const owned: Node[] = [];
  const make = () => { const node = new Node(); nodes.push(node); return node; };
  const add = {
    graphics: vi.fn(make),
    text: vi.fn((x: number, y: number, text: string) => make().setPosition(x, y).setText(text)),
  };
  const layer = { add: (value: Node | Node[]) => owned.push(...(Array.isArray(value) ? value : [value])) };
  return { nodes, owned, add, scene: { add } as unknown as Phaser.Scene, layer: layer as unknown as Phaser.GameObjects.Layer };
}

describe('headquarters renderer hook', () => {
  it('owns its signage and symbols through the room layer and updates proximity without allocating objects', () => {
    const { nodes, owned, scene, layer, add } = setup();
    const view = drawHeadquartersStations(scene, layer, headquartersRoom, 2);
    expect(owned).toEqual(nodes);
    const labels = nodes.map((node) => node.text);
    for (const title of ['01 / ARMORY', '02 / ECHO ARCHIVE', '03 / PROVING CHAMBER', '04 / OBSERVATORY', 'BASTION', 'SHADE', 'BEACON', 'WEAVER', 'DEPARTURE GATE', 'QUARTERMASTER', 'SERVICE RECORD', 'RELIC SHELF · ANCHORED RUNS ONLY']) {
      expect(labels).toContain(title);
    }
    const player = { ...sampleSnapshot.players[0]!, ...tileToWorld(4, 4) };
    const snapshot = { ...sampleSnapshot, phase: 'headquarters' as const, roomId: headquartersRoom.id, players: [player] };
    const count = nodes.length;
    view.update(snapshot, player.id);
    const prompt = nodes.at(-1)!;
    expect(prompt.text).toBe('F · TAKE THE ARC-BLADE');
    expect(prompt.visible).toBe(true);
    const currentTag = nodes.find((node) => node.text === 'CURRENT')!;
    expect(currentTag.visible).toBe(true);
    expect(currentTag.x).toBe(tileToWorld(4, 3).x);
    for (let n = 0; n < 100; n++) view.update(snapshot, player.id);
    expect(nodes.length).toBe(count);
    expect(add.graphics).toHaveBeenCalledTimes(4);
    expect(prompt.setText).toHaveBeenCalledTimes(2);
    view.update({ ...snapshot, players: [{ ...player, classId: 'weaver' }] }, player.id);
    expect(currentTag.x).toBe(tileToWorld(8, 7).x);
    view.update({ ...snapshot, players: [{ ...player, ...tileToWorld(15, 10) }] }, player.id);
    expect(prompt.visible).toBe(false);
    view.update({ ...snapshot, phase: 'training' }, player.id);
    expect(prompt.visible).toBe(false);
  });

  it('shows the quartermaster cue near the NPC, times it out, and suppresses it once per run', () => {
    const { nodes, scene, layer } = setup();
    const hub = createHubStateBus();
    let clock = 1_000;
    const view = drawHeadquartersStations(scene, layer, headquartersRoom, { hub, now: () => clock });
    const speech = nodes.at(-2)!;
    const prompt = nodes.at(-1)!;
    const player = { ...sampleSnapshot.players[0]!, ...tileToWorld(15, 7) };
    const near = { ...sampleSnapshot, phase: 'headquarters' as const, roomId: headquartersRoom.id, worldId: null, players: [player] };
    const away = { ...near, players: [{ ...player, ...tileToWorld(15, 12) }] };
    view.update(near, player.id);
    expect(speech.visible).toBe(true);
    expect(speech.text).toMatch(/shelf|Rack|anywhere/);
    expect(prompt.text).toBe('F · SPEAK TO THE QUARTERMASTER');
    clock += QUARTERMASTER_SPEECH_MS;
    view.update(near, player.id);
    expect(speech.visible).toBe(false);

    // A recorded collapsed run, downed twice, last hit by a warden: the line names the warden.
    const lastRun: LastRun = {
      worldId: 'w', worldTitle: 'Vantage Spire', outcome: 'collapsed', classId: 'bastion', endedAt: 5, durationMs: 60_000, roomsEntered: 3,
      deepestRoomIndex: 2, roomsCleared: 1, enemiesDefeated: 2, damageDealt: 10, damageTaken: 70, downs: 2, lastDownedByEnemyId: 'warden',
      revivesGiven: 0, revivesReceived: 1, loreRead: 0, abilityUnlocked: null, crew: [{ id: player.id, displayName: 'Jon' }], worldSource: 'fixture', sourceEventIds: ['1:0'],
    };
    hub.set({ ...createHubState(), lastRun, totals: { runs: 1, anchors: 0, worldsVisited: 1, relics: 0 } });
    view.update(away, player.id);
    expect(speech.visible).toBe(false);
    view.update(near, player.id);
    expect(speech.visible).toBe(true);
    expect(speech.text).toMatch(/Warden/);
    // Walk away and back: downed_by was shown for this run, so the outcome cue follows.
    view.update(away, player.id);
    view.update(near, player.id);
    expect(speech.text).toMatch(/Vantage Spire (went down|collapsed)|rooms cleared/);
  });

  it('labels shelved relics from hub state and leaves empty brackets unlabelled', () => {
    const { nodes, scene, layer } = setup();
    const hub = createHubStateBus();
    const relic: HubRelic = {
      id: 'relic-w-1', worldId: 'w', worldTitle: 'Vantage Spire', title: 'Red wrench', source: 'Tarn', text: 'x',
      recoveredBy: [{ id: 'p', displayName: 'Jon' }], recoveredAt: 1, worldSource: 'fixture', sourceEventIds: ['2:0'],
    };
    hub.set({ ...createHubState(), relics: [relic], totals: { runs: 1, anchors: 1, worldsVisited: 1, relics: 1 } });
    const player = { ...sampleSnapshot.players[0]!, ...tileToWorld(15, 10) };
    const view = drawHeadquartersStations(scene, layer, headquartersRoom, { hub, now: () => 0 });
    view.update({ ...sampleSnapshot, phase: 'headquarters', roomId: headquartersRoom.id, players: [player] }, player.id);
    const labels = nodes.filter((node) => node.text === 'RED WRENCH');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.visible).toBe(true);
    expect(labels[0]!.x).toBe(tileToWorld(12, 1).x);
  });

  it('does not add headquarters decorations to expedition rooms', () => {
    const { nodes, scene, layer } = setup();
    const view = drawHeadquartersStations(scene, layer, { ...headquartersRoom, id: 'test-expedition' });
    view.update(sampleSnapshot, sampleSnapshot.players[0]!.id);
    expect(nodes).toHaveLength(0);
  });
});
