import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { drawHeadquartersStations } from '../../src/client/render/headquarters';
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
    for (const title of ['01 / ARMORY', '02 / ECHO ARCHIVE', '03 / PROVING CHAMBER', '04 / OBSERVATORY', 'BASTION', 'SHADE', 'BEACON', 'WEAVER', 'DEPARTURE GATE']) {
      expect(labels).toContain(title);
    }
    const player = { ...sampleSnapshot.players[0]!, ...tileToWorld(4, 4) };
    const snapshot = { ...sampleSnapshot, phase: 'headquarters' as const, roomId: headquartersRoom.id, players: [player] };
    const count = nodes.length;
    view.update(snapshot, player.id);
    const prompt = nodes.at(-1)!;
    expect(prompt.text).toBe('F · ATTUNE BASTION');
    expect(prompt.visible).toBe(true);
    for (let n = 0; n < 100; n++) view.update(snapshot, player.id);
    expect(nodes.length).toBe(count);
    expect(add.graphics).toHaveBeenCalledTimes(3);
    expect(prompt.setText).toHaveBeenCalledTimes(2);
    view.update({ ...snapshot, players: [{ ...player, ...tileToWorld(15, 10) }] }, player.id);
    expect(prompt.visible).toBe(false);
    view.update({ ...snapshot, phase: 'training' }, player.id);
    expect(prompt.visible).toBe(false);
  });

  it('does not add headquarters decorations to expedition rooms', () => {
    const { nodes, scene, layer } = setup();
    const view = drawHeadquartersStations(scene, layer, { ...headquartersRoom, id: 'test-expedition' });
    view.update(sampleSnapshot, sampleSnapshot.players[0]!.id);
    expect(nodes).toHaveLength(0);
  });
});
