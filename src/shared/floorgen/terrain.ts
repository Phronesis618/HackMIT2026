/**
 * Terrain mutator — PR #16's RoomTerrain {features, layout, density} applied to a BuiltRoom.
 *
 * Owner: Agent F1b (floors core). Pure and deterministic.
 *
 * This is a port of `applyTerrain` in src/server/generation/compiler.ts (same stamps, same
 * counts) that runs AFTER `buildRoom` instead of inside a corridor room. The legacy version
 * protects a central path row; here the protected area is the assembler's own rule: a
 * 2-tile Chebyshev margin around the spawn, the focus and every door entry, plus every
 * prop footprint and encounter tile.
 *
 *  - rubble ':' and conduits '+' replace plain floor and stay walkable;
 *  - breakable walls 'B' replace interior '#' and stay solid (breaking one only opens routes);
 *  - a bridge stamps a NEW wall run with a '=' crossing and '>' ramps. It is the only stamp
 *    that can cut a route, so each one is kept only if every tile that was reachable from
 *    the spawn (no '~', no 'B', props in place) is still reachable. `flood` is floorgen's.
 */
import type { BiomeTerrain, BuiltRoom } from '../floors';
import { PROP_INFO } from '../registry';
import { createRng, seedKey, type Rng } from './rng';
import { flood } from './rooms';

type Grid = string[][];
interface Coord { x: number; y: number }

const key = (x: number, y: number) => `${x},${y}`;
const MARGIN = 2;
const MAX_BRIDGE_TRIES = 48;
/**
 * Walkable for the reachability check: hazards, unbroken bulkheads and solid canisters do not
 * count. This is TILES.md R4 — the room must be beatable by a crew that refuses to touch any
 * of it — and the reason terrain can only ever be an additive layer over floorgen's guarantee.
 */
const safeGround = (ch: string) => ch !== '~' && ch !== 'B' && ch !== '*' && ch !== 'o';
/** Per-room caps from TILES.md S8. */
const MAX_CANISTERS = 3;
const MAX_PIT_BLOBS = 2;
const PIT_BLOB_MIN = 2;
const PIT_BLOB_MAX = 6;
const MAX_VENT_FIELDS = 2;
const MAX_COVER_RUNS = 3;
/** Features that can hurt somebody; kept out of boss arenas. */
const DAMAGING_FEATURES = ['hazard_floor', 'vents', 'pits', 'canisters'] as const;
/** How often a fighting room is a loud one. Deterministic per room: same seed, same rooms. */
const DAMAGING_ROOM_CHANCE = 0.4;
const COVER_RUN_MIN = 2;
const COVER_RUN_MAX = 4;
/** Cover against a wall does nothing: it has to be out in the open to break a firing line. */
const COVER_WALL_CLEARANCE = 3;

