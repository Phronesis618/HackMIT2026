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
  CompiledBiomeSchema,
  MAX_ROOMS,
  recipeRoomBlueprints,
  RoomSpecSchema,
  WorldRecipeSchema,
  type ArtRecipe,
  type Attribution,
  type CompiledBiome,
  type ContributionMapping,
  type Palette,
  type RoomBlueprint,
  type RoomEncounter,
  type RoomProp,
  type RoomRelic,
  type RoomSpec,
  type WorldRecipe,
} from '../../shared/contracts';
import { hashString } from '../../shared/ids';
import { MOTIF_IDS, PROP_INFO, type MotifId } from '../../shared/registry';

export interface CompileWorldRecipeOptions {
  plannedRoomCount: number;
  seed?: number;
  committedRoomCount?: number;
}

export interface CompiledWorldRecipe {
  rooms: RoomSpec[];
  art: ArtRecipe;
  /** One entry per biome in the recipe (empty for single-biome recipes). */
  biomes: CompiledBiome[];
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
  if (!Number.isInteger(plannedRoomCount) || plannedRoomCount < 1 || plannedRoomCount > MAX_ROOMS) {
    throw new Error(`plannedRoomCount must be an integer from 1 to ${MAX_ROOMS}; received ${plannedRoomCount}`);
  }
  const committedRoomCount = options.committedRoomCount ?? plannedRoomCount;
  if (!Number.isInteger(committedRoomCount) || committedRoomCount < 1 || committedRoomCount > plannedRoomCount) {
    throw new Error('committedRoomCount must be between 1 and plannedRoomCount.');
  }

  const seed = options.seed ?? hashString(JSON.stringify(recipe));
  const notes: string[] = [];
  const blueprints = recipeRoomBlueprints(recipe);
  const rooms = Array.from({ length: committedRoomCount }, (_, index) => {
    const entry = blueprints[index] ?? blueprints[blueprints.length - 1]!;
    if (index >= blueprints.length) {
      notes.push(`Room ${index + 1} reused the final blueprint because the recipe supplied only ${blueprints.length} room(s).`);
    }
    return compileRoom(recipe, entry.blueprint, index, plannedRoomCount, seed, notes, entry.biomeIndex);
  });

  const droppedMappings = recipe.contributionMappings.filter((mapping) => mapping.roomIndex >= plannedRoomCount).length;
  if (droppedMappings > 0) {
    notes.push(`Ignored ${droppedMappings} contribution mapping(s) for rooms outside the planned room count.`);
  }
  const strandedRelics = recipe.lore.filter((f) => f.kind === 'relic' && f.roomIndex >= plannedRoomCount).length;
  if (strandedRelics > 0) notes.push(`Ignored ${strandedRelics} relic(s) placed in rooms outside the planned room count.`);
  const orphanRemains = recipe.lore.filter((f) => f.kind === 'remains' && f.enemyId === null).length;
  if (orphanRemains > 0) notes.push(`${orphanRemains} remains fragment(s) name no enemy and will never drop.`);

  const art = compileArt(recipe.palette, recipe.motifIds, seed);
  // Biome art: each biome renders with its own motifs (and palette when it declares one), so
  // crossing into a new biome visibly changes the construction of the world.
  const biomes: CompiledBiome[] = recipe.biomes.map((biome, biomeIndex) => {
    const roomIndices = blueprints
      .map((entry, roomIndex) => ({ entry, roomIndex }))
      .filter(({ entry, roomIndex }) => entry.biomeIndex === biomeIndex && roomIndex < plannedRoomCount)
      .map(({ roomIndex }) => roomIndex);
    return CompiledBiomeSchema.parse({
      index: biomeIndex,
      name: biome.name,
      description: biome.description,
      roomIndices: roomIndices.length > 0 ? roomIndices : [Math.min(plannedRoomCount - 1, blueprints.findIndex((e) => e.biomeIndex === biomeIndex))].filter((i) => i >= 0),
      art: compileArt(biome.palette ?? recipe.palette, biome.motifIds, hashString(`${seed}:biome:${biomeIndex}`)),
    });
  }).filter((biome) => biome.roomIndices.length > 0);

  return { rooms, art, biomes, notes: notes.slice(0, 10) };
}

function compileArt(palette: Palette, motifIds: MotifId[], seed: number): ArtRecipe {
  return ArtRecipeSchema.parse({
    paletteFamily: 'ink-neon',
    palette,
    motifIds: motifIds.slice(0, 4),
    skyline: motifIds[0],
    fog: fraction(seed, 'fog', 20, 55),
    glowIntensity: fraction(seed, 'glow', 50, 85),
  });
}

