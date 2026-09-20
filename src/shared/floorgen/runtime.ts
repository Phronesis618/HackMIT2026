/**
 * Floor runtime — the shared room provider of a floors world.
 *
 * Owner: Agent F1b (floors core). Pure and deterministic: no I/O, no clock, no Math.random.
 *
 * `PreparedWorld.floors` ships only `(seed, route, briefs)`. Whoever runs the simulation
 * (the browser in solo play, the server in co-op) creates one runtime per world and asks
 * it for rooms as the crew reaches them. A room depends on `(seed, brief, tier, roomId)`
 * and on nothing else, so two machines that build the same room get byte-identical JSON,
 * in any order. Plans and rooms are cached per runtime and never persisted or sent.
 */
import { PreparedWorldSchema, RoomSpecSchema, type PreparedWorld, type RoomSpec, type WorldRecipe } from '../contracts';
import {
  BIOME_TIER_COUNT,
  DOOR_SIDES,
  FLOOR_ENTRANCE_ROOM_ID,
  SIDE_TO_DIRECTION,
  WorldFloorsSchema,
  floorRoomIndex,
  type BiomeBrief,
  type BuiltRoom,
  type DoorDirection,
  type DoorSide,
  type FloorMapRoom,
  type FloorPlan,
  type FloorRoom,
  type RoomAddress,
  type RoomKind,
  type WorldFloors,
} from '../floors';
import { ENEMY_INFO, PROP_INFO } from '../registry';
import { defaultBiomeTerrain, resolveBiomeBriefs } from './briefs';
import { generateFloorPlan } from './floorplan';
import { hashSeed, seedKey } from './rng';
import { buildRoom, flood } from './rooms';
import { nextBiomeChoices as routeChoices, planWorldRoute } from './route';
import { applyBiomeTerrain } from './terrain';

export interface FloorNeighbour {
  side: DoorSide;
  direction: DoorDirection;
  ref: RoomAddress;
  kind: RoomKind;
}

export interface FloorRuntimeContext {
  /**
   * The world's recipe. Two fields are read:
   *  - `lore`: lore rooms get one of its `relic` fragments on their focus tile;
   *  - `biomeRoomLines`: the model's own line for a (biome, room kind) becomes that room's
   *    description. The engine's derived line is the fallback, so a world without them is
   *    unchanged (C4).
   */
  recipe?: Pick<WorldRecipe, 'lore' | 'biomeRoomLines'>;
}

export interface FloorRuntime {
  readonly floors: WorldFloors;
  /** `{opening biome, r00}` — where `enterPortal` puts the crew; also `PreparedWorld.rooms[0]`. */
  entranceRef(): RoomAddress;
  /** Entrance room of any biome (every biome starts at r00, players spawn on its 'P'). */
  biomeEntranceRef(biomeId: string): RoomAddress;
  brief(biomeId: string): BiomeBrief;
  /** 0..4. */
  tier(biomeId: string): number;
  plan(biomeId: string): FloorPlan;
  /** Lazy, cached, validated with RoomSpecSchema. Throws on an address that is not in the world. */
  getRoom(ref: RoomAddress): RoomSpec;
  neighbours(ref: RoomAddress): FloorNeighbour[];
  /** Tile where a player stands in `to` after walking through the door of `from` that leads to it. */
  arrivalTile(from: RoomAddress, to: RoomAddress): { x: number; y: number };
  /** Biome ids offered after `biomeId`'s exit: 2, then 1 before the finale, [] after it. */
  nextBiomeChoices(biomeId: string): string[];
  /** The exit room of `biomeId` (tiers 0–3: biome choice at `focus`; tier 4: the Anchor room). */
  exitRef(biomeId: string): RoomAddress;
  isBiomeExit(ref: RoomAddress): boolean;
  /** True only for the tier-4 exit room (`feature: 'anchor'`, `isFinal: true`). */
  isFinalRoom(ref: RoomAddress): boolean;
  /** Fog-of-war map for `GameSnapshot.floor.map`: visited rooms plus their unvisited neighbours. */
  mapRooms(biomeId: string, visitedRoomIds: readonly string[], clearedRoomIds?: readonly string[]): FloorMapRoom[];
}

/** Kinds whose rooms get terrain. Quiet rooms stay clean so their focus reads at a glance. */
const TERRAIN_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['combat', 'elite', 'exit']);
const SIZE_NOUN = { small: 'cell', medium: 'hall', large: 'great hall' } as const;
/** A rest site is once per run (docs/design/FLOORS.md §12); every rest room says so. */
const REST_ONCE = 'Stopping here mends the crew once, and not again.';
const key = (x: number, y: number) => `${x},${y}`;

