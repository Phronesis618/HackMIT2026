/**
 * Shared spatial, timing, input and event-ID conventions.
 * Owner: Agent A. Every agent's code assumes these; do not fork them locally.
 *
 * COORDINATES
 *  - World units are pixels at 1x zoom. Origin is the room's top-left corner.
 *    +x is right, +y is DOWN (screen convention). Angles are radians, 0 = +x,
 *    increasing clockwise on screen (because +y is down).
 *  - RoomSpec.tiles is row-major: tiles[row][col]. Tile (col, row) covers world
 *    rect [col*TILE_SIZE, (col+1)*TILE_SIZE) x [row*TILE_SIZE, (row+1)*TILE_SIZE).
 *  - Prop/encounter/exit coordinates in RoomSpec are TILE coordinates (col, row).
 *    Entity positions in GameSnapshot are WORLD coordinates (pixels), centre point.
 *
 * COLLISION
 *  - Entities are circles (centre + radius). Walls/void/blocking props are axis-aligned
 *    tile squares. Resolution is per-axis slide (move x, resolve, move y, resolve).
 *  - Exits trigger when the player's centre is inside an 'X' tile.
 *
 * TIME
 *  - Fixed simulation step: TICK_MS. `tick` increments once per step. `timeMs` is
 *    tick * TICK_MS (simulation time, not wall clock).
 *
 * EVENT IDS
 *  - Authoritative simulation assigns `${tick}:${n}` where n is the 0-based index of
 *    the event within that tick. IDs are unique per run and stable across host and
 *    clients, so the Chronicle can dedupe replays and network retries by id.
 *  - Non-simulation events (contribution_submitted, world_prepared) use the prefix
 *    `meta:` + a monotonically increasing counter from the same session.
 */

export const TILE_SIZE = 32;
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

export const PLAYER_RADIUS = 12;
export const PLAYER_MAX_HP = 100;
export const PLAYER_SPEED = 190; // world units per second
export const DASH_SPEED = 640;
export const DASH_DURATION_MS = 150;
export const DASH_COOLDOWN_MS = 800;
export const DASH_INVULNERABLE_MS = 150;
export const ATTACK_DURATION_MS = 220;
export const ATTACK_COOLDOWN_MS = 360;
export const ATTACK_RANGE = 46; // reach from player centre
export const ATTACK_ARC_RAD = Math.PI * 0.7; // total arc width
/** Hazard floor ('~' tiles) bites operatives who stand in it. */
export const HAZARD_DAMAGE = 6;          // per bite
export const HAZARD_TICK_MS = 700;
export const ROOM_CLEAR_REWARD = 3;
export const ABILITY_UNLOCK_COST = 3;
export const REVIVE_RANGE = 56;
export const REVIVE_DURATION_MS = 2000;
export const REVIVE_HP = 40;
export const ANCHOR_RANGE = 64;
export const ANCHOR_HOLD_MS = 3000;
/** Relics are read by holding F beside them; remains are picked up by touch. */
export const LORE_READ_RANGE = 48;
export const LORE_READ_MS = 700;
export const LORE_PICKUP_RANGE = 22;

/**
 * DRAW ORDER (Phaser depth). Entities are y-sorted inside their band:
 * depth = DEPTH.entities + y / 10000.
 */
export const DEPTH = {
  background: -10,
  floor: 0,
  floorDecal: 10,
  propsBehind: 20,
  entities: 30,
  propsFront: 40,
  effects: 50,
  fog: 60,
  overlay: 70,
} as const;

/**
 * INPUT (client-side, documented here so the HUD and tutorial text agree)
 *  Move: WASD or arrow keys     Aim: mouse position (world coords)
 *  Attack: J or left mouse       Dash: Shift or Space
 *  Q ability: Q                  E ability: E (unlockable)    Interact: hold F
 *  Intent is sampled once per simulation tick; buttons are edge-triggered
 *  (true for the tick in which they were pressed) so holding does not spam.
 *  Interact is held and must be sent each tick while reviving or planting.
 */
export const INPUT_BINDINGS = {
  moveUp: ['KeyW', 'ArrowUp'],
  moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ'],
  dash: ['ShiftLeft', 'ShiftRight', 'Space'],
  abilityQ: ['KeyQ'],
  abilityE: ['KeyE'],
  abilityR: ['KeyR'],
  interact: ['KeyF'],
} as const;

export function tileToWorld(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

export function worldToTile(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
}
