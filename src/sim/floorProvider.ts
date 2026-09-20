/**
 * Room provider for floors worlds: the one place the sim AND the client turn a room
 * address `{biomeId, roomId}` into a RoomSpec. It is the shared floor runtime
 * (src/shared/floorgen/runtime.ts): rooms compile lazily, are cached, and the same
 * `world.floors` gives byte-identical rooms on every machine, so snapshots only carry
 * the address. Tests may inject a double through `SimulationOptions.roomProvider`.
 *
 * Owner: Agent F2.
 */
import type { PreparedWorld } from '../shared/contracts';
import { createWorldFloorRuntime, type FloorRuntime } from '../shared/floorgen';

export type RoomProvider = FloorRuntime;

export function createRoomProvider(world: Pick<PreparedWorld, 'floors' | 'recipe'>): RoomProvider | null {
  return world.floors ? createWorldFloorRuntime(world) : null;
}
