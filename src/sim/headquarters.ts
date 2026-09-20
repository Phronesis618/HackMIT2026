/**
 * The headquarters is a built-in, walkable RoomSpec. Its single 'X' tile is the portal
 * (toRoomIndex 0 = the first expedition room). Agent C owns how it LOOKS
 * (src/client/render); Agent A owns this layout because the simulation walks it.
 */
import { type ArtRecipe, type RoomSpec, RoomSpecSchema } from '../shared/contracts';

export const HEADQUARTERS_ROOM_ID = 'headquarters';

export const headquartersRoom: RoomSpec = RoomSpecSchema.parse({
  id: HEADQUARTERS_ROOM_ID,
  index: 0,
  name: 'Relay Headquarters',
  description: 'The sanctuary between worlds. Contribute an idea, then step through the portal.',
  width: 22,
  height: 12,
  tiles: [
    '######################',
    '#....................#',
    '#..##............##..#',
    '#....................#',
    '#....................#',
    '#.........P..........#',
    '#....................#',
    '#....................#',
    '#..##............##..#',
    '#....................#',
    '#..........X.........#',
    '######################',
  ],
  props: [
    { id: 'hq-console', propId: 'terminal', x: 10, y: 1 },
    { id: 'hq-lantern-a', propId: 'lantern', x: 3, y: 3 },
    { id: 'hq-lantern-b', propId: 'lantern', x: 18, y: 3 },
    { id: 'hq-lantern-c', propId: 'lantern', x: 3, y: 9 },
    { id: 'hq-lantern-d', propId: 'lantern', x: 18, y: 9 },
    { id: 'hq-pillar-a', propId: 'pillar', x: 6, y: 5 },
    { id: 'hq-pillar-b', propId: 'pillar', x: 15, y: 5 },
  ],
  encounters: [],
  exits: [{ x: 11, y: 10, toRoomIndex: 0, direction: 'south' }],
  isFinal: false,
  attributions: [],
});

/** Headquarters palette: warmer than expedition worlds, same ink-neon family. */
export const headquartersArt: ArtRecipe = {
  paletteFamily: 'ink-neon',
  palette: {
    background: '#0b1020',
    floor: '#182238',
    floorAlt: '#1e2b46',
    wall: '#2a3a5e',
    wallEdge: '#6c86c8',
    accent: '#7cf5ff',
    accentSoft: '#ffcf8a',
    glow: '#7cf5ff',
    hazard: '#ff5c7a',
    text: '#dbe4f7',
  },
  motifIds: ['arches', 'lanterns'],
  skyline: 'arches',
  fog: 0.15,
  glowIntensity: 0.8,
};
