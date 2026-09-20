/**
 * Trusted, deterministic WorldRecipe compiler.
 *
 * Model output stops at WorldRecipe. This module owns the playable geometry and
 * only emits registry-backed props/enemies that have already passed the recipe
 * schema. A clear centre corridor is reserved before decorations are placed, so
 * blocking props and motif geometry cannot cut the spawn-to-exit/Anchor route.
 */
import {
  ArtRecipeSchema,
  RoomSpecSchema,
  WorldRecipeSchema,
  type ArtRecipe,
  type Attribution,
  type ContributionMapping,
  type RoomBlueprint,
  type RoomEncounter,
  type RoomProp,
  type RoomRelic,
  type RoomSpec,
  type RoomTerrain,
  type WorldRecipe,
} from '../../shared/contracts';
import { ANCHOR_RANGE, LORE_READ_RANGE, PLAYER_RADIUS, TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { hashString } from '../../shared/ids';
import { DANGEROUS_TILES, ENEMY_INFO, MOTIF_IDS, PROP_INFO, WALKABLE_TILES, type MotifId } from '../../shared/registry';
import { buildSolidGrid, circleHitsSolid, isSolidAt, type SolidGrid } from '../../sim/collision';
import { clearPath } from '../../sim/combat';

export interface CompileWorldRecipeOptions {
  plannedRoomCount: number;
  seed?: number;
  committedRoomCount?: number;
}

export interface CompiledWorldRecipe {
  rooms: RoomSpec[];
  art: ArtRecipe;
  /** Honest descriptions of deterministic repairs made by trusted code. */
  notes: string[];
}

interface Coord {
  x: number;
  y: number;
}

type Grid = string[][];

export function compileWorldRecipe(rawRecipe: WorldRecipe, options: CompileWorldRecipeOptions): CompiledWorldRecipe {
  const recipe = WorldRecipeSchema.parse(rawRecipe);
  const plannedRoomCount = options.plannedRoomCount;
  if (!Number.isInteger(plannedRoomCount) || plannedRoomCount < 1 || plannedRoomCount > 3) {
    throw new Error(`plannedRoomCount must be an integer from 1 to 3; received ${plannedRoomCount}`);
  }
  const committedRoomCount = options.committedRoomCount ?? plannedRoomCount;
  if (!Number.isInteger(committedRoomCount) || committedRoomCount < 1 || committedRoomCount > plannedRoomCount) {
    throw new Error('committedRoomCount must be between 1 and plannedRoomCount.');
  }

  const seed = options.seed ?? hashString(JSON.stringify(recipe));
  const notes: string[] = [];
  const rooms = Array.from({ length: committedRoomCount }, (_, index) => {
    const blueprint = recipe.rooms[index] ?? recipe.rooms[recipe.rooms.length - 1]!;
    if (index >= recipe.rooms.length) {
      notes.push(`Room ${index + 1} reused the final blueprint because the recipe supplied only ${recipe.rooms.length} room(s).`);
    }
    return compileRoom(recipe, blueprint, index, plannedRoomCount, seed, notes);
  });

  const droppedMappings = recipe.contributionMappings.filter((mapping) => mapping.roomIndex >= plannedRoomCount).length;
  if (droppedMappings > 0) {
    notes.push(`Ignored ${droppedMappings} contribution mapping(s) for rooms outside the planned room count.`);
  }
  const strandedRelics = recipe.lore.filter((f) => f.kind === 'relic' && f.roomIndex >= plannedRoomCount).length;
  if (strandedRelics > 0) notes.push(`Ignored ${strandedRelics} relic(s) placed in rooms outside the planned room count.`);
  const orphanRemains = recipe.lore.filter((f) => f.kind === 'remains' && f.enemyId === null).length;
  if (orphanRemains > 0) notes.push(`${orphanRemains} remains fragment(s) name no enemy and will never drop.`);

  const art = ArtRecipeSchema.parse({
    paletteFamily: 'ink-neon',
    palette: recipe.palette,
    motifIds: recipe.motifIds,
    skyline: recipe.motifIds[0],
    fog: fraction(seed, 'fog', 20, 55),
    glowIntensity: fraction(seed, 'glow', 50, 85),
  });

  return { rooms, art, notes: notes.slice(0, 10) };
}

function compileRoom(
  recipe: WorldRecipe,
  blueprint: RoomBlueprint,
  index: number,
  plannedRoomCount: number,
  seed: number,
  notes: string[],
): RoomSpec {
  const roomSeed = hashString(`${seed}:room:${index}:${blueprint.name}`);
  const width = 22 + pick(roomSeed, 'width', 7); // 22–28, inside the 18–28 product target.
  const height = 12 + pick(roomSeed, 'height', 5); // 12–16.
  const pathY = Math.floor(height / 2);
  const isFinal = index === plannedRoomCount - 1;
  const grid = createBorderedGrid(width, height);

  // Where the crew must stand: the spawn and the objective. TILES.md S4 keeps every damaging
  // or blocking tile two clear tiles away from these, so they are known before terrain runs.
  const keyPoints: Coord[] = [{ x: 1, y: pathY }, { x: isFinal ? width - 3 : width - 1, y: pathY }];
  applyMotifStructure(grid, pathY, blueprint.motifIds[0] ?? recipe.motifIds[0], roomSeed);
  applyTerrain(grid, pathY, blueprint, roomSeed, keyPoints, isFinal);
  if (blueprint.hazards && !isFinal) applyHazards(grid, pathY, roomSeed, keyPoints);

  // Reserve and re-clear the critical route after all structural work.
  for (let x = 1; x < width - 1; x++) grid[pathY]![x] = '.';
  grid[pathY]![1] = 'P';
  if (isFinal) grid[pathY]![width - 3] = 'A';
  else grid[pathY]![width - 1] = 'X';

  const candidates = floorCandidates(grid, pathY, roomSeed);
  const mappings = recipe.contributionMappings.filter((mapping) => mapping.roomIndex === index);
  const props = placeProps(grid, blueprint, index, candidates, mappings, notes);
  const room = RoomSpecSchema.parse({
    id: `generated-room-${roomSeed.toString(36)}-${index}`,
    index,
    name: blueprint.name,
    description: blueprint.description,
    width,
    height,
    tiles: grid.map((row) => row.join('')),
    props,
    encounters: [],
    exits: isFinal ? [] : [{ x: width - 1, y: pathY, toRoomIndex: index + 1, direction: 'east' }],
    isFinal,
    attributions: [],
    relics: [],
    // The model's one tuning number, carried to the sim (TILES.md §4.2).
    ...(blueprint.terrain?.intensity !== undefined ? { terrainIntensity: blueprint.terrain.intensity } : {}),
  });
  room.encounters = placeEncounters(room, grid, blueprint, candidates, mappings, notes);
  room.attributions = buildAttributions(grid, blueprint, index, pathY, mappings, room.props, room.encounters);
  if (room.attributions.length < mappings.length) notes.push(`Room ${index + 1} omitted mappings without an observable target.`);
  const reached = reachableTiles(room);
  room.relics = placeRelics(grid, recipe, index, candidates.filter(({ x, y }) => reached.has(`${x},${y}`)), room.props, room.encounters, notes);
  if (isFinal) room.anchorRelays = placeAnchorRelays(room);
  const objective = findTile(grid, isFinal ? 'A' : 'X')!;
  if (!reached.has(`${objective.x},${objective.y}`)) throw new Error(`Room ${index + 1} has no safe route to its objective.`);
  const solid = buildSolidGrid(room);
  for (const encounter of room.encounters) {
    const center = tileToWorld(encounter.x, encounter.y);
    if (!reached.has(`${encounter.x},${encounter.y}`) ||
      circleHitsSolid(solid, center.x, center.y, ENEMY_INFO[encounter.enemyId].radius)) {
      throw new Error(`Room ${index + 1} has an inaccessible ${encounter.enemyId} encounter.`);
    }
  }
  return RoomSpecSchema.parse(room);
}

function createBorderedGrid(width: number, height: number): Grid {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.')),
  );
}

