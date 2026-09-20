/**
 * Floor-plan generator — The Binding of Isaac's algorithm, with a layout personality.
 *
 * Owner: Agent F1a (floors). Pure and deterministic: (brief, tier, seed) → FloorPlan.
 *
 * Isaac (Boris the Brave, 2020): breadth-first growth from the grid centre. For each
 * cardinal neighbour of the dequeued cell, give up if it is occupied / it already has
 * more than one filled neighbour / the room budget is reached / a 50 % coin flip says
 * so. Cells that place no neighbour are dead ends; the boss room is the farthest dead
 * end; other specials take random dead ends; invalid maps are thrown away and rebuilt;
 * big maps re-queue the start cell periodically.
 *
 * The ">1 filled neighbour" rule means a new cell only ever touches its parent, so the
 * floor is a TREE and every grid adjacency is a door. We keep that rule verbatim.
 *
 * Personality (BiomeLayout) bends three knobs only:
 *  - giveUp      Isaac's coin flip. Branchy floors give up less, linear floors more.
 *  - siblingStop after a cell has placed one child, each further child is refused with
 *                this probability. High linearity → one child per cell → a spine.
 *  - re-queue    when the queue runs dry below budget (Isaac would restart; we keep
 *                growing): linear floors extend the deepest tip, branchy floors sprout
 *                from a random room or the start.
 *
 * It can never fail: after MAX_ATTEMPTS invalid maps a deterministic "comb" plan is
 * returned (stats.usedFallback = true). Tests assert the fuzz never gets there.
 */
import {
  BiomeBriefSchema,
  DOOR_SIDES,
  MAX_ROOM_BUDGET,
  MIN_ROOM_BUDGET,
  ROOM_BUDGETS,
  SIDE_DELTA,
  type BiomeBrief,
  type BiomeSpecials,
  type DoorSide,
  type FloorDoors,
  type FloorPlan,
  type FloorRoom,
  type RoomKind,
} from '../floors';
import { createRng, seedKey, type Rng } from './rng';
import { pickTemplate } from './templates';

export const MAX_ATTEMPTS = 60;
/** Attempts after which dead-end specials are clamped to what the map offers instead of rejecting it. */
const STRICT_SPECIAL_ATTEMPTS = 40;

export interface FloorPlanOptions {
  /** Overrides ROOM_BUDGETS[tier]. Clamped to MIN_ROOM_BUDGET..MAX_ROOM_BUDGET. */
  roomBudget?: number;
}

interface Cell {
  x: number;
  y: number;
}

interface RawRoom extends Cell {
  index: number;
  parent: number;
  depth: number;
  children: number;
}

interface RawMap {
  width: number;
  height: number;
  rooms: RawRoom[];
}

/** Isaac's 9x8 up to 16 rooms, growing to 13x11 for 30. */
export function gridSizeFor(roomBudget: number): { width: number; height: number } {
  if (roomBudget <= 16) return { width: 9, height: 8 };
  if (roomBudget <= 20) return { width: 11, height: 9 };
  if (roomBudget <= 25) return { width: 12, height: 10 };
  if (roomBudget <= 30) return { width: 13, height: 11 };
  return { width: 15, height: 13 };
}

/** Minimum graph distance entrance → exit. 10→3, 15→3, 20→4, 25→5, 30→5. */
export function minExitDepth(roomBudget: number): number {
  return Math.max(3, Math.floor(Math.sqrt(roomBudget)));
}

/** How many dead-end specials (treasure + lore + rest) a floor of this size may hold. */
export function deadEndSpecialCap(roomBudget: number): number {
  return Math.floor(roomBudget / 4) + 1;
}

export function eliteCap(roomBudget: number): number {
  return Math.floor((roomBudget - 2) / 4);
}

const DEAD_END_KINDS = ['treasure', 'lore', 'rest'] as const;
type DeadEndKind = (typeof DEAD_END_KINDS)[number];

/**
 * Documented clamping: requests beyond the cap are trimmed one at a time from the kind
 * with the most requests (ties: treasure, then rest, then lore — lore is kept longest),
 * so one of each survives as long as possible.
 */
export function clampDeadEndSpecials(specials: BiomeSpecials, cap: number): Record<DeadEndKind, number> {
  const out = { treasure: specials.treasure, lore: specials.lore, rest: specials.rest };
  const trimOrder: readonly DeadEndKind[] = ['treasure', 'rest', 'lore'];
  while (out.treasure + out.lore + out.rest > Math.max(0, cap)) {
    let victim: DeadEndKind = 'treasure';
    for (const kind of trimOrder) if (out[kind] > out[victim]) victim = kind;
    out[victim]--;
  }
  return out;
}

