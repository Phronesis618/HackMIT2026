/**
 * The headquarters is a built-in, walkable RoomSpec. Its single 'X' tile is the portal
 * (toRoomIndex 0 = the first expedition room). Agent C owns how it LOOKS
 * (src/client/render); Agent A owns this layout because the simulation walks it.
 */
import { type ArtRecipe, type RoomSpec, RoomSpecSchema } from '../shared/contracts';
import {
  HEADQUARTERS_ID, HEADQUARTERS_LANTERNS, HEADQUARTERS_PROPLESS_STATIONS, HEADQUARTERS_RELIC_BRACKETS, HEADQUARTERS_STATIONS,
} from '../shared/headquarters';

export const HEADQUARTERS_ROOM_ID = HEADQUARTERS_ID;

const width = 30;
const height = 20;
const tiles = Array.from({ length: height }, (_, y) =>
  Array.from({ length: width }, (_, x) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return '#';
    if ((x === 11 || x === 19) && y < 9 && y !== 5 && y !== 6) return '#';
    if (y === 13 && ((x < 11 && x !== 6 && x !== 7) || (x > 19 && x !== 22 && x !== 23))) return '#';
    if ((x === 11 || x === 19) && y > 13 && y !== 15 && y !== 16) return '#';
    if (x === 15 && y === 10) return 'P';
    if (x === 15 && y === 18) return 'X';
    return '.';
  }).join(''),
);

export const headquartersRoom: RoomSpec = RoomSpecSchema.parse({
  id: HEADQUARTERS_ROOM_ID,
  index: 0,
  name: 'The Stillpoint',
  description: 'Headquarters. Weapons in the armory, records in the archive, the next world at the observatory.',
  width,
  height,
  tiles,
  props: [
    ...HEADQUARTERS_STATIONS.filter((station) => !HEADQUARTERS_PROPLESS_STATIONS.has(station.id)).map((station) => ({
      id: `hq-station-${station.id}`, propId: 'terminal' as const, x: station.x, y: station.y,
    })),
    ...HEADQUARTERS_RELIC_BRACKETS.map((bracket, index) => ({
      id: `hq-relic-bracket-${index}`, propId: 'monolith_shard' as const, x: bracket.x, y: bracket.y,
    })),
    ...HEADQUARTERS_LANTERNS.map((lantern) => ({ id: lantern.id, propId: 'lantern' as const, x: lantern.x, y: lantern.y })),
    { id: 'hq-pillar-a', propId: 'pillar', x: 13, y: 3 },
    { id: 'hq-pillar-b', propId: 'pillar', x: 17, y: 3 },
    { id: 'hq-archive-spine', propId: 'monolith_shard', x: 27, y: 6 },
    { id: 'hq-navigation-cable', propId: 'cable_bundle', x: 27, y: 17 },
  ],
  encounters: [],
  exits: [{ x: 15, y: 18, toRoomIndex: 0, direction: 'south' }],
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
