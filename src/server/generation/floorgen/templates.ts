/**
 * Room template library — hand-designed tile layouts as data.
 *
 * Owner: Agent F1a (floors). Pure data + selection helpers.
 *
 * Rules every template obeys (enforced by tests/generation/floorgen/templates.test.ts):
 *  - only legacy tile chars: '#' wall, '.' floor, ' ' void, 'P' spawn, 'A' focus marker;
 *  - rectangular, within RoomSpec limits (8..48 x 6..32), border is wall or void only;
 *  - exactly one 'P'; at most one 'A'. 'A' marks the room's FOCUS (pedestal, chest,
 *    relic, portal). The assembler keeps it as a real 'A' tile only in the final
 *    biome's exit room and turns it into floor everywhere else;
 *  - door SOCKETS sit on a '#' border tile whose inward neighbour is walkable.
 *    `pos` is the x of an n/s socket or the y of an e/w socket. The assembler opens
 *    exactly the sockets the floor plan needs and leaves the rest as wall;
 *  - all walkable tiles are connected.
 *
 * Following Dead Cells, templates are tagged by purpose (`kinds`) and biomes draw from
 * motif-affinity-weighted pools, so two biomes rarely show the same rooms.
 */
import type { DoorSide, RoomKind, SizeClass } from '../../../shared/floors';
import type { MotifId } from '../../../shared/registry';
import type { Rng } from './rng';

export interface RoomTemplate {
  id: string;
  kinds: readonly RoomKind[];
  sizeClass: SizeClass;
  motifAffinity: readonly MotifId[];
  sockets: Readonly<Partial<Record<DoorSide, number>>>;
  tiles: readonly string[];
}