export function createFloorRuntime(rawFloors: WorldFloors, context: FloorRuntimeContext = {}): FloorRuntime {
  const floors = WorldFloorsSchema.parse(rawFloors);
  const briefs = new Map(floors.briefs.map((brief) => [brief.id, brief]));
  const nodes = new Map(floors.route.graph.nodes.map((node) => [node.biomeId, node]));
  const plans = new Map<string, FloorPlan>();
  const rooms = new Map<string, RoomSpec>();
  const relicFragments = (context.recipe?.lore ?? []).flatMap((fragment, index) => (fragment.kind === 'relic' ? [index] : []));
  /** `biomeId -> kind -> the model's line`. First line wins if a biome repeats a kind. */
  const authoredLines = new Map<string, Map<string, string>>();
  for (const entry of context.recipe?.biomeRoomLines ?? []) {
    const byKind = authoredLines.get(entry.biomeId) ?? new Map<string, string>();
    for (const line of entry.lines) if (!byKind.has(line.kind)) byKind.set(line.kind, line.text);
    authoredLines.set(entry.biomeId, byKind);
  }

  const node = (biomeId: string) => {
    const found = nodes.get(biomeId);
    if (!found || !briefs.has(biomeId)) throw new Error(`floors: biome ${biomeId} is not in this world`);
    return found;
  };
  const brief = (biomeId: string) => { node(biomeId); return briefs.get(biomeId)!; };
  const plan = (biomeId: string): FloorPlan => {
    let cached = plans.get(biomeId);
    if (!cached) {
      const { tier, roomBudget } = node(biomeId);
      cached = generateFloorPlan(brief(biomeId), tier, floors.seed, { roomBudget });
      plans.set(biomeId, cached);
    }
    return cached;
  };
  const planRoom = (ref: RoomAddress): FloorRoom => {
    const found = plan(ref.biomeId).rooms.find((room) => room.id === ref.roomId);
    if (!found) throw new Error(`floors: room ${ref.roomId} is not in biome ${ref.biomeId}`);
    return found;
  };

  const getRoom = (ref: RoomAddress): RoomSpec => {
    const cacheKey = `${ref.biomeId}\n${ref.roomId}`;
    let room = rooms.get(cacheKey);
    if (!room) {
      const floorPlan = plan(ref.biomeId);
      const planned = planRoom(ref);
      const biome = brief(ref.biomeId);
      const built = buildRoom(floorPlan, ref.roomId, biome, floors.seed);
      const terrain = biome.terrain ?? defaultBiomeTerrain(biome.motifIds[0]!);
      const tiles = TERRAIN_KINDS.has(built.kind) ? applyBiomeTerrain(built, terrain, floors.seed) : built.tiles;
      const loreRooms = floorPlan.rooms.filter((candidate) => candidate.kind === 'lore').map((candidate) => candidate.id);
      room = RoomSpecSchema.parse({
        ...toRoomSpec(built, tiles, planned, floorPlan, biome, relicFor(ref, loreRooms),
          authoredLines.get(ref.biomeId)?.get(built.kind)),
        // The biome's terrain tuning, carried to the sim (docs/design/TILES.md §4.2).
        ...(terrain.intensity !== undefined ? { terrainIntensity: terrain.intensity } : {}),
      });
      rooms.set(cacheKey, room);
    }
    return room;
  };

  /** Lore rooms of a biome take consecutive relic fragments, starting at a per-biome offset. */
  const relicFor = (ref: RoomAddress, loreRoomIds: readonly string[]): number | undefined => {
    const position = loreRoomIds.indexOf(ref.roomId);
    if (position < 0 || relicFragments.length === 0) return undefined;
    return relicFragments[(hashSeed(seedKey(floors.seed, ref.biomeId, 'relics')) + position) % relicFragments.length];
  };

  const exitRef = (biomeId: string): RoomAddress => ({ biomeId, roomId: plan(biomeId).exitId });
  const isBiomeExit = (ref: RoomAddress) => plan(ref.biomeId).exitId === ref.roomId;

  return {
    floors,
    entranceRef: () => ({ biomeId: floors.route.tiers[0]![0]!, roomId: FLOOR_ENTRANCE_ROOM_ID }),
    biomeEntranceRef: (biomeId) => ({ biomeId, roomId: plan(biomeId).entranceId }),
    brief,
    tier: (biomeId) => node(biomeId).tier,
    plan,
    getRoom,
    neighbours(ref) {
      const planned = planRoom(ref);
      return DOOR_SIDES.flatMap((side) => {
        const roomId = planned.doors[side];
        if (roomId === undefined) return [];
        const target = { biomeId: ref.biomeId, roomId };
        return [{ side, direction: SIDE_TO_DIRECTION[side], ref: target, kind: planRoom(target).kind }];
      });
    },
    arrivalTile(from, to) {
      if (from.biomeId !== to.biomeId) throw new Error('floors: doors never cross biomes; use biomeEntranceRef and the room spawn');
      const twin = getRoom(to).exits.find((exit) => exit.toRoomId === from.roomId);
      if (!twin?.entry) throw new Error(`floors: ${to.roomId} has no door back to ${from.roomId}`);
      return { ...twin.entry };
    },
    nextBiomeChoices: (biomeId) => { node(biomeId); return routeChoices(floors.route, biomeId); },
    exitRef,
    isBiomeExit,
    isFinalRoom: (ref) => isBiomeExit(ref) && node(ref.biomeId).tier === BIOME_TIER_COUNT - 1,
    mapRooms(biomeId, visitedRoomIds, clearedRoomIds = []) {
      const floorPlan = plan(biomeId);
      const visited = new Set(visitedRoomIds);
      const cleared = new Set(clearedRoomIds);
      const seen = new Set<string>();
      for (const room of floorPlan.rooms) {
        if (!visited.has(room.id)) continue;
        for (const side of DOOR_SIDES) {
          const neighbour = room.doors[side];
          if (neighbour !== undefined && !visited.has(neighbour)) seen.add(neighbour);
        }
      }
      return floorPlan.rooms.filter((room) => visited.has(room.id) || seen.has(room.id)).map((room) => ({
        roomId: room.id,
        cell: { ...room.cell },
        state: visited.has(room.id) ? 'visited' as const : 'seen' as const,
        kind: visited.has(room.id) ? room.kind : null,
        cleared: cleared.has(room.id),
        doors: DOOR_SIDES.filter((side) => room.doors[side] !== undefined),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// BuiltRoom -> RoomSpec
// ---------------------------------------------------------------------------

function toRoomSpec(
  built: BuiltRoom, tiles: string[], planned: FloorRoom, plan: FloorPlan, brief: BiomeBrief,
  relicFragment: number | undefined, authoredLine?: string,
): RoomSpec {
  const { biomeId, roomId } = built.address;
  const isFinal = built.feature === 'anchor';
  const room: RoomSpec = {
    // `id` is for logs and event keys. Address rooms by biomeId + roomId, never by parsing this.
    id: `${biomeId.slice(0, 60)}:${roomId}`,
    index: floorRoomIndex(roomId) ?? plan.rooms.indexOf(planned),
    name: roomName(built, brief, plan).slice(0, 80),
    description: roomDescription(built, brief, authoredLine).slice(0, 300),
    width: built.width,
    height: built.height,
    tiles,
    props: built.props.map((prop) => ({ ...prop })),
    encounters: built.encounters.map((encounter) => ({ ...encounter })),
    exits: built.doors.map((door) => ({
      x: door.x,
      y: door.y,
      toRoomIndex: floorRoomIndex(door.toRoomId) ?? 0,
      direction: door.direction,
      toRoomId: door.toRoomId,
      entry: { ...door.entry },
    })),
    isFinal,
    attributions: [],
    relics: relicFragment === undefined ? [] : [{ id: `${roomId}.relic`, x: built.focus.x, y: built.focus.y, fragmentIndex: relicFragment }],
    biomeId,
    roomId,
    kind: built.kind,
    feature: built.feature,
    focus: { ...built.focus },
    depth: built.depth,
  };
  if (isFinal) {
    const relays = placeAnchorRelays(room, built);
    if (relays) room.anchorRelays = relays;
  }
  return room;
}

/** Plain and concrete on purpose: W2 replaces these with model-written lines. */
function roomName(built: BuiltRoom, brief: BiomeBrief, plan: FloorPlan): string {
  const number = (floorRoomIndex(built.address.roomId) ?? 0) + 1;
  switch (built.kind) {
    case 'entrance': return `${brief.name} entrance`;
    case 'exit': return built.feature === 'anchor' ? 'Anchor chamber' : `${brief.name} gate`;
    case 'elite': return `Guard post ${number}`;
    case 'treasure': return `Store room ${number}`;
    case 'lore': return `Record room ${number}`;
    case 'rest': return `Camp ${number}`;
    case 'shop': return `Trade post ${number}`;
    default: return `${brief.name} ${SIZE_NOUN[built.sizeClass]} ${number} of ${plan.rooms.length}`;
  }
}

/**
 * The world's own line for this (biome, kind) when the model wrote one, the engine's derived line
 * otherwise (C4). A rest room keeps the sentence that states the mechanic either way: it works
 * once per run, and no world's prose gets to imply otherwise (A4).
 */
function roomDescription(built: BuiltRoom, brief: BiomeBrief, authoredLine?: string): string {
  if (authoredLine !== undefined) {
    return built.kind === 'rest' ? `${authoredLine} ${REST_ONCE}` : authoredLine;
  }
  const doors = `${built.doors.length} door${built.doors.length === 1 ? '' : 's'}`;
  const shape = `A ${SIZE_NOUN[built.sizeClass]} with ${doors}`;
  const hostiles = [...new Set(built.encounters.map((encounter) => ENEMY_INFO[encounter.enemyId].name))];
  switch (built.kind) {
    case 'entrance': return `${shape}. The way into ${brief.name}. No hostiles.`;
    case 'treasure': return `${shape}. One sealed store in the middle. No hostiles.`;
    case 'lore': return `${shape}. One record to read. No hostiles.`;
    case 'rest': return `${shape}. A cold camp. ${REST_ONCE}`;
    case 'shop': return `${shape}. Shelves, mostly empty.`;
    case 'exit': return built.feature === 'anchor'
      ? `${shape}. The Anchor site. The Custodian is in the room.`
      : `${shape}. The gate out of ${brief.name}. Its gatekeeper is in the room.`;
    default: return hostiles.length > 0 ? `${shape}. Hostiles: ${hostiles.join(', ')}.` : `${shape}. Empty.`;
  }
}

/** Three safe, reachable, prop-free floor tiles spread away from the Anchor, the spawn and each other. */
function placeAnchorRelays(room: RoomSpec, built: BuiltRoom): Array<{ x: number; y: number }> | undefined {
  const blocked = new Set<string>();
  for (const prop of room.props) {
    const { w, h } = PROP_INFO[prop.propId].footprint;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) blocked.add(key(prop.x + dx, prop.y + dy));
  }
  const reach = flood(room.tiles, built.spawn, (ch) => ch !== '~' && ch !== 'B', blocked);
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (room.tiles[y]![x] === '.' && reach.has(key(x, y)) && !blocked.has(key(x, y))) candidates.push({ x, y });
    }
  }
  const relays: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 3; i++) {
    const anchors = [built.focus, built.spawn, ...relays];
    const score = (candidate: { x: number; y: number }) => Math.min(...anchors.map((anchor) => Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y)));
    candidates.sort((a, b) => score(b) - score(a) || a.y - b.y || a.x - b.x);
    const point = candidates.shift();
    if (!point || score(point) === 0) return undefined;
    relays.push(point);
  }
  return relays;
}

// ---------------------------------------------------------------------------
// PreparedWorld helpers
// ---------------------------------------------------------------------------

/** Runtime for a floors world (`world.floors` must be present), with relics wired to its recipe. */
export function createWorldFloorRuntime(world: Pick<PreparedWorld, 'floors' | 'recipe'>): FloorRuntime {
  if (!world.floors) throw new Error('floors: this world has no floors');
  return createFloorRuntime(world.floors, { recipe: world.recipe });
}

export function isFloorsWorld(world: Pick<PreparedWorld, 'floors'> | null | undefined): world is Pick<PreparedWorld, 'floors'> & { floors: WorldFloors } {
  return world?.floors !== undefined;
}

/**
 * Turns any valid world (legacy 3-room, fixture or live) into a floors world: briefs come
 * from `recipe.biomes` or are derived, the route is dealt from `seed`, and `rooms` becomes
 * `[entrance]` with `plannedRoomCount` 1. Everything else (recipe, art, provenance, receipt)
 * is kept. Pure, so the browser's offline path can call it too. Idempotent for equal seeds.
 */
export function upgradeToFloors(world: PreparedWorld, seed: string): PreparedWorld {
  const briefs = resolveBiomeBriefs(world.recipe, seed);
  const floors: WorldFloors = { seed, route: planWorldRoute(seed, briefs.map((brief) => brief.id)), briefs };
  const runtime = createFloorRuntime(floors, { recipe: world.recipe });
  return PreparedWorldSchema.parse({ ...world, floors, rooms: [runtime.getRoom(runtime.entranceRef())], plannedRoomCount: 1 });
}

/** Seed string of a floors world: the request's numeric seed when given, the world id otherwise. */
export function floorsSeedFor(world: Pick<PreparedWorld, 'worldId'>, requestSeed?: number): string {
  return requestSeed === undefined ? world.worldId : String(requestSeed);
}