/** Returns the room's tile rows with terrain applied. `room` is not mutated. */
export function applyBiomeTerrain(room: BuiltRoom, terrain: BiomeTerrain, seed: string): string[] {
  const rng = createRng(seedKey(seed, room.address.biomeId, 'terrain', room.address.roomId));
  const grid: Grid = room.tiles.map((row) => [...row]);
  const keyPoints: Coord[] = [room.spawn, room.focus, ...room.doors.map((door) => door.entry)];
  const taken = new Set<string>();
  const blocked = new Set<string>();
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    for (let dy = 0; dy < info.footprint.h; dy++) {
      for (let dx = 0; dx < info.footprint.w; dx++) {
        taken.add(key(prop.x + dx, prop.y + dy));
        if (info.blocksMovement) blocked.add(key(prop.x + dx, prop.y + dy));
      }
    }
  }
  for (const encounter of room.encounters) taken.add(key(encounter.x, encounter.y));
  const free = (x: number, y: number) =>
    grid[y]?.[x] === '.' && !taken.has(key(x, y)) &&
    !keyPoints.some((point) => Math.max(Math.abs(point.x - x), Math.abs(point.y - y)) <= MARGIN);

  const features = new Set(terrain.features);
  // The room where a biome's gatekeeper or the Anchor stands keeps its structure and its cover,
  // and none of the damaging tiles: a boss fight has to be decided by reading the boss, not by
  // whatever the floor happened to roll (BOSS_FINALE's legibility rule, TILES.md S9 generalised).
  // Not every room is a hazard room. A biome that asks for damaging terrain gets it in a
  // minority of its rooms, so a floor has quiet rooms and loud ones and the chip damage of
  // crossing ten of them never adds up to the fight at the end of them.
  const bossArena = room.kind === 'exit' || room.feature === 'anchor';
  const damaging = !bossArena && rng.chance(DAMAGING_ROOM_CHANCE);
  if (!damaging) for (const id of DAMAGING_FEATURES) features.delete(id);
  // Cover goes too: a barricade that eats the crew's own bolts turns the one fight that has to
  // be readable into a line-of-sight puzzle against a boss that does not care about either.
  if (bossArena) features.delete('cover');
  const density = terrain.density === 'sparse' ? 1 : terrain.density === 'dense' ? 3 : 2;
  const cells: Coord[] = [];
  for (let y = 1; y < room.height - 1; y++) for (let x = 1; x < room.width - 1; x++) if (free(x, y)) cells.push({ x, y });
  // `layout` and `hazardBias` are hints about WHERE terrain prefers to sit, never about whether
  // a room stays playable: they only reorder the candidates every stamp walks (TILES.md §4.2).
  const order = biasOrder(rng.shuffle(cells), terrain, room.width, room.height);

  if (features.has('bridges')) stampBridges(grid, order, free, terrain, density, room.spawn, blocked, rng);
  if (features.has('breakable_walls')) stampBreakableWalls(grid, density, rng);
  const reachPoints = [...keyPoints, ...room.encounters.map((e) => ({ x: e.x, y: e.y }))];
  if (features.has('pits')) stampPits(grid, order, free, density, room.spawn, reachPoints, blocked, rng);
  if (features.has('canisters')) stampCanisters(grid, order, free, density, room.spawn, reachPoints, blocked);
  if (features.has('vents')) stampVents(grid, order, free, density, room.spawn, reachPoints, blocked, rng);
  if (features.has('cover')) stampCover(grid, order, free, density, room.width, room.height, terrain.layout, rng);
  for (const feature of ['rubble', 'conduits'] as const) {
    if (!features.has(feature)) continue;
    const offsets = feature === 'rubble'
      ? [[0, 0], [1, 0], [0, 1], [1, 1]]
      : terrain.layout === 'crossroads'
        ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
        : [[0, 0], [1, 0], [2, 0], [3, 0]];
    let placed = 0;
    for (const center of order) {
      const patch = offsets.map(([dx, dy]) => ({ x: center.x + dx!, y: center.y + dy! }));
      if (!patch.every(({ x, y }) => free(x, y))) continue;
      for (const { x, y } of patch) grid[y]![x] = feature === 'rubble' ? ':' : '+';
      if (++placed >= density) break;
    }
  }

  // Belt and braces: the stamps above cannot cut a route, but a room with an unreachable door is unplayable.
  const reach = flood(grid, room.spawn, safeGround, blocked);
  if (keyPoints.some((point) => !reach.has(key(point.x, point.y)))) return [...room.tiles];
  return grid.map((row) => row.join(''));
}

