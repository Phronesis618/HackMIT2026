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
/** Walkable for the reachability check: hazards and unbroken bulkheads do not count. */
const safeGround = (ch: string) => ch !== '~' && ch !== 'B';

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
  const density = terrain.density === 'sparse' ? 1 : terrain.density === 'dense' ? 3 : 2;
  const cells: Coord[] = [];
  for (let y = 1; y < room.height - 1; y++) for (let x = 1; x < room.width - 1; x++) if (free(x, y)) cells.push({ x, y });
  const order = rng.shuffle(cells);

  if (features.has('bridges')) stampBridges(grid, order, free, terrain, density, room.spawn, blocked, rng);
  if (features.has('breakable_walls')) stampBreakableWalls(grid, density, rng);
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
