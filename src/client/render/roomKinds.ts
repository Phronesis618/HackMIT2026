/**
 * Room-kind dressing for floors rooms (agent F3), so a player can tell at a glance what a
 * room is for. Every feature here stands on the room's `focus` tile, which stays WALKABLE in
 * the sim — so, following the solid/walkable language, none of it gets a top face, a front
 * face or a footprint plate: features are floor inlays, basins and light.
 *
 *   entrance  arrival pad under the spawn
 *   combat    nothing extra
 *   elite     red threat ring at the focus + red sill marks inside every door
 *   treasure  cache pad with a gold glow; goes dark once taken
 *   lore      shelves on the north wall face + violet floor inlay around the relic
 *   rest      warm light and a healing font; goes dim once used
 *   exit      large gate ring; tiers 0–3: the two-way choice site (locked red → lit when the
 *             room is clear); final biome: the anchor site ring around the `A` tile
 */
import type { Palette, RoomSpec } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { hexToInt, tokens } from '../../shared/tokens';
import { hexInt, mix, solidColors } from './color';
import { ROOM_KIND_COLOR } from './doors';
import type { G } from './fx';

const TAU = Math.PI * 2;
const T = TILE_SIZE;

export interface RoomKindState {
  /** The fight (if any) is over. */
  roomCleared: boolean;
  /** Rest site used / cache taken (the sim marks such rooms cleared on use). */
  featureUsed: boolean;
  /** The biome choice is open right now. */
  choiceOpen: boolean;
}

/** What a floors snapshot says about the current room's feature. Pure; tested. */
export function roomKindState(
  room: Pick<RoomSpec, 'roomId' | 'feature'>,
  snapshot: { roomCleared?: boolean | undefined; floor?: { map: Array<{ roomId: string; cleared: boolean }>; biomeChoice: unknown } | null | undefined },
): RoomKindState {
  const entry = snapshot.floor?.map.find((candidate) => candidate.roomId === room.roomId);
  const quiet = room.feature === 'rest' || room.feature === 'treasure';
  return {
    roomCleared: snapshot.roomCleared === true || (!quiet && entry?.cleared === true),
    featureUsed: quiet && entry?.cleared === true,
    choiceOpen: Boolean(snapshot.floor?.biomeChoice),
  };
}

/** Prompt over the focus, or null. Plain and concrete (docs/WRITING.md). */
export function featurePrompt(room: Pick<RoomSpec, 'feature'>, state: RoomKindState): string | null {
  switch (room.feature) {
    case 'biome_exit': return state.choiceOpen ? null : state.roomCleared ? 'HOLD F · CHOOSE THE WAY ON' : 'GATE LOCKED · CLEAR THE ROOM';
    case 'rest': return state.featureUsed ? 'FONT SPENT' : 'REST SITE · STAND HERE TO HEAL';
    case 'treasure': return state.featureUsed ? 'CACHE EMPTY' : 'CACHE · WALK OVER TO TAKE';
    default: return null;
  }
}

function ring(g: G, x: number, y: number, r: number, color: number, alpha: number, width = 1.5): void {
  g.lineStyle(width, color, alpha).strokeCircle(x, y, r);
}

function ticks(g: G, x: number, y: number, r0: number, r1: number, count: number, color: number, alpha: number, offset = 0): void {
  g.lineStyle(1.5, color, alpha);
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * TAU;
    g.lineBetween(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  }
}