function applyMotifStructure(grid: Grid, pathY: number, motif: MotifId, seed: number): void {
  const width = grid[0]!.length;
  const height = grid.length;
  const motifIndex = MOTIF_IDS.indexOf(motif);
  const left = 3 + pick(seed, 'structure-left', Math.max(1, Math.floor(width / 4) - 2));
  const right = width - 1 - left;

  const wall = (x: number, y: number): void => {
    if (x > 0 && x < width - 1 && y > 0 && y < height - 1 && y !== pathY) grid[y]![x] = '#';
  };

  switch (motifIndex % 4) {
    case 0: // spires, roots: paired vertical silhouettes
      for (const x of [left, right]) {
        wall(x, 2);
        wall(x, 3);
        wall(x, height - 3);
        wall(x, height - 4);
      }
      break;
    case 1: // arches, monoliths: staggered buttresses
      for (const x of [left, left + 1, right - 1, right]) {
        wall(x, 2);
        wall(x, height - 3);
      }
      break;
    case 2: // cables, lanterns: offset upper/lower bars
      for (let x = left; x <= Math.min(left + 3, width - 2); x++) wall(x, 3);
      for (let x = Math.max(1, right - 3); x <= right; x++) wall(x, height - 4);
      break;
    default: // crystals, ruined machinery: compact asymmetric blocks
      for (const [x, y] of [
        [left, 2],
        [left + 1, 2],
        [left, 3],
        [right, height - 3],
        [right - 1, height - 3],
        [right, height - 4],
      ] as const) wall(x, y);
  }
}

