/**
 * Room provider for floors worlds: the one place the sim AND the client turn a room
 * address `{biomeId, roomId}` into a RoomSpec. Rooms are compiled lazily and cached; the
 * same `world.floors` gives byte-identical rooms on every machine, so snapshots only
 * carry the address (see docs/design/FLOORS.md).
 *
 * Owner: Agent F2. This adapter is built directly on src/shared/floorgen. When the shared
 * runtime (`createFloorRuntime`, agent F1b) lands, swap the body of `createRoomProvider`
 * for it: the `RoomProvider` interface below is everything the sim relies on.
 */
import { PreparedWorldSchema, type PreparedWorld, type RoomSpec } from '../shared/contracts';
import {
  BIOME_BRIEF_COUNT, FLOOR_ENTRANCE_ROOM_ID, floorRoomIndex,
  type BiomeBrief, type BuiltRoom, type FloorPlan, type RoomAddress, type WorldFloors,
} from '../shared/floors';
import { DEFAULT_BIOME_BRIEFS, buildRoom, flood, generateFloorPlan, hashSeed, nextBiomeChoices, planWorldRoute, seedKey } from '../shared/floorgen';
import { PROP_INFO } from '../shared/registry';

export interface RoomProvider {
  getRoom(ref: RoomAddress): RoomSpec;
  entranceRef(): RoomAddress;
  /** The biome's room graph (cells, doors, kinds): drives the minimap and test bots. */
  getPlan(biomeId: string): FloorPlan;
  getBrief(biomeId: string): BiomeBrief;
  /** Depth of the biome in the run, 0..4. */
  tierOf(biomeId: string): number;
  /** Biomes offered after `biomeId`'s exit: 2, 1 before the finale, none after it. */
  nextBiomeChoices(biomeId: string): string[];
  isFinalRoom(ref: RoomAddress): boolean;
}

const KIND_LABEL: Record<NonNullable<RoomSpec['kind']>, string> = {
  entrance: 'Threshold', combat: 'Contested Hall', elite: 'Elite Post', treasure: 'Cache',
  lore: 'Reading Room', rest: 'Shelter', exit: 'Gate', shop: 'Exchange',
};