function stampBridges(
  grid: Grid, order: readonly Coord[], free: (x: number, y: number) => boolean, terrain: BiomeTerrain,
  density: number, spawn: Coord, blocked: ReadonlySet<string>, rng: Rng,
): void {
  const halfLength = terrain.layout === 'barricades' ? 3 : 2;
  const wanted = density === 3 ? 2 : 1;
  const scatteredAxis = rng.chance(0.5);
  let placed = 0;
  for (const center of order.slice(0, MAX_BRIDGE_TRIES)) {
    const horizontal = terrain.layout === 'barricades' ? false : terrain.layout === 'crossroads' ? placed % 2 === 0 : scatteredAxis;
    for (const horizontalWall of [horizontal, !horizontal]) {
      const at = (along: number, across: number): Coord => ({
        x: center.x + (horizontalWall ? along : across),
        y: center.y + (horizontalWall ? across : along),
      });
      const footprint: Coord[] = [];
      for (let along = -halfLength; along <= halfLength; along++) for (let across = -1; across <= 1; across++) footprint.push(at(along, across));
      if (!footprint.every(({ x, y }) => free(x, y))) continue;
      const before = flood(grid, spawn, safeGround, blocked);
      const saved = footprint.map(({ x, y }) => grid[y]![x]!);
      for (let along = -halfLength; along <= halfLength; along++) {
        const wall = at(along, 0);
        grid[wall.y]![wall.x] = '#';
      }
      grid[center.y]![center.x] = '=';
      for (const side of [-1, 1]) {
        const ramp = at(0, side);
        grid[ramp.y]![ramp.x] = '>';
      }
      const after = flood(grid, spawn, safeGround, blocked);
      const cut = [...before].some((id) => {
        if (after.has(id)) return false;
        const [x, y] = id.split(',').map(Number) as [number, number];
        return grid[y]![x] !== '#';
      });
      if (cut) {
        footprint.forEach(({ x, y }, i) => { grid[y]![x] = saved[i]!; });
        continue;
      }
      placed++;
      break;
    }
    if (placed >= wanted) return;
  }
}

/**
 * Reorder candidate cells by the room's stated preference. 'arena' rings the perimeter,
 * 'gauntlet' prefers lanes, and `hazardBias` overrides the layout's own default when given.
 * A stable sort over an already-shuffled list keeps this deterministic and still varied.
 */
function biasOrder(cells: readonly Coord[], terrain: BiomeTerrain, width: number, height: number): Coord[] {
  const bias = terrain.hazardBias ?? (terrain.layout === 'arena' ? 'edges' : terrain.layout === 'gauntlet' ? 'lanes' : 'none');
  if (bias === 'none') return [...cells];
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const score = (cell: Coord): number => {
    const fromCentre = Math.max(Math.abs(cell.x - cx) / Math.max(1, cx), Math.abs(cell.y - cy) / Math.max(1, cy));
    if (bias === 'edges') return -fromCentre;
    if (bias === 'centre') return fromCentre;
    // lanes: prefer cells sitting on every third line of the room's long axis.
    return (width >= height ? cell.y : cell.x) % 3;
  };
  return [...cells].sort((a, b) => score(a) - score(b));
}

/**
 * Cover runs are 2-4 tiles laid across the room's short axis, so they cut the long sight lines
 * a sentinel or a warden wants (TILES.md T4). At least three tiles from any wall, because cover
 * with your back to a wall breaks no line anyone was using. Walkable, so reachability is free.
 */
function stampCover(
  grid: Grid, order: readonly Coord[], free: (x: number, y: number) => boolean, density: number,
  width: number, height: number, layout: BiomeTerrain['layout'], rng: Rng,
): void {
  // Perpendicular to the long axis, so a run cuts the long sight lines — except in a
  // 'gauntlet', where the whole point is lanes running WITH the long axis.
  const across = width >= height ? [0, 1] : [1, 0];
  const along = width >= height ? [1, 0] : [0, 1];
  const [dx, dy] = layout === 'gauntlet' ? along : across;
  const wanted = Math.min(MAX_COVER_RUNS, density);
  let placed = 0;
  for (const start of order) {
    if (placed >= wanted) return;
    const length = COVER_RUN_MIN + rng.range(0, COVER_RUN_MAX - COVER_RUN_MIN);
    const run: Coord[] = [];
    for (let i = 0; i < length; i++) run.push({ x: start.x + dx * i, y: start.y + dy * i });
    if (!run.every(({ x, y }) =>
      free(x, y) &&
      x >= COVER_WALL_CLEARANCE && x < width - COVER_WALL_CLEARANCE &&
      y >= COVER_WALL_CLEARANCE && y < height - COVER_WALL_CLEARANCE &&
      ![-1, 0, 1].some((ny) => [-1, 0, 1].some((nx) => grid[y + ny]?.[x + nx] === '-')))) continue;
    for (const cell of run) grid[cell.y]![cell.x] = '-';
    placed++;
  }
}