function applyHazards(grid: Grid, pathY: number, seed: number, keyPoints: readonly Coord[]): void {
  const width = grid[0]!.length;
  const height = grid.length;
  const hazardY = pathY > 4 && pick(seed, 'hazard-side', 2) === 0 ? pathY - 2 : Math.min(height - 2, pathY + 2);
  const startX = 4 + pick(seed, 'hazard-x', Math.max(1, width - 11));
  for (let x = startX; x < Math.min(width - 2, startX + 4); x++) {
    if (grid[hazardY]![x] === '.' && !nearKeyPoint(keyPoints, x, hazardY)) grid[hazardY]![x] = '~';
  }
}

function defaultTerrain(motif: MotifId): RoomTerrain {
  if (motif === 'roots' || motif === 'crystals') {
    return { features: ['breakable_walls', 'rubble'], layout: 'scattered', density: 'balanced' };
  }
  if (motif === 'arches' || motif === 'monoliths' || motif === 'spires') {
    return { features: ['breakable_walls', 'bridges'], layout: 'barricades', density: 'balanced' };
  }
  return { features: ['bridges', 'conduits'], layout: 'crossroads', density: 'balanced' };
}

function applyTerrain(
  grid: Grid, pathY: number, blueprint: RoomBlueprint, seed: number, keyPoints: readonly Coord[], isFinal: boolean,
): void {
  const terrain = blueprint.terrain ?? defaultTerrain(blueprint.motifIds[0]!);
  const features = new Set(terrain.features);
  // The Anchor room keeps its structure and its cover and none of the damaging tiles: the
  // Guardian fight is decided by reading the Guardian (see the floors mutator for the same rule).
  if (isFinal) for (const id of ['hazard_floor', 'vents', 'pits', 'canisters', 'cover'] as const) features.delete(id);
  const density = terrain.density === 'sparse' ? 1 : terrain.density === 'dense' ? 3 : 2;
  const cells = floorCandidates(grid, pathY, seed);
  const width = grid[0]!.length;
  const height = grid.length;
  if (features.has('bridges')) {
    const halfLength = terrain.layout === 'barricades' ? 3 : 2;
    let placed = 0;
    for (const center of cells) {
      const horizontal = terrain.layout === 'barricades' ? false
        : terrain.layout === 'crossroads' ? placed % 2 === 0 : pick(seed, 'bridge-axis', 2) === 0;
      let stamped = false;
      for (const horizontalWall of [horizontal, !horizontal]) {
        const footprint: Coord[] = [];
        for (let along = -halfLength; along <= halfLength; along++) {
          for (let across = -1; across <= 1; across++) {
            footprint.push({
              x: center.x + (horizontalWall ? along : across),
              y: center.y + (horizontalWall ? across : along),
            });
          }
        }
        if (footprint.some(({ x, y }) => x < 2 || x >= width - 2 || y < 1 || y >= height - 1 ||
          Math.abs(y - pathY) <= 1 || !['.', '#'].includes(grid[y]![x]!))) continue;
        for (const { x, y } of footprint) grid[y]![x] = '.';
        for (let along = -halfLength; along <= halfLength; along++) {
          grid[center.y + (horizontalWall ? 0 : along)]![center.x + (horizontalWall ? along : 0)] = '#';
        }
        grid[center.y]![center.x] = '=';
        for (const side of [-1, 1]) {
          grid[center.y + (horizontalWall ? side : 0)]![center.x + (horizontalWall ? 0 : side)] = '>';
        }
        stamped = true;
        break;
      }
      if (stamped && ++placed >= (density === 3 ? 2 : 1)) break;
    }
  }
  if (features.has('breakable_walls')) {
    const walls: Coord[] = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (grid[y]![x] !== '#') continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy!]![x + dx!] === '=')) continue;
        walls.push({ x, y });
      }
    }
    walls.sort((a, b) => hashString(`${seed}:wall:${a.x}:${a.y}`) - hashString(`${seed}:wall:${b.x}:${b.y}`));
    for (const { x, y } of walls.slice(0, density * 2)) grid[y]![x] = 'B';
  }
  if (features.has('pits')) {
    // Blobs of 2-6 tiles, at most two, never touching the guaranteed path row. Pits block
    // walking, so a blob is only kept when the room's spawn still reaches its objective.
    let blobs = 0;
    for (const centre of cells) {
      if (blobs >= Math.min(2, density === 1 ? 1 : 2)) break;
      // Two blobs that touch read as one big one: keep a clear tile between them.
      const clear = (x: number, y: number) => grid[y]?.[x] === '.' && Math.abs(y - pathY) > 1 &&
        !nearKeyPoint(keyPoints, x, y) &&
        ![-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => grid[y + dy]?.[x + dx] === 'o'));
      if (!clear(centre.x, centre.y)) continue;
      const blob: Coord[] = [centre];
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) { // 4-connected, or it reads as two pits
        if (blob.length >= 2 + (hashString(`${seed}:pit:${centre.x}:${centre.y}`) % 5)) break;
        const cell = { x: centre.x + dx, y: centre.y + dy };
        if (clear(cell.x, cell.y)) blob.push(cell);
      }
      if (blob.length < 2) continue;
      for (const cell of blob) grid[cell.y]![cell.x] = 'o';
      blobs++;
    }
  }
  if (features.has('cover')) {
    // Runs of 2-4 across the room's short axis, at least three tiles from any wall, never
    // touching each other. Walkable, so nothing here can strand a room.
    const [dx, dy] = width >= height ? [0, 1] : [1, 0];
    let runs = 0;
    for (const start of cells) {
      if (runs >= Math.min(3, density)) break;
      const length = 2 + (hashString(`${seed}:cover:${start.x}:${start.y}`) % 3);
      const run: Coord[] = [];
      for (let i = 0; i < length; i++) run.push({ x: start.x + dx * i, y: start.y + dy * i });
      if (!run.every(({ x, y }) => grid[y]?.[x] === '.' && Math.abs(y - pathY) > 1 && !nearKeyPoint(keyPoints, x, y) &&
        x >= 3 && x < width - 3 && y >= 3 && y < height - 3 &&
        ![-1, 0, 1].some((ny) => [-1, 0, 1].some((nx) => grid[y + ny]?.[x + nx] === '-')))) continue;
      for (const cell of run) grid[cell.y]![cell.x] = '-';
      runs++;
    }
  }
  if (features.has('vents')) {
    // Fields of 4 or 9 tiles (2x2 / 3x3), at most two, off the guaranteed path row and never
    // touching each other. Walkable, so the only thing at risk is the hazard-free route, which
    // the reserved centre corridor already guarantees.
    let fields = 0;
    for (const corner of cells) {
      if (fields >= Math.min(2, density === 1 ? 1 : 2)) break;
      const side = 2 + (hashString(`${seed}:vent:${corner.x}:${corner.y}`) % 2);
      const field: Coord[] = [];
      for (let dy = 0; dy < side; dy++) for (let dx = 0; dx < side; dx++) field.push({ x: corner.x + dx, y: corner.y + dy });
      if (!field.every(({ x, y }) => grid[y]?.[x] === '.' && Math.abs(y - pathY) > 1 && !nearKeyPoint(keyPoints, x, y) &&
        ![-1, 0, 1].some((ny) => [-1, 0, 1].some((nx) => grid[y + ny]?.[x + nx] === '^')))) continue;
      for (const cell of field) grid[cell.y]![cell.x] = '^';
      fields++;
    }
  }
  if (features.has('canisters')) {
    // Solid until something shoots them, so they only sit in open floor (>= 6 of 8 neighbours
    // walkable) and never within two tiles of each other. See TILES.md T1's generator rules.
    const placed: Coord[] = [];
    const open = (x: number, y: number) => ['.', ':', '+', '~', '=', '>'].includes(grid[y]?.[x] ?? '#');
    for (const cell of cells) {
      if (placed.length >= Math.min(3, density)) break;
      if (grid[cell.y]?.[cell.x] !== '.' || Math.abs(cell.y - pathY) <= 1) continue;
      if (nearKeyPoint(keyPoints, cell.x, cell.y)) continue;
      let neighbours = 0;
      for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) if ((dx || dy) && open(cell.x + dx, cell.y + dy)) neighbours++;
      if (neighbours < 6) continue;
      if (placed.some((p) => Math.max(Math.abs(p.x - cell.x), Math.abs(p.y - cell.y)) < 2)) continue;
      grid[cell.y]![cell.x] = '*';
      placed.push(cell);
    }
  }
  for (const feature of ['rubble', 'conduits'] as const) {
    if (!features.has(feature)) continue;
    let placed = 0;
    for (const center of cells) {
      const offsets = feature === 'rubble'
        ? [[0, 0], [1, 0], [0, 1], [1, 1]]
        : terrain.layout === 'crossroads'
          ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]
          : [[0, 0], [1, 0], [2, 0], [3, 0]];
      const patch = offsets.map(([dx, dy]) => ({ x: center.x + dx!, y: center.y + dy! }));
      if (patch.some(({ x, y }) => x < 2 || x >= width - 2 || Math.abs(y - pathY) <= 1 || grid[y]?.[x] !== '.')) continue;
      for (const { x, y } of patch) grid[y]![x] = feature === 'rubble' ? ':' : '+';
      if (++placed >= density) break;
    }
  }
}