export function generateFloorPlan(brief: BiomeBrief, tier: number, seed: string, options: FloorPlanOptions = {}): FloorPlan {
  const parsed = BiomeBriefSchema.parse(brief);
  const safeTier = Math.min(ROOM_BUDGETS.length - 1, Math.max(0, Math.floor(tier)));
  const budget = Math.min(MAX_ROOM_BUDGET, Math.max(MIN_ROOM_BUDGET, Math.floor(options.roomBudget ?? ROOM_BUDGETS[safeTier]!)));
  const floorSeed = seedKey(seed, parsed.id);
  const wanted = clampDeadEndSpecials(parsed.layout.specials, deadEndSpecialCap(budget));
  const wantedTotal = wanted.treasure + wanted.lore + wanted.rest;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rng = createRng(seedKey(floorSeed, 'plan', attempt));
    const map = growIsaac(budget, parsed.layout.linearity, parsed.layout.branchiness, wantedTotal, rng);
    if (map.rooms.length !== budget) continue;
    const needDeadEnds = attempt <= STRICT_SPECIAL_ATTEMPTS ? wantedTotal : 0;
    const exit = chooseExit(map, budget, needDeadEnds);
    if (!exit) continue;
    return finishPlan(parsed, safeTier, floorSeed, map, exit, wanted, attempt, false, rng);
  }

  const map = combFallback(budget);
  const exit = map.rooms.reduce((best, room) => (room.depth > best.depth ? room : best), map.rooms[0]!);
  const rng = createRng(seedKey(floorSeed, 'plan', 'fallback'));
  return finishPlan(parsed, safeTier, floorSeed, map, exit, wanted, MAX_ATTEMPTS, true, rng);
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

function growIsaac(budget: number, linearity: number, branchiness: number, reservedDeadEnds: number, rng: Rng): RawMap {
  const { width, height } = gridSizeFor(budget);
  const giveUp = clamp(0.5 + 0.3 * linearity - 0.35 * branchiness, 0.12, 0.85);
  const siblingStop = clamp(0.95 * linearity - 0.25 * branchiness, 0, 0.95);
  const grid = new Int16Array(width * height).fill(-1);
  const rooms: RawRoom[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? -2 : grid[y * width + x]!);
  const filledNeighbours = (x: number, y: number) => {
    let count = 0;
    for (const side of DOOR_SIDES) if (at(x + SIDE_DELTA[side].dx, y + SIDE_DELTA[side].dy) >= 0) count++;
    return count;
  };
  const place = (x: number, y: number, parent: number) => {
    const room: RawRoom = { x, y, index: rooms.length, parent, depth: parent < 0 ? 0 : rooms[parent]!.depth + 1, children: 0 };
    grid[y * width + x] = room.index;
    rooms.push(room);
    if (parent >= 0) rooms[parent]!.children++;
    return room;
  };
  /** A room can still grow if some neighbour cell is free and touches nothing but it. */
  const canGrow = (room: RawRoom) =>
    DOOR_SIDES.some((side) => {
      const nx = room.x + SIDE_DELTA[side].dx;
      const ny = room.y + SIDE_DELTA[side].dy;
      return at(nx, ny) === -1 && filledNeighbours(nx, ny) <= 1;
    });

  const start = place(Math.floor(width / 2), Math.floor(height / 2), -1);
  const queue: RawRoom[] = [start];
  const reseedEvery = budget > 16 ? 6 : 0;
  let dequeued = 0;
  let guard = budget * 80;

  const grow = (target: number) => {
    while (rooms.length < target && guard-- > 0) {
      let room = queue.shift();
      if (!room) {
        const growable = rooms.filter(canGrow);
        if (growable.length === 0) break;
        if (rng.chance(linearity)) {
          room = growable.reduce((best, candidate) => (candidate.depth >= best.depth ? candidate : best), growable[0]!);
        } else {
          room = rng.chance(0.35) && canGrow(start) ? start : rng.pick(growable);
        }
      }
      dequeued++;
      // Isaac: large maps periodically re-queue the start room so they do not starve.
      if (reseedEvery > 0 && dequeued % reseedEvery === 0 && !rng.chance(linearity)) queue.push(start);

      for (const side of rng.shuffle(DOOR_SIDES)) {
        if (rooms.length >= target) break;
        const nx = room.x + SIDE_DELTA[side].dx;
        const ny = room.y + SIDE_DELTA[side].dy;
        if (at(nx, ny) !== -1) continue; // occupied or off-grid
        if (filledNeighbours(nx, ny) > 1) continue; // would close a loop
        if (rng.chance(giveUp)) continue; // Isaac's coin flip
        const spineChildren = room.parent < 0 ? room.children - 1 : room.children;
        if (spineChildren >= 1 && rng.chance(siblingStop)) continue; // linear floors keep one child
        queue.push(place(nx, ny, room.index));
      }
    }
  };

  // Phase 1: Isaac growth, holding back one room per requested dead-end special.
  const reserve = Math.min(reservedDeadEnds, Math.max(0, budget - 4));
  grow(budget - reserve);

  // Phase 2: a spine has almost no natural dead ends, so the shortfall is added as
  // one-room stubs on through-rooms (same neighbour rule, so still a tree). Bushy floors
  // already have enough dead ends and skip this.
  const naturalDeadEnds = rooms.filter((room) => room.parent >= 0 && room.children === 0).length - 1;
  let shortfall = Math.min(reserve, Math.max(0, reservedDeadEnds - naturalDeadEnds));
  if (shortfall > 0) {
    for (const host of rng.shuffle(rooms.filter((room) => room.parent < 0 || room.children > 0))) {
      if (shortfall === 0) break;
      for (const side of rng.shuffle(DOOR_SIDES)) {
        const nx = host.x + SIDE_DELTA[side].dx;
        const ny = host.y + SIDE_DELTA[side].dy;
        if (at(nx, ny) !== -1 || filledNeighbours(nx, ny) > 1) continue;
        place(nx, ny, host.index);
        shortfall--;
        break;
      }
    }
  }

  // Phase 3: spend whatever budget is left with the normal rules.
  grow(budget);
  return { width, height, rooms };
}