/** Drawn once per room, under props and entities. */
export function drawRoomKindStatic(g: G, room: RoomSpec, palette: Palette): void {
  if (room.kind === undefined || !room.focus) return;
  const f = tileToWorld(room.focus.x, room.focus.y);
  const accent = hexInt(palette.accent);
  const inlay = mix(palette.floor, '#000000', 0.4);
  const danger = hexToInt(tokens.color.danger);

  switch (room.kind) {
    case 'entrance': {
      let spawn = f;
      room.tiles.forEach((line, row) => { const col = line.indexOf('P'); if (col >= 0) spawn = tileToWorld(col, row); });
      g.fillStyle(inlay, 0.5).fillCircle(spawn.x, spawn.y, 22);
      ring(g, spawn.x, spawn.y, 22, accent, 0.55);
      ring(g, spawn.x, spawn.y, 16, accent, 0.25, 1);
      ticks(g, spawn.x, spawn.y, 24, 30, 4, accent, 0.6, Math.PI / 4);
      break;
    }
    case 'elite': {
      g.fillStyle(danger, 0.06).fillCircle(f.x, f.y, 58);
      ring(g, f.x, f.y, 58, danger, 0.5, 2);
      ring(g, f.x, f.y, 50, danger, 0.2, 1);
      ticks(g, f.x, f.y, 58, 70, 8, danger, 0.6);
      // red sill inside every door: you see the threat colour before you commit
      for (const exit of room.exits) {
        const entry = exit.entry ?? { x: exit.x, y: exit.y };
        const e = tileToWorld(entry.x, entry.y);
        g.fillStyle(danger, 0.16).fillRect(e.x - T / 2, e.y - T / 2, T, T);
        g.lineStyle(1.5, danger, 0.55).strokeRect(e.x - T / 2 + 3, e.y - T / 2 + 3, T - 6, T - 6);
      }
      break;
    }
    case 'treasure': {
      const gold = hexInt(ROOM_KIND_COLOR.treasure!);
      g.fillStyle(inlay, 0.6).fillRect(f.x - 20, f.y - 20, 40, 40);
      g.lineStyle(1.5, gold, 0.7).strokeRect(f.x - 20, f.y - 20, 40, 40);
      g.lineStyle(1, gold, 0.35).strokeRect(f.x - 26, f.y - 26, 52, 52);
      break;
    }
    case 'lore': {
      const violet = hexInt(ROOM_KIND_COLOR.lore!);
      g.fillStyle(violet, 0.06).fillCircle(f.x, f.y, 44);
      ring(g, f.x, f.y, 44, violet, 0.45);
      ticks(g, f.x, f.y, 44, 52, 12, violet, 0.4);
      drawShelves(g, room, palette, violet);
      break;
    }
    case 'rest': {
      const warm = hexToInt(tokens.color.warmLamp);
      for (let k = 6; k >= 1; k--) g.fillStyle(warm, 0.028).fillCircle(f.x, f.y, 28 * k);
      g.fillStyle(inlay, 0.75).fillCircle(f.x, f.y, 24);
      ring(g, f.x, f.y, 24, warm, 0.8, 2);
      ring(g, f.x, f.y, 30, warm, 0.3, 1);
      break;
    }
    case 'exit': {
      const white = 0xffffff;
      g.fillStyle(inlay, 0.45).fillCircle(f.x, f.y, 62);
      ring(g, f.x, f.y, 62, white, 0.55, 2.5);
      ring(g, f.x, f.y, 70, accent, 0.4, 1.5);
      ticks(g, f.x, f.y, 62, 76, 16, white, 0.4);
      if (room.feature === 'biome_exit') {
        // the plinth the two ways stand on
        g.fillStyle(inlay, 0.8).fillRoundedRect(f.x - 46, f.y - 12, 92, 24, 6);
        g.lineStyle(1.5, white, 0.5).strokeRoundedRect(f.x - 46, f.y - 12, 92, 24, 6);
      }
      break;
    }
    default:
      break;
  }
}

/** Book shelves on the south-facing wall faces of the north wall: on the wall, never on the floor. */
function drawShelves(g: G, room: RoomSpec, palette: Palette, tint: number): void {
  const solid = solidColors(palette);
  let placed = 0;
  for (let row = 0; row < room.height - 1 && placed < 10; row++) {
    for (let col = 1; col < room.width - 1 && placed < 10; col++) {
      const here = room.tiles[row]?.[col];
      const below = room.tiles[row + 1]?.[col];
      if (here !== '#' || below === undefined || below === '#' || below === ' ' || below === 'X') continue;
      if ((col + row) % 3 === 0) continue;
      const x = col * T;
      const y = row * T + T * 0.46;
      g.fillStyle(solid.faceLow, 1).fillRect(x + 3, y, T - 6, T * 0.5 - 2);
      g.lineStyle(1, solid.capHi, 0.6).lineBetween(x + 3, y + 8, x + T - 3, y + 8);
      for (let i = 0; i < 6; i++) {
        const lit = (col * 7 + i * 3 + row) % 4 === 0;
        g.fillStyle(lit ? tint : solid.cap, lit ? 0.9 : 0.55).fillRect(x + 5 + i * 4, y + 1.5 + ((i + col) % 2), 3, 6);
        g.fillStyle(lit ? tint : solid.cap, 0.4).fillRect(x + 5 + i * 4, y + 10, 3, 5);
      }
      placed++;
    }
  }
}