/** TILES.md S4's margin: a dangerous tile needs two clear tiles around anything the crew uses. */
function nearKeyPoint(keyPoints: readonly Coord[], x: number, y: number): boolean {
  return keyPoints.some((point) => Math.max(Math.abs(point.x - x), Math.abs(point.y - y)) <= 2);
}

function floorCandidates(grid: Grid, pathY: number, seed: number): Coord[] {
  const candidates: Coord[] = [];
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 2; x < grid[0]!.length - 2; x++) {
      if (grid[y]![x] === '.' && Math.abs(y - pathY) > 1) candidates.push({ x, y });
    }
  }
  return candidates.sort((a, b) => {
    const ah = hashString(`${seed}:${a.x}:${a.y}`);
    const bh = hashString(`${seed}:${b.x}:${b.y}`);
    return ah - bh || a.y - b.y || a.x - b.x;
  });
}

function placeProps(
  grid: Grid,
  blueprint: RoomBlueprint,
  roomIndex: number,
  candidates: Coord[],
  mappings: ContributionMapping[],
  notes: string[],
): RoomProp[] {
  const props: RoomProp[] = [];
  const occupied = new Set<string>();
  const propMappings = mappings.filter((mapping) => mapping.kind === 'prop');

  const desired = [...blueprint.propIds];
  if (grid.some((row) => row.includes('A')) && !desired.includes('anchor_pedestal')) {
    desired.push('anchor_pedestal');
    notes.push(`Room ${roomIndex + 1} added an anchor pedestal for the generated Anchor site.`);
  }

  desired.forEach((propId, propIndex) => {
    const footprint = PROP_INFO[propId].footprint;
    const anchor = propId === 'anchor_pedestal' ? findTile(grid, 'A') : undefined;
    const coord = anchor
      ? (occupied.has(`${anchor.x},${anchor.y}`) ? undefined : anchor)
      : candidates.find(({ x, y }) => footprintFits(grid, occupied, x, y, footprint.w, footprint.h));
    if (!coord) {
      notes.push(`Room ${roomIndex + 1} omitted ${propId}; no safe floor footprint remained.`);
      return;
    }
    markOccupied(occupied, coord.x, coord.y, footprint.w, footprint.h);
    const mapping = propMappings[propIndex];
    props.push({
      id: `room-${roomIndex}-prop-${propIndex}`,
      propId,
      x: coord.x,
      y: coord.y,
      ...(mapping ? { attributionId: mapping.contributionId } : {}),
    });
  });
  return props;
}

