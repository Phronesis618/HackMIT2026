/**
 * Floors doorways (agent F3). A floors room has one `X` tile per door on its border wall.
 *
 * Reading order for a player, fastest first:
 *   1. SEALED (combat): the opening is closed by red energy bars on a dark shutter.
 *   2. OPEN, leads somewhere NEW: bright accent strips, a pulsing chevron, a lit stub beyond.
 *   3. OPEN, leads somewhere already VISITED: same frame, dim neutral light, no pulse.
 * When the sim has revealed what is behind a door (`FloorMapRoom.kind`), the frame light
 * takes that room kind's colour, Isaac-style.
 *
 * `selectDoorViews` is pure (tested); the draw functions only take a Graphics-like object.
 */
import type { Palette, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import type { FloorRunState, RoomKind } from '../../shared/floors';
import { hexToInt, tokens } from '../../shared/tokens';
import { hexInt, mix, solidColors } from './color';
import type { G } from './fx';

export type DoorState = 'open' | 'sealed';
export type DoorDestination = 'unvisited' | 'visited';
type Direction = RoomSpec['exits'][number]['direction'];

export interface DoorView {
  x: number;
  y: number;
  direction: Direction;
  toRoomId: string | null;
  state: DoorState;
  destination: DoorDestination;
  /** Known kind of the room behind the door, or null while the map hides it. */
  kind: RoomKind | null;
}

/** Which look each door of `room` gets for this snapshot. No floor state = open, unvisited. */
export function selectDoorViews(room: Pick<RoomSpec, 'exits'>, floor: FloorRunState | null | undefined): DoorView[] {
  return room.exits.map((exit) => {
    const toRoomId = exit.toRoomId ?? null;
    const seen = toRoomId ? floor?.map.find((entry) => entry.roomId === toRoomId) : undefined;
    return {
      x: exit.x,
      y: exit.y,
      direction: exit.direction,
      toRoomId,
      state: floor?.doorsLocked ? 'sealed' : 'open',
      destination: seen?.state === 'visited' ? 'visited' : 'unvisited',
      kind: seen?.kind ?? null,
    };
  });
}

/** Frame-light colour for a known destination kind; null = use the biome accent. */
export const ROOM_KIND_COLOR: Record<RoomKind, string | null> = {
  entrance: null,
  combat: null,
  elite: tokens.color.danger,
  treasure: '#f2c14e',
  lore: '#b79cff',
  rest: tokens.color.success,
  exit: '#ffffff',
  shop: '#f2c14e',
};

const OUT: Record<Direction, { ox: number; oy: number }> = {
  north: { ox: 0, oy: -1 },
  south: { ox: 0, oy: 1 },
  east: { ox: 1, oy: 0 },
  west: { ox: -1, oy: 0 },
};

/** Axis-aligned rect given in door space: `o` = distance outward from the tile centre, `l` = lateral. */
function doorRect(g: G, door: { x: number; y: number; direction: Direction }, o0: number, o1: number, l0: number, l1: number): G {
  const c = tileToWorld(door.x, door.y);
  const { ox, oy } = OUT[door.direction];
  // lateral axis = outward rotated 90°
  const lx = -oy;
  const ly = ox;
  const xa = c.x + ox * o0 + lx * l0;
  const xb = c.x + ox * o1 + lx * l1;
  const ya = c.y + oy * o0 + ly * l0;
  const yb = c.y + oy * o1 + ly * l1;
  return g.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
}

function doorPoint(door: { x: number; y: number; direction: Direction }, o: number, l: number): { x: number; y: number } {
  const c = tileToWorld(door.x, door.y);
  const { ox, oy } = OUT[door.direction];
  return { x: c.x + ox * o - oy * l, y: c.y + oy * o + ox * l };
}

const HALF = TILE_SIZE / 2;
const OPENING = 10; // half-width of the walkable opening
const EXIT_EXTRA = 5; // the biome exit gate has heavier posts

/** Static part, drawn once per room: threshold, posts, outline. */
export function drawDoorFrames(g: G, room: RoomSpec, palette: Palette): void {
  const solid = solidColors(palette);
  const sill = mix(palette.floor, '#000000', 0.35);
  const sillLine = mix(palette.floor, palette.text, 0.25);
  for (const door of room.exits) {
    // threshold: floor-level, a little darker than the room floor, with tread lines
    g.fillStyle(sill, 1);
    doorRect(g, door, -HALF, HALF + 3, -OPENING, OPENING);
    g.fillStyle(sillLine, 0.5);
    for (const o of [-10, -3, 4, 11]) doorRect(g, door, o, o + 1.5, -OPENING + 2, OPENING - 2);
    // posts: same solid language as the walls (light top, dark outline), standing proud of the wall
    for (const side of [-1, 1]) {
      const l0 = side * OPENING;
      const l1 = side * (HALF + 2);
      g.fillStyle(solid.outline, 1);
      doorRect(g, door, -HALF - 3, HALF + 5, l0 - side * 1.5, l1 + side * 1.5);
      g.fillStyle(solid.capHi, 1);
      doorRect(g, door, -HALF - 1.5, HALF + 3.5, l0, l1);
      g.fillStyle(solid.face, 1);
      doorRect(g, door, -HALF - 1.5, -HALF + 3, l0, l1);
    }
  }
}

/**
 * Dynamic part, redrawn every frame. `seal` is 0 (open) … 1 (shut) and eases between the
 * two so locking and unlocking are each a short, readable motion.
 */
export function drawDoorStates(g: G, views: DoorView[], palette: Palette, seal: number, timeSec: number, isExitRoom = false): void {
  const accent = hexInt(palette.accent);
  const danger = hexToInt(tokens.color.danger);
  const neutral = mix(palette.text, palette.background, 0.45);
  const pulse = 0.5 + 0.5 * Math.sin(timeSec * 2.6);
  const openness = 1 - seal;
  for (const view of views) {
    const fresh = view.destination === 'unvisited';
    const kindColor = view.kind ? ROOM_KIND_COLOR[view.kind] : null;
    const light = kindColor ? hexInt(kindColor) : fresh ? accent : neutral;
    const heavy = view.kind === 'exit' || isExitRoom ? EXIT_EXTRA : 0;

    // the stub of corridor beyond the door: lit when it leads somewhere new
    if (openness > 0.02) {
      for (let k = 0; k < 4; k++) {
        g.fillStyle(light, (fresh ? 0.2 : 0.07) * openness * (1 - k / 4));
        doorRect(g, view, HALF + 3 + k * 4, HALF + 7 + k * 4, -OPENING + k, OPENING - k);
      }
      if (fresh) {
        g.fillStyle(light, (0.05 + 0.07 * pulse) * openness);
        doorRect(g, view, -HALF, HALF + 3, -OPENING, OPENING);
      }
    }
    // light strips on the inner edge of each post; red while sealed
    const strip = seal > 0.5 ? danger : light;
    g.fillStyle(strip, seal > 0.5 ? 0.95 : fresh ? 0.75 + 0.25 * pulse : 0.5);
    doorRect(g, view, -HALF, HALF + 3, -OPENING - 2.5 - heavy * 0.4, -OPENING);
    doorRect(g, view, -HALF, HALF + 3, OPENING, OPENING + 2.5 + heavy * 0.4);

    // direction cue: a chevron pointing out of the room
    if (openness > 0.3) {
      const tip = doorPoint(view, 8, 0);
      const a = doorPoint(view, -2, -6);
      const b = doorPoint(view, -2, 6);
      g.lineStyle(2.5, light, (fresh ? 0.7 + 0.3 * pulse : 0.45) * openness);
      g.lineBetween(a.x, a.y, tip.x, tip.y).lineBetween(b.x, b.y, tip.x, tip.y);
      if (fresh) {
        const tip2 = doorPoint(view, 8 - 7, 0);
        const a2 = doorPoint(view, -2 - 7, -6);
        const b2 = doorPoint(view, -2 - 7, 6);
        g.lineStyle(2, light, 0.35 * pulse * openness);
        g.lineBetween(a2.x, a2.y, tip2.x, tip2.y).lineBetween(b2.x, b2.y, tip2.x, tip2.y);
      }
    }

    // the shutter: a dark plate and three energy bars that close from both posts
    if (seal > 0.02) {
      g.fillStyle(0x05060b, 0.82 * seal);
      doorRect(g, view, -6, 8, -OPENING, OPENING);
      const reach = OPENING * seal;
      for (const o of [-4, 1, 6]) {
        g.fillStyle(danger, 0.25 * seal);
        doorRect(g, view, o - 1.5, o + 3, -OPENING, -OPENING + reach);
        doorRect(g, view, o - 1.5, o + 3, OPENING - reach, OPENING);
        g.fillStyle(danger, 0.95);
        doorRect(g, view, o, o + 1.6, -OPENING, -OPENING + reach);
        doorRect(g, view, o, o + 1.6, OPENING - reach, OPENING);
      }
      if (seal > 0.9) {
        const c = doorPoint(view, 1.8, 0);
        g.fillStyle(0xffffff, 0.85).fillRect(c.x - 1.5, c.y - 1.5, 3, 3);
      }
    }
  }
}

/** Moves `current` toward `target` (0 or 1); ~220 ms for the full travel. */
export function stepSeal(current: number, target: number, deltaMs: number): number {
  const step = deltaMs / 220;
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}