/** Three ritual relay sites for the final room: safe, reachable, spread out around the Anchor. */
function pickAnchorRelays(built: BuiltRoom): Array<{ x: number; y: number }> {
  const blocked = new Set<string>();
  for (const prop of built.props) {
    const info = PROP_INFO[prop.propId];
    if (!info.blocksMovement) continue;
    for (let dy = 0; dy < info.footprint.h; dy++) for (let dx = 0; dx < info.footprint.w; dx++) blocked.add(`${prop.x + dx},${prop.y + dy}`);
  }
  const reachable = flood(built.tiles, built.spawn, (ch) => ch !== '~', blocked);
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < built.height - 1; y++) {
    for (let x = 1; x < built.width - 1; x++) {
      if (built.tiles[y]![x] !== '.' || blocked.has(`${x},${y}`) || !reachable.has(`${x},${y}`)) continue;
      if (Math.max(Math.abs(x - built.focus.x), Math.abs(y - built.focus.y)) < 3) continue;
      if (built.doors.some((door) => Math.abs(door.entry.x - x) + Math.abs(door.entry.y - y) < 2)) continue;
      candidates.push({ x, y });
    }
  }
  // Farthest-point sampling from the Anchor; ties resolve in scan order, so it is deterministic.
  const chosen: Array<{ x: number; y: number }> = [];
  const anchors = [built.focus];
  while (chosen.length < 3 && candidates.length > 0) {
    let best = 0;
    let bestScore = -1;
    candidates.forEach((candidate, i) => {
      const score = Math.min(...anchors.map((a) => Math.abs(a.x - candidate.x) + Math.abs(a.y - candidate.y)));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const [pick] = candidates.splice(best, 1);
    chosen.push(pick!);
    anchors.push(pick!);
  }
  return chosen;
}

function toRoomSpec(built: BuiltRoom, brief: BiomeBrief, seed: string, relicFragments: number[]): RoomSpec {
  const { biomeId, roomId } = built.address;
  const isFinal = built.feature === 'anchor';
  const relays = isFinal ? pickAnchorRelays(built) : [];
  const relicIndex = built.kind === 'lore' && relicFragments.length > 0
    ? relicFragments[hashSeed(seedKey(seed, biomeId, 'relic', roomId)) % relicFragments.length]
    : undefined;
  return {
    id: `${biomeId}:${roomId}`,
    index: floorRoomIndex(roomId) ?? 0,
    name: `${brief.name} · ${KIND_LABEL[built.kind]}`.slice(0, 80),
    description: brief.tagline,
    width: built.width,
    height: built.height,
    tiles: built.tiles,
    props: built.props.map((prop) => ({ ...prop })),
    encounters: built.encounters.map((encounter) => ({ ...encounter })),
    exits: built.doors.map((door) => ({
      x: door.x, y: door.y, direction: door.direction, toRoomIndex: floorRoomIndex(door.toRoomId) ?? 0,
      toRoomId: door.toRoomId, entry: { ...door.entry },
    })),
    isFinal,
    attributions: [],
    relics: relicIndex === undefined ? [] : [{ id: `relic-${roomId}`, x: built.focus.x, y: built.focus.y, fragmentIndex: relicIndex }],
    ...(relays.length === 3 ? { anchorRelays: relays } : {}),
    biomeId, roomId, kind: built.kind, feature: built.feature, focus: { ...built.focus }, depth: built.depth,
  };
}

export function createRoomProvider(world: Pick<PreparedWorld, 'floors' | 'recipe'>): RoomProvider | null {
  const floors = world.floors;
  if (!floors) return null;
  const plans = new Map<string, FloorPlan>();
  const rooms = new Map<string, RoomSpec>();
  const relicFragments = world.recipe.lore.flatMap((fragment, index) => fragment.kind === 'relic' ? [index] : []);
  const node = (biomeId: string) => {
    const found = floors.route.graph.nodes.find((candidate) => candidate.biomeId === biomeId);
    if (!found) throw new Error(`floors: biome ${biomeId} is not on the route`);
    return found;
  };
  const provider: RoomProvider = {
    getBrief(biomeId) {
      const brief = floors.briefs.find((candidate) => candidate.id === biomeId);
      if (!brief) throw new Error(`floors: no brief for biome ${biomeId}`);
      return brief;
    },
    tierOf: (biomeId) => node(biomeId).tier,
    getPlan(biomeId) {
      let plan = plans.get(biomeId);
      if (!plan) {
        const { tier, roomBudget } = node(biomeId);
        plan = generateFloorPlan(provider.getBrief(biomeId), tier, floors.seed, { roomBudget });
        plans.set(biomeId, plan);
      }
      return plan;
    },
    getRoom(ref) {
      const key = `${ref.biomeId}:${ref.roomId}`;
      let room = rooms.get(key);
      if (!room) {
        const brief = provider.getBrief(ref.biomeId);
        room = toRoomSpec(buildRoom(provider.getPlan(ref.biomeId), ref.roomId, brief, floors.seed), brief, floors.seed, relicFragments);
        rooms.set(key, room);
      }
      return room;
    },
    entranceRef: () => ({ biomeId: floors.route.tiers[0]![0]!, roomId: FLOOR_ENTRANCE_ROOM_ID }),
    nextBiomeChoices: (biomeId) => nextBiomeChoices(floors.route, biomeId),
    isFinalRoom: (ref) => provider.getRoom(ref).isFinal,
  };
  return provider;
}

/**
 * Offline upgrade of a legacy world to a floors world (`?floors=1` before the server can
 * ship one): default briefs on a seeded route, `rooms` reduced to the opening entrance.
 * Stand-in for F1b's `upgradeToFloors`; the recipe (title, lore, art) is kept as is.
 */
export function toFloorsWorld(world: PreparedWorld, seed: string = world.worldId): PreparedWorld {
  if (world.floors) return world;
  const briefs = DEFAULT_BIOME_BRIEFS.slice(0, BIOME_BRIEF_COUNT).map((brief) => ({ ...brief }));
  const floors: WorldFloors = { seed, route: planWorldRoute(seed, briefs.map((brief) => brief.id)), briefs };
  const provider = createRoomProvider({ floors, recipe: world.recipe })!;
  return PreparedWorldSchema.parse({
    ...world, floors, plannedRoomCount: 1, rooms: [provider.getRoom(provider.entranceRef())],
    recipe: { ...world.recipe, contributionMappings: [] },
  });
}
