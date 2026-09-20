/**
 * Floors run state and rules for the simulation: where the crew is in the biome graph,
 * fog-of-war map, door sealing, room-kind features, rewards and tier scaling.
 * simulation.ts owns the tick; everything here is plain data + pure helpers so the big
 * file only needs a few call sites. Spec: docs/design/FLOORS.md. Owner: Agent F2.
 */
import type { RoomSpec } from '../shared/contracts';
import { ROOM_CLEAR_REWARD, tileToWorld } from '../shared/conventions';
import { DOOR_SIDES, type BiomeChoiceState, type FloorMapRoom, type FloorRunState, type RoomAddress, type RoomKind } from '../shared/floors';
import type { RoomProvider } from './floorProvider';

/** Every floors tuning number lives here. */
export const FLOOR_TUNING = {
  /** Enemy HP and damage grow by this much per biome tier (tier 0 = legacy numbers). */
  tierScalePerTier: 0.18,
  /** A rest site restores this share of max HP to every living operative, once per room. */
  restHealFraction: 0.4,
  /** Touch range (px) of rest sites and treasure caches; F-range of the biome choice site. */
  featureRange: 44,
  eliteRewardMultiplier: 2,
  exitRewardMultiplier: 3,
  treasureRewardMultiplier: 4,
  /** Gatekeepers are phase-1-only Custodians with a share of the real one's HP (before tier scaling). */
  gatekeeperHpShare: 0.4,
} as const;

/** Isaac rule: only rooms that can hold a fight seal their doors. */
const SEALING_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['combat', 'elite', 'exit']);

export interface FloorsRun {
  provider: RoomProvider;
  biomeId: string;
  roomId: string;
  tier: number;
  /** Biome ids entered so far, current one last. */
  path: string[];
  /** Room ids of the CURRENT biome a player has stood in. */
  visited: Set<string>;
  /** Room ids of the current biome whose fight is over (quiet rooms count as cleared on entry). */
  cleared: Set<string>;
  /** Room ids of the current biome whose rest site / cache has been used. */
  usedFeatures: Set<string>;
  choice: BiomeChoiceState | null;
  hostPlayerId: string | null;
  mapCache: FloorMapRoom[] | null;
}

export function createFloorsRun(provider: RoomProvider, hostPlayerId: string | null): FloorsRun {
  const entrance = provider.entranceRef();
  return {
    provider, biomeId: entrance.biomeId, roomId: entrance.roomId, tier: provider.tier(entrance.biomeId),
    path: [entrance.biomeId], visited: new Set(), cleared: new Set(), usedFeatures: new Set(),
    choice: null, hostPlayerId, mapCache: null,
  };
}

export function tierMultiplier(tier: number): number {
  return 1 + FLOOR_TUNING.tierScalePerTier * tier;
}

export function sealsDoors(room: RoomSpec): boolean {
  return room.kind !== undefined && SEALING_KINDS.has(room.kind);
}

/** Resources paid to every operative when the room's fight ends; quiet rooms pay nothing. */
export function clearReward(room: RoomSpec): number {
  switch (room.kind) {
    case 'combat': return ROOM_CLEAR_REWARD;
    case 'elite': return ROOM_CLEAR_REWARD * FLOOR_TUNING.eliteRewardMultiplier;
    case 'exit': return ROOM_CLEAR_REWARD * FLOOR_TUNING.exitRewardMultiplier;
    default: return 0;
  }
}

export const TREASURE_REWARD = ROOM_CLEAR_REWARD * FLOOR_TUNING.treasureRewardMultiplier;

export function focusPoint(room: RoomSpec): { x: number; y: number } | null {
  return room.focus ? tileToWorld(room.focus.x, room.focus.y) : null;
}

/** Records arrival in a room of the current biome. */
export function markVisited(run: FloorsRun, ref: RoomAddress): void {
  run.biomeId = ref.biomeId;
  run.roomId = ref.roomId;
  run.visited.add(ref.roomId);
  run.mapCache = null;
}

export function markCleared(run: FloorsRun, roomId: string): void {
  run.cleared.add(roomId);
  run.mapCache = null;
}

/** Moves the run one biome deeper; per-biome sets restart because there is no way back. */
export function advanceBiome(run: FloorsRun, biomeId: string): void {
  run.biomeId = biomeId;
  run.tier = run.provider.tier(biomeId);
  run.path.push(biomeId);
  run.visited = new Set();
  run.cleared = new Set();
  run.usedFeatures = new Set();
  run.choice = null;
  run.mapCache = null;
}

/** Where a crew walking through the door to `toRoomId` arrives: the twin door's entry tile. */
export function doorArrival(run: FloorsRun, from: RoomSpec, toRoomId: string): { room: RoomSpec; entry: { x: number; y: number }; inward: { x: number; y: number } } | null {
  if (from.biomeId === undefined || from.roomId === undefined) return null;
  const room = run.provider.getRoom({ biomeId: from.biomeId, roomId: toRoomId });
  const twin = room.exits.find((exit) => exit.toRoomId === from.roomId);
  if (!twin?.entry) return null;
  return { room, entry: twin.entry, inward: { x: twin.entry.x - twin.x, y: twin.entry.y - twin.y } };
}

/**
 * Fog of war: visited rooms plus their unvisited neighbours. A neighbour's kind stays hidden
 * while it could be a fight; special rooms show their icon from next door, as in Isaac.
 */
function buildMap(run: FloorsRun): FloorMapRoom[] {
  const plan = run.provider.plan(run.biomeId);
  const seen = new Set<string>();
  for (const room of plan.rooms) {
    if (!run.visited.has(room.id)) continue;
    for (const side of DOOR_SIDES) {
      const neighbour = room.doors[side];
      if (neighbour !== undefined && !run.visited.has(neighbour)) seen.add(neighbour);
    }
  }
  const map: FloorMapRoom[] = [];
  for (const room of plan.rooms) {
    const visited = run.visited.has(room.id);
    if (!visited && !seen.has(room.id)) continue;
    map.push({
      roomId: room.id, cell: { ...room.cell }, state: visited ? 'visited' : 'seen',
      kind: visited || (room.kind !== 'combat' && room.kind !== 'elite') ? room.kind : null,
      cleared: run.cleared.has(room.id),
      doors: DOOR_SIDES.filter((side) => room.doors[side] !== undefined),
    });
  }
  return map;
}

export function floorRunState(run: FloorsRun, doorsLocked: boolean): FloorRunState {
  run.mapCache ??= buildMap(run);
  return {
    biomeId: run.biomeId, roomId: run.roomId, tier: run.tier, path: [...run.path],
    map: run.mapCache.map((room) => ({ ...room, cell: { ...room.cell }, doors: [...room.doors] })),
    doorsLocked,
    biomeChoice: run.choice ? { ...run.choice, options: [...run.choice.options], votes: { ...run.choice.votes }, hostPlayerId: run.hostPlayerId } : null,
  };
}