function placeEncounters(
  room: RoomSpec,
  grid: Grid,
  blueprint: RoomBlueprint,
  candidates: Coord[],
  mappings: ContributionMapping[],
  notes: string[],
): RoomEncounter[] {
  const roomIndex = room.index;
  const enemyIds = [...blueprint.enemyIds];
  if (room.isFinal && !enemyIds.includes('guardian')) {
    enemyIds.push('guardian');
    notes.push(`Room ${roomIndex + 1} added the required Guardian encounter.`);
  }
  const encounterMappings = mappings.filter((mapping) => mapping.kind === 'encounter');
  const occupied = new Set<string>();
  return enemyIds.slice(0, 4).flatMap((enemyId, encounterIndex) => {
    const solid = buildSolidGrid(room);
    const reached = reachableTiles(room, solid);
    const unavailable = new Set(occupied);
    for (const prop of room.props) {
      const { w, h } = PROP_INFO[prop.propId].footprint;
      markOccupied(unavailable, prop.x, prop.y, w, h);
    }
    const padding = enemyId === 'guardian' ? 1 : 0;
    const size = padding * 2 + 1;
    let coord = candidates.find(({ x, y }) => {
      const center = tileToWorld(x, y);
      return reached.has(`${x},${y}`) &&
        !circleHitsSolid(solid, center.x, center.y, ENEMY_INFO[enemyId].radius) &&
        footprintFits(grid, unavailable, x - padding, y - padding, size, size);
    });
    if (!coord) {
      coord = repairEncounterSpace(room, grid, occupied);
      if (coord) notes.push(`Room ${roomIndex + 1} cleared optional decoration for ${enemyId} encounter clearance.`);
    }
    if (!coord) throw new Error(`Room ${roomIndex + 1} has no safe spawn for ${enemyId}.`);
    markOccupied(occupied, coord.x - padding, coord.y - padding, size, size);
    const mapping = encounterMappings[encounterIndex];
    return [{
      id: `room-${roomIndex}-encounter-${encounterIndex}`,
      enemyId,
      x: coord.x,
      y: coord.y,
      count: 1,
      ...(mapping ? { attributionId: mapping.contributionId } : {}),
    }];
  });
}

