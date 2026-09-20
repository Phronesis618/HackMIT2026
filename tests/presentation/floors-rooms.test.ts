/** Room-kind dressing state, feature prompts and per-biome art (agent F3). */
import { describe, expect, it } from 'vitest';
import { artForRoom, registerBiomes } from '../../src/client/render/biomeArt';
import { featurePrompt, roomKindState } from '../../src/client/render/roomKinds';
import { luminance, solidColors } from '../../src/client/render/color';
import { floorsFixture } from './floorsFixture';

const { world, runtime, biomeId, runState } = floorsFixture('rooms');
const plan = runtime.plan(biomeId);
const roomOfKind = (kind: string) => {
  for (const tier of world.floors!.route.tiers) for (const id of tier) {
    const found = runtime.plan(id).rooms.find((room) => room.kind === kind);
    if (found) return runtime.getRoom({ biomeId: id, roomId: found.id });
  }
  throw new Error(`no ${kind} room in this world`);
};

describe('room kind state', () => {
  it('keeps the biome exit locked until the room is clear, then offers the choice, then goes quiet while it is open', () => {
    const exit = runtime.getRoom(runtime.exitRef(biomeId));
    expect(exit.feature).toBe('biome_exit');
    const locked = roomKindState(exit, { roomCleared: false, floor: runState([plan.entranceId, exit.roomId!]) });
    expect(locked.roomCleared).toBe(false);
    expect(featurePrompt(exit, locked)).toBe('GATE LOCKED · CLEAR THE ROOM');
    const open = roomKindState(exit, { roomCleared: true, floor: runState([exit.roomId!]) });
    expect(featurePrompt(exit, open)).toBe('HOLD F · CHOOSE THE WAY ON');
    const choosing = roomKindState(exit, { roomCleared: true, floor: runState([exit.roomId!], { biomeChoice: { fromBiomeId: biomeId, options: ['x'], votes: {}, hostPlayerId: null, chosenBiomeId: null } }) });
    expect(choosing.choiceOpen).toBe(true);
    expect(featurePrompt(exit, choosing)).toBeNull();
  });

  it('marks a rest site or cache as used once the sim has marked that room cleared', () => {
    for (const kind of ['rest', 'treasure']) {
      const room = roomOfKind(kind);
      const fresh = runState([room.roomId!]);
      fresh.map = fresh.map.map((entry) => ({ ...entry, cleared: false }));
      expect(roomKindState(room, { roomCleared: true, floor: fresh }).featureUsed).toBe(false);
      const used = { ...fresh, map: fresh.map.map((entry) => (entry.roomId === room.roomId ? { ...entry, cleared: true } : entry)) };
      expect(roomKindState(room, { roomCleared: true, floor: used }).featureUsed).toBe(true);
      expect(featurePrompt(room, roomKindState(room, { floor: fresh }))).not.toEqual(featurePrompt(room, roomKindState(room, { floor: used })));
    }
  });

  it('has nothing to say in plain combat rooms and legacy rooms', () => {
    expect(featurePrompt(roomOfKind('combat'), { roomCleared: false, featureUsed: false, choiceOpen: false })).toBeNull();
    expect(featurePrompt({ feature: undefined }, { roomCleared: true, featureUsed: false, choiceOpen: false })).toBeNull();
  });
});

describe('per-biome art', () => {
  it('leaves legacy rooms and unregistered biomes untouched', () => {
    registerBiomes([]);
    expect(artForRoom({ biomeId: undefined }, world.art)).toBe(world.art);
    expect(artForRoom({ biomeId: 'biome-3' }, world.art)).toBe(world.art);
  });

  it('gives each biome its own motifs, keeps the opener on the world palette, and keeps solids readable on every turned palette', () => {
    const briefs = world.floors!.briefs;
    registerBiomes(briefs);
    const opener = artForRoom({ biomeId: briefs[0]!.id }, world.art);
    expect(opener.palette).toEqual(world.art.palette);
    for (const brief of briefs) {
      const art = artForRoom({ biomeId: brief.id }, world.art);
      expect(art.motifIds).toEqual(brief.motifIds);
      expect(art.palette.hazard).toBe(world.art.palette.hazard);
      const solid = solidColors(art.palette);
      const floor = Math.max(luminance(art.palette.floor), luminance(art.palette.floorAlt));
      expect(luminance(solid.cap) - floor).toBeGreaterThan(0.12);
      expect(luminance(solid.face)).toBeLessThan(luminance(solid.cap) - 0.1);
    }
    registerBiomes([]);
  });
});