/**
 * Deterministic last resort: a horizontal spine with vertical teeth on every other
 * column. Teeth never touch each other, so it is a valid tree for every budget in range.
 */
export function combFallback(budget: number): RawMap {
  const { width, height } = gridSizeFor(budget);
  const mid = Math.floor(height / 2);
  const spineLength = Math.min(width, Math.max(4, Math.ceil(budget / 2)));
  const rooms: RawRoom[] = [];
  const add = (x: number, y: number, parent: number) => {
    const room: RawRoom = { x, y, index: rooms.length, parent, depth: parent < 0 ? 0 : rooms[parent]!.depth + 1, children: 0 };
    rooms.push(room);
    if (parent >= 0) rooms[parent]!.children++;
    return room;
  };
  const spine: RawRoom[] = [];
  for (let x = 0; x < spineLength && rooms.length < budget; x++) spine.push(add(x, mid, x === 0 ? -1 : spine[x - 1]!.index));
  const teeth: Array<{ tip: RawRoom; dy: number }> = [];
  for (let x = 1; x <= spineLength - 2; x += 2) {
    teeth.push({ tip: spine[x]!, dy: -1 }, { tip: spine[x]!, dy: 1 });
  }
  let grew = true;
  while (rooms.length < budget && grew) {
    grew = false;
    for (const tooth of teeth) {
      if (rooms.length >= budget) break;
      const ny = tooth.tip.y + tooth.dy;
      if (ny < 0 || ny >= height) continue;
      tooth.tip = add(tooth.tip.x, ny, tooth.tip.index);
      grew = true;
    }
  }
  return { width, height, rooms };
}

// ---------------------------------------------------------------------------
// Validation + kind assignment
// ---------------------------------------------------------------------------

function isDeadEnd(room: RawRoom): boolean {
  return room.parent >= 0 && room.children === 0;
}

/** Farthest dead end, if it is far enough, not next to the entrance, and leaves enough other dead ends. */
function chooseExit(map: RawMap, budget: number, needDeadEnds: number): RawRoom | undefined {
  const start = map.rooms[0]!;
  const deadEnds = map.rooms.filter(isDeadEnd);
  if (deadEnds.length === 0) return undefined;
  // Ties go to the most recently placed room, like Isaac's "last end room".
  const exit = deadEnds.reduce((best, room) => (room.depth >= best.depth ? room : best), deadEnds[0]!);
  if (exit.depth < minExitDepth(budget)) return undefined;
  if (Math.abs(exit.x - start.x) + Math.abs(exit.y - start.y) <= 1) return undefined;
  if (deadEnds.length - 1 < needDeadEnds) return undefined;
  return exit;
}