function repairEncounterSpace(room: RoomSpec, grid: Grid, occupied: Set<string>): Coord | undefined {
  const pathY = findTile(grid, 'P')!.y;
  const candidates: Array<Coord & { cost: number; props: RoomProp[] }> = [];
  for (const y of [pathY - 2, pathY + 2]) {
    for (let x = 2; x < room.width - 2; x++) {
      const patch = new Set<string>();
      markOccupied(patch, x - 1, y - 1, 3, 3);
      if ([...patch].some((key) => occupied.has(key))) continue;
      const props = room.props.filter((prop) => {
        const { w, h } = PROP_INFO[prop.propId].footprint;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) if (patch.has(`${prop.x + dx},${prop.y + dy}`)) return true;
        }
        return false;
      });
      let cost = props.reduce((sum, prop) => sum + PROP_INFO[prop.propId].footprint.w * PROP_INFO[prop.propId].footprint.h, 0);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (grid[y + dy]![x + dx] !== '.') cost++;
      }
      candidates.push({ x, y, cost, props });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
  const target = candidates[0];
  if (!target) return undefined;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) grid[target.y + dy]![target.x + dx] = '.';
  }
  room.props = room.props.filter((prop) => !target.props.includes(prop));
  room.tiles = grid.map((row) => row.join(''));
  return { x: target.x, y: target.y };
}

