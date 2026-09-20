import { describe, expect, it } from 'vitest';
import { selectDoorViews, stepSeal, ROOM_KIND_COLOR } from '../../src/client/render/doors';
import { luminance, solidColors } from '../../src/client/render/color';
import { floorsFixture } from './floorsFixture';

const { world, runtime, entrance, biomeId, runState } = floorsFixture('doors');
const floorState = (visited: string[], doorsLocked: boolean) => runState(visited, { doorsLocked });

describe('floors door state selection', () => {
  it('gives every exit one view; without floor state doors are open and lead somewhere new', () => {
    const views = selectDoorViews(entrance, null);
    expect(views).toHaveLength(entrance.exits.length);
    for (const view of views) expect(view).toMatchObject({ state: 'open', destination: 'unvisited', kind: null });
  });

  it('seals every door while the sim reports doorsLocked', () => {
    expect(selectDoorViews(entrance, floorState(['r00'], true)).every((view) => view.state === 'sealed')).toBe(true);
    expect(selectDoorViews(entrance, floorState(['r00'], false)).every((view) => view.state === 'open')).toBe(true);
  });

  it('marks a door as visited only when the room behind it has been stood in', () => {
    const next = entrance.exits[0]!.toRoomId!;
    const room = runtime.getRoom({ biomeId, roomId: next });
    const back = selectDoorViews(room, floorState(['r00', next], false));
    expect(back.find((view) => view.toRoomId === 'r00')!.destination).toBe('visited');
    for (const view of back.filter((v) => v.toRoomId !== 'r00')) expect(view.destination).toBe('unvisited');
  });

  it('passes on a revealed room kind so the frame can take its colour', () => {
    const floor = floorState(['r00'], false);
    const target = entrance.exits[0]!.toRoomId!;
    floor.map = floor.map.map((entry) => (entry.roomId === target ? { ...entry, kind: 'treasure' } : entry));
    expect(selectDoorViews(entrance, floor).find((view) => view.toRoomId === target)!.kind).toBe('treasure');
    expect(ROOM_KIND_COLOR.treasure).not.toBeNull();
  });

  it('eases the shutter both ways and never overshoots', () => {
    expect(stepSeal(0, 1, 110)).toBeCloseTo(0.5);
    expect(stepSeal(0.9, 1, 500)).toBe(1);
    expect(stepSeal(0.2, 0, 500)).toBe(0);
  });
});

describe('solid tile language', () => {
  const palettes = [
    world.art.palette,
    { ...world.art.palette, floor: '#d8d2c0', floorAlt: '#cfc8b4', wall: '#3a3a44', text: '#ffffff' },
    { ...world.art.palette, floor: '#101018', floorAlt: '#14141e', wall: '#0c0c12', text: '#e8e8f0' },
    { ...world.art.palette, floor: '#3d5a3a', floorAlt: '#46643f', wall: '#2b3a2a', text: '#f0fff0' },
  ];
  it('keeps the wall top clearly lighter than, and the front face clearly darker than, any floor', () => {
    for (const palette of palettes) {
      const solid = solidColors(palette);
      const floor = Math.max(luminance(palette.floor), luminance(palette.floorAlt));
      if (floor < 0.7) expect(luminance(solid.cap)).toBeGreaterThan(floor + 0.1);
      expect(luminance(solid.face)).toBeLessThan(luminance(solid.cap) - 0.1);
      expect(luminance(solid.outline)).toBeLessThan(0.08);
    }
  });
});