function compileRoom(
  recipe: WorldRecipe,
  blueprint: RoomBlueprint,
  index: number,
  plannedRoomCount: number,
  seed: number,
  notes: string[],
  biomeIndex = 0,
): RoomSpec {
  const roomSeed = hashString(`${seed}:room:${index}:${blueprint.name}`);
  const width = 22 + pick(roomSeed, 'width', 7); // 22–28, inside the 18–28 product target.
  const height = 12 + pick(roomSeed, 'height', 5); // 12–16.
  const pathY = Math.floor(height / 2);
  const isFinal = index === plannedRoomCount - 1;
  const grid = createBorderedGrid(width, height);

  applyMotifStructure(grid, pathY, blueprint.motifIds[0] ?? recipe.motifIds[0], roomSeed);
  if (blueprint.hazards) applyHazards(grid, pathY, roomSeed);

  // Reserve and re-clear the critical route after all structural work.
  for (let x = 1; x < width - 1; x++) grid[pathY]![x] = '.';
  grid[pathY]![1] = 'P';
  if (isFinal) grid[pathY]![width - 3] = 'A';
  else grid[pathY]![width - 1] = 'X';

  const candidates = floorCandidates(grid, pathY, roomSeed);
  const mappings = recipe.contributionMappings.filter((mapping) => mapping.roomIndex === index);
  const props = placeProps(grid, blueprint, index, candidates, mappings, notes);
  const encounters = placeEncounters(grid, blueprint, index, candidates, mappings, props, isFinal, notes);
  const attributions = buildAttributions(grid, blueprint, index, pathY, mappings, props, encounters);
  if (attributions.length < mappings.length) notes.push(`Room ${index + 1} omitted mappings without an observable target.`);
  const relics = placeRelics(grid, recipe, index, candidates, props, encounters, notes);

  const room = RoomSpecSchema.parse({
    id: `generated-room-${roomSeed.toString(36)}-${index}`,
    index,
    biomeIndex,
    name: blueprint.name,
    description: blueprint.description,
    width,
    height,
    tiles: grid.map((row) => row.join('')),
    props,
    encounters,
    exits: isFinal ? [] : [{ x: width - 1, y: pathY, toRoomIndex: index + 1, direction: 'east' }],
    isFinal,
    attributions,
    relics,
  });
  if (!hasCriticalRoute(room)) throw new Error(`Room ${index + 1} has no safe route to its objective.`);
  return room;
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

function applyHazards(grid: Grid, pathY: number, seed: number): void {
  const width = grid[0]!.length;
  const height = grid.length;
  const hazardY = pathY > 4 && pick(seed, 'hazard-side', 2) === 0 ? pathY - 2 : Math.min(height - 2, pathY + 2);
  const startX = 4 + pick(seed, 'hazard-x', Math.max(1, width - 11));
  for (let x = startX; x < Math.min(width - 2, startX + 4); x++) {
    if (grid[hazardY]![x] === '.') grid[hazardY]![x] = '~';
  }
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
  grid: Grid,
  blueprint: RoomBlueprint,
  roomIndex: number,
  candidates: Coord[],
  mappings: ContributionMapping[],
  props: RoomProp[],
  isFinal: boolean,
  notes: string[],
): RoomEncounter[] {
  const enemyIds = [...blueprint.enemyIds];
  if (isFinal && !enemyIds.includes('guardian')) {
    enemyIds.push('guardian');
    notes.push(`Room ${roomIndex + 1} added the required Guardian encounter.`);
  }
  const encounterMappings = mappings.filter((mapping) => mapping.kind === 'encounter');
  const occupied = new Set<string>();
  for (const prop of props) {
    const { w, h } = PROP_INFO[prop.propId].footprint;
    markOccupied(occupied, prop.x, prop.y, w, h);
  }
  return enemyIds.slice(0, 4).flatMap((enemyId, encounterIndex) => {
    const padding = enemyId === 'guardian' ? 1 : 0;
    const size = padding * 2 + 1;
    const coord = candidates.find(({ x, y }) =>
      footprintFits(grid, occupied, x - padding, y - padding, size, size));
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
  const relics: RoomRelic[] = [];
  recipe.lore.forEach((fragment, fragmentIndex) => {
    if (fragment.kind !== 'relic' || fragment.roomIndex !== roomIndex) return;
    if (relics.length >= 3) {
      notes.push(`Room ${roomIndex + 1} kept only three relics.`);
      return;
    }
    const coord = candidates.find(({ x, y }) => footprintFits(grid, occupied, x, y, 1, 1));
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

function hasCriticalRoute(room: RoomSpec): boolean {
  const blocked = new Set<string>();
  for (const prop of room.props) {
    const info = PROP_INFO[prop.propId];
    if (info.blocksMovement) markOccupied(blocked, prop.x, prop.y, info.footprint.w, info.footprint.h);
  }
  const grid = room.tiles.map((row) => row.split(''));
  const start = findTile(grid, 'P')!;
  const queue = [start];
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i]!;
    const tile = grid[y]?.[x];
    const key = `${x},${y}`;
    if (!tile || '# ~'.includes(tile) || blocked.has(key) || seen.has(key)) continue;
    if (tile === (room.isFinal ? 'A' : 'X')) return true;
    seen.add(key);
    queue.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
  }
  return false;
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