/** Redrawn every frame: glows, the gate's two portals, used/unused state. */
export function drawRoomKindDynamic(g: G, room: RoomSpec, palette: Palette, state: RoomKindState, timeSec: number): void {
  if (room.kind === undefined || !room.focus) return;
  const f = tileToWorld(room.focus.x, room.focus.y);
  const pulse = 0.5 + 0.5 * Math.sin(timeSec * 2.2);
  const accent = hexInt(palette.accent);
  const danger = hexToInt(tokens.color.danger);

  if (room.feature === 'treasure') {
    const gold = hexInt(ROOM_KIND_COLOR.treasure!);
    if (state.featureUsed) {
      g.lineStyle(1.5, gold, 0.25).strokeRect(f.x - 8, f.y - 6, 16, 12);
    } else {
      g.fillStyle(gold, 0.07 + 0.06 * pulse).fillCircle(f.x, f.y, 46 + pulse * 6);
      g.fillStyle(gold, 0.12 + 0.08 * pulse).fillCircle(f.x, f.y, 24);
      // the cache itself: a low case with a gem on it
      g.fillStyle(0x000000, 0.35).fillEllipse(f.x + 1, f.y + 9, 30, 9);
      g.fillStyle(mix(palette.wall, '#000000', 0.2), 1).fillRoundedRect(f.x - 12, f.y - 6, 24, 15, 3);
      g.lineStyle(1.5, gold, 0.95).strokeRoundedRect(f.x - 12, f.y - 6, 24, 15, 3);
      const lift = Math.sin(timeSec * 1.8) * 2;
      g.fillStyle(gold, 1).fillTriangle(f.x - 6, f.y - 14 + lift, f.x + 6, f.y - 14 + lift, f.x, f.y - 5 + lift);
      g.fillStyle(0xffffff, 0.9).fillTriangle(f.x - 6, f.y - 14 + lift, f.x + 6, f.y - 14 + lift, f.x, f.y - 21 + lift);
    }
  } else if (room.feature === 'rest') {
    const heal = hexToInt(tokens.color.success);
    const live = state.featureUsed ? 0.25 : 1;
    g.fillStyle(heal, (0.16 + 0.12 * pulse) * live).fillCircle(f.x, f.y, 21);
    for (let i = 0; i < 3; i++) {
      const r = ((timeSec * 9 + i * 8) % 24);
      g.lineStyle(1.2, heal, (1 - r / 24) * 0.7 * live).strokeCircle(f.x, f.y, r);
    }
    g.fillStyle(heal, 0.95 * live).fillRect(f.x - 2.5, f.y - 9, 5, 18).fillRect(f.x - 9, f.y - 2.5, 18, 5);
    if (!state.featureUsed) {
      for (let i = 0; i < 4; i++) {
        const rise = (timeSec * 14 + i * 11) % 44;
        g.fillStyle(heal, (1 - rise / 44) * 0.8).fillCircle(f.x - 12 + i * 8, f.y - 8 - rise, 1.6);
      }
    }
  } else if (room.feature === 'biome_exit') {
    // Two portals on the plinth: red and shut while the gatekeeper lives, lit once the room is clear.
    const open = state.roomCleared;
    const color = open ? accent : danger;
    for (const side of [-1, 1]) {
      const px = f.x + side * 26;
      const py = f.y - 4;
      g.fillStyle(color, open ? 0.1 + 0.08 * pulse : 0.05).fillEllipse(px, py + 2, 40, 52);
      g.lineStyle(3, color, open ? 0.95 : 0.55).beginPath().arc(px, py, 15, Math.PI, 0, false).strokePath();
      g.lineBetween(px - 15, py, px - 15, py + 14).lineBetween(px + 15, py, px + 15, py + 14);
      if (open) {
        g.fillStyle(side < 0 ? accent : 0xffffff, 0.16 + 0.12 * pulse).fillRect(px - 12, py - 8, 24, 22);
        g.lineStyle(1, 0xffffff, 0.5 + 0.4 * pulse).beginPath().arc(px, py, 10, Math.PI, 0, false).strokePath();
      } else {
        g.lineStyle(2, danger, 0.8).lineBetween(px - 12, py - 2, px + 12, py - 2).lineBetween(px - 12, py + 5, px + 12, py + 5);
      }
    }
    if (open && !state.choiceOpen) ring(g, f.x, f.y, 40 + pulse * 5, accent, 0.5 * (1 - pulse * 0.6), 2);
  } else if (room.kind === 'elite' && !state.roomCleared) {
    ring(g, f.x, f.y, 58 + pulse * 4, danger, 0.35 * (1 - pulse), 2);
  }
}