/**
 * Relics are non-blocking floor artifacts, so they never touch the critical route. They
 * take whatever open floor remains after props and encounters, farthest from the route
 * first so reading one is a small detour rather than a tripwire.
 */
function placeRelics(
  grid: Grid,
  recipe: WorldRecipe,
  roomIndex: number,
  candidates: Coord[],
  props: RoomProp[],
  encounters: RoomEncounter[],
  notes: string[],
): RoomRelic[] {
  const occupied = new Set<string>();
  for (const prop of props) {
    const { w, h } = PROP_INFO[prop.propId].footprint;
    markOccupied(occupied, prop.x, prop.y, w, h);
  }
  for (const encounter of encounters) markOccupied(occupied, encounter.x - 1, encounter.y - 1, 3, 3);
  const core = findTile(grid, 'A');
  const relics: RoomRelic[] = [];
  recipe.lore.forEach((fragment, fragmentIndex) => {
    if (fragment.kind !== 'relic' || fragment.roomIndex !== roomIndex) return;
    if (relics.length >= 3) {
      notes.push(`Room ${roomIndex + 1} kept only three relics.`);
      return;
    }
    const coord = candidates.find(({ x, y }) => footprintFits(grid, occupied, x, y, 1, 1) &&
      (!core || Math.hypot(x - core.x, y - core.y) * TILE_SIZE > LORE_READ_RANGE + ANCHOR_RANGE));
    if (!coord) {
      notes.push(`Room ${roomIndex + 1} omitted the relic "${fragment.title}"; no open floor remained.`);
      return;
    }
    markOccupied(occupied, coord.x - 1, coord.y - 1, 3, 3);
    relics.push({ id: `room-${roomIndex}-relic-${fragmentIndex}`, x: coord.x, y: coord.y, fragmentIndex });
  });
  return relics;
}

function buildAttributions(
  grid: Grid,
  blueprint: RoomBlueprint,
  roomIndex: number,
  pathY: number,
  mappings: ContributionMapping[],
  props: RoomProp[],
  encounters: RoomEncounter[],
): Attribution[] {
  const hazard = findTile(grid, '~');
  const structure = findInteriorTile(grid, '#');
  const usedProps = new Set<string>();
  const usedEncounters = new Set<string>();
  return mappings.flatMap((mapping): Attribution[] => {
    let target: Coord | undefined;
    let feature = '';
    if (mapping.kind === 'prop') {
      const prop = props.find((p) => p.attributionId === mapping.contributionId && !usedProps.has(p.id));
      if (prop) { target = prop; feature = prop.propId.replaceAll('_', ' '); usedProps.add(prop.id); }
    } else if (mapping.kind === 'encounter') {
      const encounter = encounters.find((e) => e.attributionId === mapping.contributionId && !usedEncounters.has(e.id));
      if (encounter) { target = encounter; feature = `${encounter.enemyId} encounter`; usedEncounters.add(encounter.id); }
    } else if (mapping.kind === 'hazard') {
      target = hazard;
      feature = 'hazard tiles';
    } else if (mapping.kind === 'structure' || mapping.kind === 'motif') {
      target = structure;
      feature = `${blueprint.motifIds[0]} structures`;
    } else if (mapping.kind === 'name') {
      target = { x: 1, y: pathY };
      feature = 'room name';
    }
    if (!target) return [];
    return [{
      contributionId: mapping.contributionId,
      kind: mapping.kind,
      featureDescription: `${feature} in “${blueprint.name}”.`,
      target: { roomIndex, x: target.x, y: target.y },
    }];
  });
}