export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  // ---- small: 13 x 9 ------------------------------------------------------
  {
    id: 's_cell',
    kinds: ['entrance', 'combat', 'rest', 'shop'],
    sizeClass: 'small',
    motifAffinity: ['monoliths', 'ruined_machinery', 'cables'],
    sockets: { n: 6, s: 6, e: 4, w: 4 },
    tiles: [
      '#############',
      '#...........#',
      '#...........#',
      '#...........#',
      '#.....P.....#',
      '#...........#',
      '#...........#',
      '#...........#',
      '#############',
    ],
  },
  {
    id: 's_octagon',
    kinds: ['entrance', 'combat', 'treasure'],
    sizeClass: 'small',
    motifAffinity: ['crystals', 'lanterns', 'arches'],
    sockets: { n: 6, s: 6, e: 4, w: 4 },
    tiles: [
      '  #########  ',
      ' ##.......## ',
      '##.........##',
      '#...........#',
      '#..P..A.....#',
      '#...........#',
      '##.........##',
      ' ##.......## ',
      '  #########  ',
    ],
  },
  {
    id: 's_shrine',
    kinds: ['treasure', 'lore', 'rest', 'shop'],
    sizeClass: 'small',
    motifAffinity: ['lanterns', 'arches', 'spires'],
    sockets: { n: 6, s: 6, e: 4, w: 4 },
    tiles: [
      '#############',
      '#...........#',
      '#..#.....#..#',
      '#...........#',
      '#..P..A.....#',
      '#...........#',
      '#..#.....#..#',
      '#...........#',
      '#############',
    ],
  },
  {
    id: 's_alcove',
    kinds: ['lore', 'rest', 'treasure'],
    sizeClass: 'small',
    motifAffinity: ['roots', 'crystals', 'monoliths'],
    sockets: { n: 6, s: 6, e: 4, w: 4 },
    tiles: [
      '#############',
      '###.......###',
      '##.........##',
      '#....#.#....#',
      '#P....A.....#',
      '#....#.#....#',
      '##.........##',
      '###.......###',
      '#############',
    ],
  },
  {
    id: 's_pillars',
    kinds: ['combat'],
    sizeClass: 'small',
    motifAffinity: ['spires', 'arches', 'monoliths'],
    sockets: { n: 6, s: 6, e: 4, w: 4 },
    tiles: [
      '#############',
      '#...........#',
      '#.#..#.#..#.#',
      '#...........#',
      '#..P........#',
      '#...........#',
      '#.#..#.#..#.#',
      '#...........#',
      '#############',
    ],
  },
  {
    id: 's_split',
    kinds: ['combat', 'lore'],
    sizeClass: 'small',
    motifAffinity: ['ruined_machinery', 'cables', 'roots'],
    sockets: { n: 3, s: 9, e: 4, w: 4 },
    tiles: [
      '#############',
      '#.....#.....#',
      '#.....#.....#',
      '#...........#',
      '#..P.....A..#',
      '#...........#',
      '#.....#.....#',
      '#.....#.....#',
      '#############',
    ],
  },
  // ---- medium: 19 x 13 ----------------------------------------------------
  {
    id: 'm_four_blocks',
    kinds: ['combat', 'elite'],
    sizeClass: 'medium',
    motifAffinity: ['monoliths', 'ruined_machinery', 'spires'],
    sockets: { n: 9, s: 9, e: 6, w: 6 },
    tiles: [
      '###################',
      '#.................#',
      '#.................#',
      '#...##.......##...#',
      '#...##.......##...#',
      '#.................#',
      '#..P.....A........#',
      '#.................#',
      '#...##.......##...#',
      '#...##.......##...#',
      '#.................#',
      '#.................#',
      '###################',
    ],
  },
  {
    id: 'm_cross',
    kinds: ['combat', 'elite', 'exit'],
    sizeClass: 'medium',
    motifAffinity: ['arches', 'lanterns', 'cables'],
    sockets: { n: 9, s: 9, e: 6, w: 6 },
    tiles: [
      '     #########     ',
      '     #.......#     ',
      '     #.......#     ',
      '######.......######',
      '#.................#',
      '#.................#',
      '#..P.....A........#',
      '#.................#',
      '#.................#',
      '######.......######',
      '     #.......#     ',
      '     #.......#     ',
      '     #########     ',
    ],
  },
  {
    id: 'm_ring',
    kinds: ['combat', 'elite'],
    sizeClass: 'medium',
    motifAffinity: ['roots', 'crystals', 'monoliths'],
    sockets: { n: 9, s: 9, e: 6, w: 6 },
    tiles: [
      '###################',
      '#.................#',
      '#.................#',
      '#..P..............#',
      '#.....#######.....#',
      '#.....#######.....#',
      '#.....#######.....#',
      '#.....#######.....#',
      '#.....#######.....#',
      '#.................#',
      '#.................#',
      '#.................#',
      '###################',
    ],
  },
  {
    id: 'm_twin_chambers',
    kinds: ['combat'],
    sizeClass: 'medium',
    motifAffinity: ['ruined_machinery', 'cables', 'arches'],
    sockets: { n: 4, s: 14, e: 6, w: 6 },
    tiles: [
      '###################',
      '#........#........#',
      '#........#........#',
      '#.................#',
      '#........#........#',
      '#........#........#',
      '#..P.....#.....A..#',
      '#........#........#',
      '#........#........#',
      '#.................#',
      '#........#........#',
      '#........#........#',
      '###################',
    ],
  },
  {
    id: 'm_diamond',
    kinds: ['elite', 'combat', 'exit'],
    sizeClass: 'medium',
    motifAffinity: ['crystals', 'spires', 'lanterns'],
    sockets: { n: 9, s: 9, e: 6, w: 6 },
    tiles: [
      '    ###########    ',
      '  ###.........###  ',
      ' ##.............## ',
      '##...............##',
      '#.................#',
      '#.......###.......#',
      '#..P....###....A..#',
      '#.......###.......#',
      '#.................#',
      '##...............##',
      ' ##.............## ',
      '  ###.........###  ',
      '    ###########    ',
    ],
  },
  {
    id: 'm_colonnade',
    kinds: ['combat', 'elite'],
    sizeClass: 'medium',
    motifAffinity: ['arches', 'spires', 'lanterns'],
    sockets: { n: 9, s: 9, e: 6, w: 6 },
    tiles: [
      '###################',
      '#.................#',
      '#..#..#.....#..#..#',
      '#.................#',
      '#.................#',
      '#..#..#.....#..#..#',
      '#..P..........A...#',
      '#..#..#.....#..#..#',
      '#.................#',
      '#.................#',
      '#..#..#.....#..#..#',
      '#.................#',
      '###################',
    ],
  },
  // ---- large: 27 x 17 -----------------------------------------------------
  {
    id: 'l_grand_hall',
    kinds: ['combat', 'elite'],
    sizeClass: 'large',
    motifAffinity: ['spires', 'monoliths', 'arches'],
    sockets: { n: 13, s: 13, e: 8, w: 8 },
    tiles: [
      '###########################',
      '#.........................#',
      '#.........................#',
      '#...##...............##...#',
      '#...##...............##...#',
      '#.........................#',
      '#.........................#',
      '#..........#####..........#',
      '#..P.......#####.......A..#',
      '#..........#####..........#',
      '#.........................#',
      '#.........................#',
      '#...##...............##...#',
      '#...##...............##...#',
      '#.........................#',
      '#.........................#',
      '###########################',
    ],
  },
  {
    id: 'l_arena',
    kinds: ['exit', 'elite'],
    sizeClass: 'large',
    motifAffinity: ['crystals', 'lanterns', 'monoliths', 'spires'],
    sockets: { n: 13, s: 13, e: 8, w: 8 },
    tiles: [
      '      ###############      ',
      '    ###.............###    ',
      '  ###.................###  ',
      ' ##.....................## ',
      '##.......................##',
      '#.........................#',
      '#.....#.............#.....#',
      '#.........................#',
      '#..P.........A............#',
      '#.........................#',
      '#.....#.............#.....#',
      '#.........................#',
      '##.......................##',
      ' ##.....................## ',
      '  ###.................###  ',
      '    ###.............###    ',
      '      ###############      ',
    ],
  },
  {
    id: 'l_quarters',
    kinds: ['combat'],
    sizeClass: 'large',
    motifAffinity: ['ruined_machinery', 'cables', 'roots'],
    sockets: { n: 6, s: 20, e: 12, w: 4 },
    tiles: [
      '###########################',
      '#............#............#',
      '#............#............#',
      '#.........................#',
      '#..P.........#............#',
      '#............#............#',
      '#............#............#',
      '#............#............#',
      '######...#########...######',
      '#............#............#',
      '#............#............#',
      '#............#............#',
      '#............#.........A..#',
      '#.........................#',
      '#............#............#',
      '#............#............#',
      '###########################',
    ],
  },
  {
    id: 'l_great_cross',
    kinds: ['exit', 'combat'],
    sizeClass: 'large',
    motifAffinity: ['arches', 'cables', 'roots', 'ruined_machinery'],
    sockets: { n: 13, s: 13, e: 8, w: 8 },
    tiles: [
      '         #########         ',
      '         #.......#         ',
      '         #.......#         ',
      '         #.......#         ',
      '##########.......##########',
      '#.........................#',
      '#.........................#',
      '#.........................#',
      '#..P.........A............#',
      '#.........................#',
      '#.........................#',
      '#.........................#',
      '##########.......##########',
      '         #.......#         ',
      '         #.......#         ',
      '         #.......#         ',
      '         #########         ',
    ],
  },
  {
    id: 'l_gauntlet',
    kinds: ['combat', 'elite'],
    sizeClass: 'large',
    motifAffinity: ['ruined_machinery', 'monoliths', 'crystals'],
    sockets: { n: 13, s: 13, e: 8, w: 8 },
    tiles: [
      '###########################',
      '#.........................#',
      '#.....#.........#.........#',
      '#.....#.........#.........#',
      '#.....#.........#.........#',
      '#.....#.........#.........#',
      '#.........................#',
      '#.........................#',
      '#..P..................A...#',
      '#.........................#',
      '#.........................#',
      '#..........#.........#....#',
      '#..........#.........#....#',
      '#..........#.........#....#',
      '#..........#.........#....#',
      '#.........................#',
      '###########################',
    ],
  },
];