function finishPlan(
  brief: BiomeBrief,
  tier: number,
  floorSeed: string,
  map: RawMap,
  exit: RawRoom,
  wanted: Record<DeadEndKind, number>,
  attempts: number,
  usedFallback: boolean,
  rng: Rng,
): FloorPlan {
  const budget = map.rooms.length;
  const kinds: RoomKind[] = map.rooms.map(() => 'combat');
  kinds[0] = 'entrance';
  kinds[exit.index] = 'exit';

  // Dead-end specials. Deepest dead ends first so the reward sits at the end of a detour;
  // kinds are dealt round-robin so a short supply still yields one of each.
  const deadEnds = rng
    .shuffle(map.rooms.filter((room) => isDeadEnd(room) && room.index !== exit.index))
    .sort((a, b) => b.depth - a.depth);
  const remaining = { ...wanted };
  const placed: BiomeSpecials = { treasure: 0, lore: 0, rest: 0, elite: 0 };
  let cursor = 0;
  while (cursor < deadEnds.length && remaining.treasure + remaining.lore + remaining.rest > 0) {
    for (const kind of DEAD_END_KINDS) {
      if (remaining[kind] <= 0 || cursor >= deadEnds.length) continue;
      kinds[deadEnds[cursor++]!.index] = kind;
      remaining[kind]--;
      placed[kind]++;
    }
  }

  // Elites sit on through-rooms (so a linear biome can be "a spine of elites"), never
  // within two steps of the entrance; leftover dead ends are used only if needed.
  const eliteWanted = Math.min(brief.layout.specials.elite, eliteCap(budget));
  const eliteSpots = rng.shuffle(map.rooms.filter((room) => kinds[room.index] === 'combat' && room.depth >= 2));
  const ordered = [...eliteSpots.filter((room) => !isDeadEnd(room)), ...eliteSpots.filter(isDeadEnd)];
  for (const room of ordered.slice(0, eliteWanted)) {
    kinds[room.index] = 'elite';
    placed.elite++;
  }

  const idOf = (index: number) => `r${String(index).padStart(2, '0')}`;
  const doorsOf = (room: RawRoom): FloorDoors => {
    const doors: FloorDoors = {};
    const link = (other: RawRoom) => {
      const side = DOOR_SIDES.find((s) => room.x + SIDE_DELTA[s].dx === other.x && room.y + SIDE_DELTA[s].dy === other.y);
      if (side) doors[side] = idOf(other.index);
    };
    if (room.parent >= 0) link(map.rooms[room.parent]!);
    for (const other of map.rooms) if (other.parent === room.index) link(other);
    // Stable key order (n, s, e, w) so JSON output is byte-identical across runs.
    const sorted: FloorDoors = {};
    for (const side of DOOR_SIDES) if (doors[side] !== undefined) sorted[side] = doors[side];
    return sorted;
  };

  const rooms: FloorRoom[] = map.rooms.map((room) => {
    const doors = doorsOf(room);
    const sides = DOOR_SIDES.filter((side) => doors[side] !== undefined);
    const kind = kinds[room.index]!;
    const templateRng = createRng(seedKey(floorSeed, 'template', room.index));
    const template = pickTemplate(kind, sides, brief.motifIds, tier, templateRng);
    return { id: idOf(room.index), cell: { x: room.x, y: room.y }, kind, doors, depth: room.depth, templateId: template.id, sizeClass: template.sizeClass };
  });

  return {
    biomeId: brief.id,
    tier,
    seed: floorSeed,
    grid: { width: map.width, height: map.height },
    rooms,
    entranceId: idOf(0),
    exitId: idOf(exit.index),
    stats: {
      attempts,
      usedFallback,
      deadEnds: map.rooms.filter(isDeadEnd).length,
      maxDepth: map.rooms.reduce((max, room) => Math.max(max, room.depth), 0),
      specials: placed,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers shared with tests / debug
// ---------------------------------------------------------------------------

export function roomById(plan: FloorPlan, roomId: string): FloorRoom | undefined {
  return plan.rooms.find((room) => room.id === roomId);
}

export function doorSides(room: FloorRoom): DoorSide[] {
  return DOOR_SIDES.filter((side) => room.doors[side] !== undefined);
}

const KIND_GLYPH: Record<RoomKind, string> = {
  entrance: 'S',
  combat: 'o',
  elite: 'E',
  treasure: 'T',
  lore: 'L',
  rest: 'R',
  exit: 'X',
  shop: '$',
};

/**
 * ASCII debug print. Rooms are glyphs (S start, o combat, E elite, T treasure, L lore,
 * R rest, X exit), doors are '-' and '|'. Empty border rows/columns are trimmed.
 */
export function renderFloorPlan(plan: FloorPlan): string {
  const xs = plan.rooms.map((room) => room.cell.x);
  const ys = plan.rooms.map((room) => room.cell.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const cols = (Math.max(...xs) - minX) * 2 + 1;
  const rows = (Math.max(...ys) - minY) * 2 + 1;
  const canvas = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ' '));
  for (const room of plan.rooms) {
    const cx = (room.cell.x - minX) * 2;
    const cy = (room.cell.y - minY) * 2;
    canvas[cy]![cx] = KIND_GLYPH[room.kind];
    if (room.doors.e !== undefined) canvas[cy]![cx + 1] = '-';
    if (room.doors.s !== undefined) canvas[cy + 1]![cx] = '|';
  }
  return canvas.map((row) => row.join('').replace(/\s+$/, '')).join('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
