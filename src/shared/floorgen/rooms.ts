/**
 * Room assembler — turns one FloorRoom into tiles, doors, props and encounters.
 *
 * Owner: Agent F1a (floors). Pure and deterministic. A room's RNG stream is keyed by
 * (seed, biomeId, roomId) only, so rooms can be built lazily, in any order, on server
 * and client, and always come out byte-identical.
 *
 * Pipeline: template → seeded mirror/flip → open the door sockets the plan needs (all
 * other sockets stay wall) → pillar clusters → hazard pools (only if brief.hazards) →
 * connectivity repair → props → encounters.
 *
 * Guarantees (asserted by tests over many seeds):
 *  - only legacy tile chars; exactly one 'P'; one 'A' only in the final biome's exit;
 *  - every door is an 'X' on the border with a walkable `entry` tile inside;
 *  - spawn, focus and every door entry are mutually reachable, also WITHOUT stepping
 *    on hazard tiles and with every blocking prop in place;
 *  - props and encounters stand on walkable tiles; encounters are reachable and keep
 *    their distance from doors and spawn.
 */
import {
  BIOME_TIER_COUNT,
  BiomeBriefSchema,
  DOOR_SIDES,
  SIDE_DELTA,
  SIDE_TO_DIRECTION,
  type BiomeBrief,
  type BuiltEncounter,
  type BuiltProp,
  type BuiltRoom,
  type DoorSide,
  type FloorPlan,
  type FloorRoom,
  type RoomDoor,
  type RoomFeature,
  type RoomKind,
  type SizeClass,
} from '../floors';
import { PROP_INFO, type PropId } from '../registry';
import { rollEncounters } from './director';
import { createRng, seedKey, type Rng } from './rng';
import { getTemplate, type RoomTemplate } from './templates';

interface Coord {
  x: number;
  y: number;
}
type Grid = string[][];

const FEATURE_BY_KIND: Record<RoomKind, RoomFeature> = {
  entrance: 'none',
  combat: 'none',
  elite: 'none',
  treasure: 'treasure',
  lore: 'lore',
  rest: 'rest',
  exit: 'biome_exit',
  shop: 'none',
};

const PROP_RANGE: Record<SizeClass, readonly [number, number]> = { small: [2, 4], medium: [4, 7], large: [6, 10] };
const QUIET_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['entrance', 'treasure', 'lore', 'rest', 'shop']);

export function buildRoom(plan: FloorPlan, roomId: string, brief: BiomeBrief, seed: string): BuiltRoom {
  const room = plan.rooms.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error(`floorgen: room ${roomId} is not in the floor plan of ${plan.biomeId}`);
  const parsed = BiomeBriefSchema.parse(brief);
  const rng = createRng(seedKey(seed, plan.biomeId, 'room', roomId));
  const isFinalExit = room.kind === 'exit' && plan.tier === BIOME_TIER_COUNT - 1;
  const sides = DOOR_SIDES.filter((side) => room.doors[side] !== undefined);

  // 1. Template + mirror/flip. A flip is kept only if the needed sockets survive it.
  const base = getTemplate(room.templateId);
  let shape = { tiles: base.tiles.map((row) => [...row]), sockets: { ...base.sockets } };
  const flipX = rng.chance(0.5);
  const flipY = rng.chance(0.5);
  const flipped = transform(base, flipX, flipY);
  if (sides.every((side) => flipped.sockets[side] !== undefined)) shape = flipped;
  const grid = shape.tiles;
  const height = grid.length;
  const width = grid[0]!.length;

  // 2. Spawn and focus.
  const spawn = findTile(grid, 'P') ?? nearestFloor(grid, { x: Math.floor(width / 2), y: Math.floor(height / 2) });
  grid[spawn.y]![spawn.x] = 'P';
  const marked = findTile(grid, 'A');
  const focus = marked ?? nearestFloor(grid, { x: Math.floor(width / 2), y: Math.floor(height / 2) });
  grid[focus.y]![focus.x] = isFinalExit ? 'A' : '.';

  // 3. Doors: open exactly the sockets the plan needs.
  const doors: RoomDoor[] = sides.map((side) => openDoor(grid, side, shape.sockets[side], room));
  const keyPoints: Coord[] = [spawn, focus, ...doors.map((door) => door.entry)];

  // 4. Mutators.
  if (room.kind === 'combat' || room.kind === 'elite') addPillarClusters(grid, keyPoints, room.sizeClass, rng);
  if (parsed.hazards && !QUIET_KINDS.has(room.kind)) addHazardPools(grid, keyPoints, room.sizeClass, rng);

  // 5. Repair: whatever happened above, every key point must reach the spawn.
  repairConnectivity(grid, spawn, keyPoints);

  // 6. Props, then encounters on what is still reachable.
  const blocked = new Set<string>();
  const occupied = new Set<string>();
  const props = placeProps(grid, parsed, room, isFinalExit, focus, keyPoints, blocked, occupied, rng);
  const encounters = placeEncounters(grid, parsed, plan, room, isFinalExit, spawn, focus, doors, blocked, occupied, rng);

  return {
    address: { biomeId: plan.biomeId, roomId: room.id },
    kind: room.kind,
    depth: room.depth,
    templateId: base.id,
    sizeClass: base.sizeClass,
    width,
    height,
    tiles: grid.map((row) => row.join('')),
    doors,
    spawn,
    focus,
    feature: isFinalExit ? 'anchor' : FEATURE_BY_KIND[room.kind],
    props,
    encounters,
  };
}

