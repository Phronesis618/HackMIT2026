import { describe, expect, it } from 'vitest';
import { RoomSpecSchema } from '../../src/shared/contracts';
import { PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../src/shared/conventions';
import { HEADQUARTERS_STATIONS, nearbyHeadquartersStation } from '../../src/shared/headquarters';
import { CLASS_IDS, PROP_INFO } from '../../src/shared/registry';
import { buildSolidGrid, circleHitsSolid, moveCircle } from '../../src/sim/collision';
import { headquartersRoom } from '../../src/sim/headquarters';
import { createSimulation } from '../../src/sim/simulation';

const identity = { id: 'hq-explorer', displayName: 'Explorer', classId: 'bastion' as const };

function routesFromSpawn() {
  const room = headquartersRoom;
  const grid = buildSolidGrid(room);
  const startRow = room.tiles.findIndex((row) => row.includes('P'));
  const startCol = room.tiles[startRow]!.indexOf('P');
  const start = startRow * room.width + startCol;
  const routes = new Map<number, number[]>([[start, [start]]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    const col = cell % room.width;
    const row = Math.floor(cell / room.width);
    const from = tileToWorld(col, row);
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = col + dx!;
      const y = row + dy!;
      if (x < 0 || y < 0 || x >= room.width || y >= room.height) continue;
      const next = y * room.width + x;
      if (routes.has(next)) continue;
      const to = tileToWorld(x, y);
      if (circleHitsSolid(grid, to.x, to.y, PLAYER_RADIUS)) continue;
      const moved = moveCircle(grid, from.x, from.y, PLAYER_RADIUS, dx! * TILE_SIZE, dy! * TILE_SIZE);
      if (moved.x !== to.x || moved.y !== to.y) continue;
      routes.set(next, [...routes.get(cell)!, next]);
      queue.push(next);
    }
  }
  return routes;
}

describe('Stillpoint headquarters layout', () => {
  it('is schema-valid, compact and keeps every complete prop footprint off walls, spawn and exit', () => {
    expect(RoomSpecSchema.safeParse(headquartersRoom).success).toBe(true);
    expect(headquartersRoom.width).toBeLessThanOrEqual(48);
    expect(headquartersRoom.height).toBeLessThanOrEqual(32);
    const occupied = new Set<string>();
    for (const prop of headquartersRoom.props) {
      const { footprint } = PROP_INFO[prop.propId];
      for (let dy = 0; dy < footprint.h; dy++) {
        for (let dx = 0; dx < footprint.w; dx++) {
          const key = `${prop.x + dx}:${prop.y + dy}`;
          expect(occupied.has(key), key).toBe(false);
          expect(headquartersRoom.tiles[prop.y + dy]?.[prop.x + dx], key).toBe('.');
          occupied.add(key);
        }
      }
    }
    expect(HEADQUARTERS_STATIONS.filter((station) => station.classId).map((station) => station.classId)).toEqual(CLASS_IDS);
  });

  it.each(HEADQUARTERS_STATIONS)('can physically walk from spawn to activate $id without crossing a prop', (station) => {
    const sim = createSimulation();
    sim.addPlayer(identity);
    const routes = routesFromSpawn();
    const target = [...routes.entries()].find(([cell]) => {
      const position = tileToWorld(cell % headquartersRoom.width, Math.floor(cell / headquartersRoom.width));
      const snapshot = sim.getSnapshot();
      snapshot.players[0] = { ...snapshot.players[0]!, ...position };
      return nearbyHeadquartersStation(snapshot, identity.id)?.id === station.id;
    });
    expect(target, `No reachable interaction point for ${station.id}`).toBeDefined();
    let seq = 0;
    for (const cell of target![1].slice(1)) {
      const point = tileToWorld(cell % headquartersRoom.width, Math.floor(cell / headquartersRoom.width));
      for (let ticks = 0; ticks < 30; ticks++) {
        const player = sim.getSnapshot().players[0]!;
        const dx = point.x - player.x;
        const dy = point.y - player.y;
        if (Math.hypot(dx, dy) < 2) break;
        sim.applyIntent({ playerId: identity.id, seq: seq++, moveX: Math.max(-1, Math.min(1, dx / 3)), moveY: Math.max(-1, Math.min(1, dy / 3)), aimX: point.x, aimY: point.y, attack: false, dash: false, ability: null });
        sim.step();
      }
      const arrived = sim.getSnapshot().players[0]!;
      expect(Math.hypot(arrived.x - point.x, arrived.y - point.y)).toBeLessThan(3);
    }
    expect(nearbyHeadquartersStation(sim.getSnapshot(), identity.id)?.id).toBe(station.id);
  });

  it('preserves a reachable south portal to the first expedition room', () => {
    const exit = headquartersRoom.exits[0]!;
    expect(exit.toRoomIndex).toBe(0);
    expect(exit.direction).toBe('south');
    expect(headquartersRoom.tiles[exit.y]?.[exit.x]).toBe('X');
    expect(routesFromSpawn().has(exit.y * headquartersRoom.width + exit.x)).toBe(true);
  });

  it('only projects the local living operative from a headquarters snapshot', () => {
    const sim = createSimulation();
    sim.addPlayer(identity);
    const snapshot = sim.getSnapshot();
    snapshot.players[0] = { ...snapshot.players[0]!, ...tileToWorld(4, 4) };
    expect(nearbyHeadquartersStation(snapshot, identity.id)?.id).toBe('bastion');
    expect(nearbyHeadquartersStation(snapshot, 'missing')).toBeNull();
    expect(nearbyHeadquartersStation({ ...snapshot, phase: 'training' }, identity.id)).toBeNull();
    expect(nearbyHeadquartersStation({ ...snapshot, roomId: 'other' }, identity.id)).toBeNull();
    snapshot.players[0]!.hp = 0;
    expect(nearbyHeadquartersStation(snapshot, identity.id)).toBeNull();
  });
});