/**
 * Vents come in fields: a 2x2 to 3x3 block, one or two per room (TILES.md T3, S8). They are
 * walkable, so R4 is free; the rule that matters is S2's hazard-free route, which a field can
 * take away by plugging the last clean corridor. Same place-and-revert discipline as the rest.
 */
function stampVents(
  grid: Grid, order: readonly Coord[], free: (x: number, y: number) => boolean, density: number,
  spawn: Coord, reachPoints: readonly Coord[], blocked: ReadonlySet<string>, rng: Rng,
): void {
  const dryGround = (ch: string) => safeGround(ch) && ch !== '~' && ch !== '^';
  const wanted = Math.min(MAX_VENT_FIELDS, density === 1 ? 1 : 2);
  let placed = 0;
  for (const corner of order) {
    if (placed >= wanted) return;
    const side = rng.chance(0.5) ? 2 : 3; // 4 or 9 tiles, both inside S8's 4..9 band
    const field: Coord[] = [];
    for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) field.push({ x: corner.x + dx, y: corner.y + dy });
    // Never adjacent to another field, or two of them read (and validate) as one.
    if (!field.every(({ x, y }) => free(x, y) &&
      ![-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => grid[y + dy]?.[x + dx] === '^')))) continue;
    const beforeDry = flood(grid, spawn, dryGround, blocked);
    for (const cell of field) grid[cell.y]![cell.x] = '^';
    const afterDry = flood(grid, spawn, dryGround, blocked);
    if (!reachPoints.every((point) => !beforeDry.has(key(point.x, point.y)) || afterDry.has(key(point.x, point.y)))) {
      for (const cell of field) grid[cell.y]![cell.x] = '.';
      continue;
    }
    placed++;
  }
}

/**
 * Pits are carved as blobs of 2-6 tiles, never a one-tile dot (reads as a bug) and never a
 * full-width band (reads as a wall). A pit is solid to boots, so every blob is checked the same
 * way a bridge is: place it, and if any key point or encounter lost its route — with or without
 * stepping on a hazard — put the floor back. TILES.md T2 and S8.
 */
function stampPits(
  grid: Grid, order: readonly Coord[], free: (x: number, y: number) => boolean, density: number,
  spawn: Coord, reachPoints: readonly Coord[], blocked: ReadonlySet<string>, rng: Rng,
): void {
  const dryGround = (ch: string) => safeGround(ch) && ch !== '~';
  const keeps = (after: Set<string>, before: Set<string>) =>
    reachPoints.every((point) => !before.has(key(point.x, point.y)) || after.has(key(point.x, point.y)));
  const wanted = Math.min(MAX_PIT_BLOBS, density === 1 ? 1 : 2);
  // Two blobs that touch read as one big one, and S8 counts them as one: keep them apart.
  const clear = (x: number, y: number) => free(x, y) &&
    ![-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => grid[y + dy]?.[x + dx] === 'o'));
  let placed = 0;
  for (const centre of order) {
    if (placed >= wanted) return;
    if (!clear(centre.x, centre.y)) continue;
    // Grow a 4-connected blob outward from the centre; the shuffle keeps its shape ragged.
    // 4-connected matters: a diagonal-only neighbour would read (and validate) as a second pit.
    const size = PIT_BLOB_MIN + rng.range(0, PIT_BLOB_MAX - PIT_BLOB_MIN);
    const blob: Coord[] = [centre];
    const frontier: Coord[] = [centre];
    while (blob.length < size && frontier.length > 0) {
      const from = frontier.shift()!;
      for (const [dx, dy] of rng.shuffle([[1, 0], [0, 1], [-1, 0], [0, -1]])) {
        if (blob.length >= size) break;
        const cell = { x: from.x + dx!, y: from.y + dy! };
        if (blob.some((b) => b.x === cell.x && b.y === cell.y) || !clear(cell.x, cell.y)) continue;
        blob.push(cell);
        frontier.push(cell);
      }
    }
    if (blob.length < PIT_BLOB_MIN) continue;
    const before = flood(grid, spawn, safeGround, blocked);
    const beforeDry = flood(grid, spawn, dryGround, blocked);
    for (const cell of blob) grid[cell.y]![cell.x] = 'o';
    if (!keeps(flood(grid, spawn, safeGround, blocked), before) ||
        !keeps(flood(grid, spawn, dryGround, blocked), beforeDry)) {
      for (const cell of blob) grid[cell.y]![cell.x] = '.';
      continue;
    }
    placed++;
  }
}