export interface BuiltFloor {
  plan: FloorPlan;
  rooms: BuiltRoom[];
}

/** Builds every room of a floor, in plan order. */
export function buildFloor(plan: FloorPlan, brief: BiomeBrief, seed: string): BuiltFloor {
  return { plan, rooms: plan.rooms.map((room) => buildRoom(plan, room.id, brief, seed)) };
}

export interface LazyFloor {
  plan: FloorPlan;
  /** Builds on first request, then serves the cached room. Same result as buildFloor. */
  room(roomId: string): BuiltRoom;
  builtRoomIds(): string[];
}

export function createLazyFloor(plan: FloorPlan, brief: BiomeBrief, seed: string): LazyFloor {
  const cache = new Map<string, BuiltRoom>();
  return {
    plan,
    room(roomId) {
      let built = cache.get(roomId);
      if (!built) {
        built = buildRoom(plan, roomId, brief, seed);
        cache.set(roomId, built);
      }
      return built;
    },
    builtRoomIds: () => [...cache.keys()],
  };
}

// ---------------------------------------------------------------------------
// Template transform + doors
// ---------------------------------------------------------------------------

function transform(template: RoomTemplate, flipX: boolean, flipY: boolean): { tiles: Grid; sockets: Partial<Record<DoorSide, number>> } {
  const height = template.tiles.length;
  const width = template.tiles[0]!.length;
  let tiles: Grid = template.tiles.map((row) => [...row]);
  let { n, s, e, w } = template.sockets;
  if (flipX) {
    tiles = tiles.map((row) => [...row].reverse());
    n = n === undefined ? undefined : width - 1 - n;
    s = s === undefined ? undefined : width - 1 - s;
    [e, w] = [w, e];
  }
  if (flipY) {
    tiles = [...tiles].reverse();
    e = e === undefined ? undefined : height - 1 - e;
    w = w === undefined ? undefined : height - 1 - w;
    [n, s] = [s, n];
  }
  const sockets: Partial<Record<DoorSide, number>> = {};
  if (n !== undefined) sockets.n = n;
  if (s !== undefined) sockets.s = s;
  if (e !== undefined) sockets.e = e;
  if (w !== undefined) sockets.w = w;
  return { tiles, sockets };
}

function openDoor(grid: Grid, side: DoorSide, socket: number | undefined, room: FloorRoom): RoomDoor {
  const height = grid.length;
  const width = grid[0]!.length;
  const horizontal = side === 'n' || side === 's';
  // Missing socket (only possible with a hand-edited plan): use the middle of the wall.
  const pos = socket ?? Math.floor((horizontal ? width : height) / 2);
  const x = horizontal ? pos : side === 'w' ? 0 : width - 1;
  const y = horizontal ? (side === 'n' ? 0 : height - 1) : pos;
  const entry = { x: x - SIDE_DELTA[side].dx, y: y - SIDE_DELTA[side].dy };
  grid[y]![x] = 'X';
  if (!isWalkable(grid, entry.x, entry.y)) grid[entry.y]![entry.x] = '.';
  return { x, y, direction: SIDE_TO_DIRECTION[side], toRoomId: room.doors[side]!, entry };
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

const CLUSTER_SHAPES: ReadonlyArray<ReadonlyArray<Coord>> = [
  [{ x: 0, y: 0 }],
  [{ x: 0, y: 0 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 2 }],
  [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }],
  [{ x: 0, y: 0 }, { x: 2, y: 2 }],
];

/**
 * A pillar is only placed where all 8 neighbours are plain floor, so it can never close
 * a passage, and pillars of a cluster never touch.
 */