function reachableTiles(room: RoomSpec, solid: SolidGrid = buildSolidGrid(room)): Set<string> {
  const grid = room.tiles.map((row) => row.split(''));
  const start = findTile(grid, 'P')!;
  const queue = [start];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i]!;
    const tile = grid[y]?.[x];
    const key = `${x},${y}`;
    const center = tileToWorld(x, y);
    if (!tile || !WALKABLE_TILES.has(tile) || tile === '~' || seen.has(key) ||
      circleHitsSolid(solid, center.x, center.y, PLAYER_RADIUS)) continue;
    seen.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (clearPath(solid, center, tileToWorld(x + dx, y + dy), PLAYER_RADIUS)) queue.push({ x: x + dx, y: y + dy });
    }
  }
  return seen;
}

function placeAnchorRelays(room: RoomSpec): Coord[] {
  const tiles = room.tiles.map((line) => line.split(''));
  const spawn = findTile(tiles, 'P')!;
  const core = findTile(tiles, 'A')!;
  const queue = [spawn];
  const seen = new Set<string>([`${spawn.x},${spawn.y}`]);
  const reached = reachableTiles(room);
  const occupied = new Set<string>();
  for (const prop of room.props) {
    const { w, h } = PROP_INFO[prop.propId].footprint;
    markOccupied(occupied, prop.x, prop.y, w, h);
  }
  const candidates: Coord[] = [];
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!;
    const tile = room.tiles[point.y]![point.x]!;
    if (tile === '.' && !occupied.has(`${point.x},${point.y}`) &&
      room.relics.every((relic) =>
        Math.hypot(point.x - relic.x, point.y - relic.y) * TILE_SIZE > LORE_READ_RANGE + ANCHOR_RANGE)) {
      candidates.push(point);
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const x = point.x + dx;
      const y = point.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || !reached.has(key)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  // TILES.md S4: a relay is a place the crew has to stand still on, so keep two clear tiles
  // between it and anything that damages. Preference, not a filter — a cramped room must still
  // produce three relays rather than fail to compile.
  const dangerous: Coord[] = [];
  tiles.forEach((row, y) => row.forEach((ch, x) => { if (DANGEROUS_TILES.has(ch)) dangerous.push({ x, y }); }));
  const safeFromHazards = (candidate: Coord) => !dangerous.some((d) =>
    Math.max(Math.abs(candidate.x - d.x), Math.abs(candidate.y - d.y)) <= 2);
  const relays: Coord[] = [];
  // Precomputed once: the check walks every dangerous tile, and a comparator must stay cheap.
  const safe = new Map(candidates.map((candidate) => [candidate, safeFromHazards(candidate)]));
  for (let i = 0; i < 3; i++) {
    const anchors = [core, spawn, ...relays];
    const score = (candidate: Coord) => Math.min(...anchors.map((anchor) =>
      Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y)));
    candidates.sort((a, b) => Number(safe.get(b)) - Number(safe.get(a)) ||
      score(b) - score(a) || a.y - b.y || a.x - b.x);
    const point = candidates.shift();
    if (!point) throw new Error(`Room ${room.index + 1} has no safe space for three Anchor relays.`);
    relays.push(point);
  }
  return relays;
}

function footprintFits(grid: Grid, occupied: Set<string>, x: number, y: number, width: number, height: number): boolean {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const key = `${x + dx},${y + dy}`;
      if (grid[y + dy]?.[x + dx] !== '.' || occupied.has(key)) return false;
    }
  }
  return true;
}

function markOccupied(occupied: Set<string>, x: number, y: number, width: number, height: number): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) occupied.add(`${x + dx},${y + dy}`);
  }
}

function findTile(grid: Grid, tile: string): Coord | undefined {
  for (let y = 0; y < grid.length; y++) {
    const x = grid[y]!.indexOf(tile);
    if (x >= 0) return { x, y };
  }
  return undefined;
}

function findInteriorTile(grid: Grid, tile: string): Coord | undefined {
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x < grid[y]!.length - 1; x++) {
      if (grid[y]![x] === tile) return { x, y };
    }
  }
  return undefined;
}

function pick(seed: number, label: string, size: number): number {
  return size <= 1 ? 0 : hashString(`${seed}:${label}`) % size;
}

function fraction(seed: number, label: string, minPercent: number, maxPercent: number): number {
  return (minPercent + pick(seed, label, maxPercent - minPercent + 1)) / 100;
}