/**
 * '*' canisters are solid until something shoots them, so one must never be the narrow part of
 * a route: they only go on floor with at least 6 of its 8 neighbours open, which is the middle
 * of a room rather than a corridor. Keeping them two tiles apart stops a carpet of them while
 * staying inside the 76 px blast radius, so a chain is a read the player can find rather than
 * a default. The belt-and-braces flood at the end of `applyBiomeTerrain` re-checks R4 anyway.
 */
function stampCanisters(
  grid: Grid, order: readonly Coord[], free: (x: number, y: number) => boolean, density: number,
  spawn: Coord, reachPoints: readonly Coord[], blocked: ReadonlySet<string>,
): void {
  const placed: Coord[] = [];
  const open = (x: number, y: number) => {
    const ch = grid[y]?.[x];
    return ch !== undefined && ch !== '#' && ch !== ' ' && ch !== 'B' && ch !== '*';
  };
  const dryGround = (ch: string) => safeGround(ch) && ch !== '~';
  // What was reachable before any canister, with and without stepping on a hazard. A canister
  // may never take either of those away from a point the crew has to get to.
  const beforeSafe = flood(grid, spawn, safeGround, blocked);
  const beforeDry = flood(grid, spawn, dryGround, blocked);
  const keeps = (after: Set<string>, before: Set<string>) =>
    reachPoints.every((point) => !before.has(key(point.x, point.y)) || after.has(key(point.x, point.y)));
  for (const cell of order) {
    if (placed.length >= Math.min(MAX_CANISTERS, density)) return;
    if (!free(cell.x, cell.y)) continue;
    let openNeighbours = 0;
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) if ((dx || dy) && open(cell.x + dx, cell.y + dy)) openNeighbours++;
    if (openNeighbours < 6) continue;
    if (placed.some((p) => Math.max(Math.abs(p.x - cell.x), Math.abs(p.y - cell.y)) < 2)) continue;
    grid[cell.y]![cell.x] = '*';
    // Six open neighbours is not proof: a tile can sit in the neck of an alcove and still pass.
    if (!keeps(flood(grid, spawn, safeGround, blocked), beforeSafe) ||
        !keeps(flood(grid, spawn, dryGround, blocked), beforeDry)) {
      grid[cell.y]![cell.x] = '.';
      continue;
    }
    placed.push(cell);
  }
}

/** Interior walls only, never next to a bridge or the void; walls with floor on two opposite sides first (breaking them opens a shortcut). */
function stampBreakableWalls(grid: Grid, density: number, rng: Rng): void {
  const height = grid.length;
  const width = grid[0]!.length;
  const open = (x: number, y: number) => { const ch = grid[y]?.[x]; return ch !== undefined && ch !== '#' && ch !== ' ' && ch !== 'B'; };
  const walls: Array<Coord & { shortcut: boolean }> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (grid[y]![x] !== '#') continue;
      const around = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
      if (around.some(([dx, dy]) => grid[y + dy]![x + dx] === '=')) continue;
      if (!around.some(([dx, dy]) => open(x + dx, y + dy))) continue;
      // Never on the room's outer shell: a broken bulkhead must not open onto the void.
      if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (grid[y + dy]?.[x + dx] ?? ' ') === ' '))) continue;
      walls.push({ x, y, shortcut: (open(x - 1, y) && open(x + 1, y)) || (open(x, y - 1) && open(x, y + 1)) });
    }
  }
  const shuffled = rng.shuffle(walls).sort((a, b) => Number(b.shortcut) - Number(a.shortcut));
  for (const { x, y } of shuffled.slice(0, density * 2)) grid[y]![x] = 'B';
}