function addPillarClusters(grid: Grid, keyPoints: readonly Coord[], sizeClass: SizeClass, rng: Rng): void {
  const clusters = rng.range(0, sizeClass === 'small' ? 1 : sizeClass === 'medium' ? 2 : 3);
  const open = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[y + dy]?.[x + dx] !== '.') return false;
    return true;
  };
  for (let i = 0; i < clusters; i++) {
    const anchors = floorCells(grid).filter((cell) => open(cell.x, cell.y));
    if (anchors.length === 0) return;
    const origin = rng.pick(anchors);
    for (const offset of rng.pick(CLUSTER_SHAPES)) {
      const x = origin.x + offset.x;
      const y = origin.y + offset.y;
      if (open(x, y) && !nearAny(keyPoints, x, y, 2)) grid[y]![x] = '#';
    }
  }
}

/** Hazard pools are walkable, but a hazard-free route between all key points must survive. */
function addHazardPools(grid: Grid, keyPoints: readonly Coord[], sizeClass: SizeClass, rng: Rng): void {
  const pools = rng.range(1, sizeClass === 'small' ? 1 : sizeClass === 'medium' ? 2 : 3);
  for (let i = 0; i < pools; i++) {
    const cells = floorCells(grid).filter((cell) => !nearAny(keyPoints, cell.x, cell.y, 2));
    if (cells.length === 0) return;
    const centre = rng.pick(cells);
    const radius = rng.range(1, sizeClass === 'small' ? 1 : 2);
    const painted: Coord[] = [];
    for (let y = centre.y - radius; y <= centre.y + radius; y++) {
      for (let x = centre.x - radius; x <= centre.x + radius; x++) {
        const ragged = Math.abs(x - centre.x) + Math.abs(y - centre.y) > radius + (rng.chance(0.5) ? 1 : 0);
        if (ragged || grid[y]?.[x] !== '.' || nearAny(keyPoints, x, y, 1)) continue;
        grid[y]![x] = '~';
        painted.push({ x, y });
      }
    }
    const dry = flood(grid, keyPoints[0]!, (ch) => ch !== '~');
    if (!keyPoints.every((point) => dry.has(key(point.x, point.y)))) for (const cell of painted) grid[cell.y]![cell.x] = '.';
  }
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

/** Carves an L-shaped floor corridor from any unreachable key point to the spawn. Interior tiles only. */
export function repairConnectivity(grid: Grid, spawn: Coord, keyPoints: readonly Coord[]): void {
  for (const point of keyPoints) {
    if (flood(grid, spawn).has(key(point.x, point.y))) continue;
    let { x, y } = point;
    const carve = () => {
      const ch = grid[y]![x]!;
      if (ch === '#' || ch === ' ') grid[y]![x] = '.';
    };
    carve();
    while (x !== spawn.x) {
      x += Math.sign(spawn.x - x);
      carve();
    }
    while (y !== spawn.y) {
      y += Math.sign(spawn.y - y);
      carve();
    }
  }
}

/** 4-connected flood fill over walkable tiles. `allow` can narrow what counts as walkable. */
export function flood(
  grid: ReadonlyArray<ReadonlyArray<string>> | readonly string[],
  from: Coord,
  allow: (ch: string) => boolean = () => true,
  blocked: ReadonlySet<string> = new Set(),
): Set<string> {
  const seen = new Set<string>([key(from.x, from.y)]);
  const stack: Coord[] = [from];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const side of DOOR_SIDES) {
      const x = current.x + SIDE_DELTA[side].dx;
      const y = current.y + SIDE_DELTA[side].dy;
      const ch = grid[y]?.[x];
      const id = key(x, y);
      if (ch === undefined || ch === '#' || ch === ' ' || seen.has(id) || blocked.has(id) || !allow(ch)) continue;
      seen.add(id);
      stack.push({ x, y });
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

function placeProps(
  grid: Grid,
  brief: BiomeBrief,
  room: FloorRoom,
  isFinalExit: boolean,
  focus: Coord,
  keyPoints: readonly Coord[],
  blocked: Set<string>,
  occupied: Set<string>,
  rng: Rng,
): BuiltProp[] {
  const props: BuiltProp[] = [];
  const idFor = () => `${room.id}.p${props.length}`;
  if (isFinalExit) {
    props.push({ id: idFor(), propId: 'anchor_pedestal', x: focus.x, y: focus.y });
    occupied.add(key(focus.x, focus.y));
  }
  const pool = brief.propPool.filter((id) => id !== 'anchor_pedestal');
  if (pool.length === 0) return props;
  const [min, max] = PROP_RANGE[room.sizeClass];
  const wanted = QUIET_KINDS.has(room.kind) ? rng.range(1, 3) : rng.range(min, max);
  const cells = rng.shuffle(floorCells(grid).filter((cell) => !nearAny(keyPoints, cell.x, cell.y, 2)));
  const origin = keyPoints[0]!;

  for (let i = 0; i < wanted; i++) {
    const propId: PropId = rng.pick(pool);
    const { blocksMovement, footprint } = PROP_INFO[propId];
    for (const cell of cells) {
      const covered: Coord[] = [];
      for (let dy = 0; dy < footprint.h; dy++) for (let dx = 0; dx < footprint.w; dx++) covered.push({ x: cell.x + dx, y: cell.y + dy });
      const fits = covered.every((c) => grid[c.y]?.[c.x] === '.' && !occupied.has(key(c.x, c.y)) && !nearAny(keyPoints, c.x, c.y, 2));
      if (!fits) continue;
      if (blocksMovement) {
        // A blocking prop must not cut any key point off, even along the hazard-free route.
        const trial = new Set(blocked);
        for (const c of covered) trial.add(key(c.x, c.y));
        const reach = flood(grid, origin, (ch) => ch !== '~', trial);
        if (!keyPoints.every((point) => reach.has(key(point.x, point.y)))) continue;
        for (const c of covered) blocked.add(key(c.x, c.y));
      }
      for (const c of covered) occupied.add(key(c.x, c.y));
      props.push({ id: idFor(), propId, x: cell.x, y: cell.y });
      break;
    }
  }
  return props;
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

function placeEncounters(
  grid: Grid,
  brief: BiomeBrief,
  plan: FloorPlan,
  room: FloorRoom,
  isFinalExit: boolean,
  spawn: Coord,
  focus: Coord,
  doors: readonly RoomDoor[],
  blocked: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  rng: Rng,
): BuiltEncounter[] {
  const groups = rollEncounters(
    { brief, tier: plan.tier, kind: room.kind, depth: room.depth, maxDepth: plan.stats.maxDepth, sizeClass: room.sizeClass, isFinalExit },
    rng,
  );
  if (groups.length === 0) return [];

  const reachable = flood(grid, spawn, () => true, blocked);
  const avoid: Coord[] = [spawn, ...doors.map((door) => door.entry)];
  const standable = floorCells(grid).filter(
    (cell) => reachable.has(key(cell.x, cell.y)) && !occupied.has(key(cell.x, cell.y)) && !(cell.x === focus.x && cell.y === focus.y),
  );
  // Keep the largest door/spawn clearance that still leaves room for every group.
  let candidates: Coord[] = [];
  for (const clearance of [5, 4, 3, 2, 1]) {
    candidates = standable.filter((cell) => avoid.every((point) => manhattan(point, cell) >= clearance));
    if (candidates.length >= groups.length) break;
  }
  if (candidates.length === 0) return [];

  const taken: Coord[] = [];
  const encounters: BuiltEncounter[] = [];
  groups.forEach((group, index) => {
    let spot: Coord;
    if (group.role === 'guardian' || group.role === 'gatekeeper') {
      // Bosses stand guard next to the focus (pedestal / portal).
      spot = candidates.reduce((best, cell) => (manhattan(cell, focus) < manhattan(best, focus) ? cell : best), candidates[0]!);
    } else if (taken.length === 0) {
      spot = rng.pick(candidates);
    } else {
      // Farthest-point sampling spreads packs through the room.
      const spread = (cell: Coord) => Math.min(...taken.map((other) => manhattan(other, cell)));
      spot = candidates.reduce((best, cell) => (spread(cell) > spread(best) ? cell : best), candidates[0]!);
    }
    taken.push(spot);
    encounters.push({ id: `${room.id}.e${index}`, enemyId: group.enemyId, x: spot.x, y: spot.y, count: group.count, role: group.role });
  });
  return encounters;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function isWalkable(grid: Grid, x: number, y: number): boolean {
  const ch = grid[y]?.[x];
  return ch !== undefined && ch !== '#' && ch !== ' ';
}

function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearAny(points: readonly Coord[], x: number, y: number, chebyshev: number): boolean {
  return points.some((point) => Math.max(Math.abs(point.x - x), Math.abs(point.y - y)) <= chebyshev);
}

/** Plain '.' interior cells in row-major order (stable, so seeded picks are reproducible). */
function floorCells(grid: Grid): Coord[] {
  const cells: Coord[] = [];
  for (let y = 1; y < grid.length - 1; y++) {
    const row = grid[y]!;
    for (let x = 1; x < row.length - 1; x++) if (row[x] === '.') cells.push({ x, y });
  }
  return cells;
}

function findTile(grid: Grid, tile: string): Coord | undefined {
  for (let y = 0; y < grid.length; y++) {
    const x = grid[y]!.indexOf(tile);
    if (x >= 0) return { x, y };
  }
  return undefined;
}

function nearestFloor(grid: Grid, target: Coord): Coord {
  const cells = floorCells(grid);
  if (cells.length === 0) return target;
  return cells.reduce((best, cell) => (manhattan(cell, target) < manhattan(best, target) ? cell : best), cells[0]!);
}