const TEMPLATE_BY_ID = new Map(ROOM_TEMPLATES.map((template) => [template.id, template]));

/** Always usable: four sockets, no obstacles. The last-resort answer of `pickTemplate`. */
export const FALLBACK_TEMPLATE_ID = 's_cell';

export function getTemplate(id: string): RoomTemplate {
  const template = TEMPLATE_BY_ID.get(id) ?? TEMPLATE_BY_ID.get(FALLBACK_TEMPLATE_ID);
  if (!template) throw new Error(`floorgen: template library is missing ${FALLBACK_TEMPLATE_ID}`);
  return template;
}

/** Size-class odds per room kind (small, medium, large). */
const SIZE_WEIGHTS: Record<RoomKind, readonly [number, number, number]> = {
  entrance: [1, 0, 0],
  combat: [3, 5, 2],
  elite: [0, 3, 2],
  treasure: [1, 0, 0],
  lore: [1, 0, 0],
  rest: [1, 0, 0],
  exit: [0, 1, 3],
  shop: [1, 0, 0],
};
const SIZE_ORDER: readonly SizeClass[] = ['small', 'medium', 'large'];

/**
 * Picks a template for a room. Deeper floors (higher tier) lean larger. Filters by
 * kind → size class → required sockets, then weights by motif affinity (x4 per shared
 * motif). Falls back through looser filters and finally to FALLBACK_TEMPLATE_ID, so it
 * never fails.
 */
export function pickTemplate(
  kind: RoomKind,
  sides: readonly DoorSide[],
  motifs: readonly MotifId[],
  tier: number,
  rng: Rng,
): RoomTemplate {
  const weights = SIZE_WEIGHTS[kind];
  const sizeClass = rng.weighted(SIZE_ORDER, (size) => {
    const base = weights[SIZE_ORDER.indexOf(size)]!;
    return size === 'large' ? base * (1 + tier * 0.25) : base;
  });
  const hasSockets = (template: RoomTemplate) => sides.every((side) => template.sockets[side] !== undefined);
  const ofKind = ROOM_TEMPLATES.filter((template) => template.kinds.includes(kind) && hasSockets(template));
  const pools = [ofKind.filter((template) => template.sizeClass === sizeClass), ofKind];
  for (const pool of pools) {
    if (pool.length === 0) continue;
    return rng.weighted(pool, (template) => 1 + 4 * template.motifAffinity.filter((motif) => motifs.includes(motif)).length);
  }
  return getTemplate(FALLBACK_TEMPLATE_ID);
}
