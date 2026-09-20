import type Phaser from 'phaser';
import type { Palette, RoomSpec, TerrainSkin } from '../../shared/contracts';
import { TILE_SIZE, tileToWorld } from '../../shared/conventions';
import { terrainTileAt, terrainTileKey, ventChargeProgress, ventState, type TerrainState } from '../../shared/terrain';
import { TERRAIN_CAPTION, type TerrainFeatureId } from '../../shared/registry';
import { hexInt, mix, solidColors } from './color';

export interface TerrainTile { x: number; y: number }

/**
 * Tiles this layer draws or captions. '~' is painted by the floor pass in environment.ts; it is
 * listed here so a player standing beside scalding floor still gets told what it is.
 */
const CAPTIONED_TILES = 'B=>:+~*o^-';

export function collectTerrainTiles(room: RoomSpec): TerrainTile[] {
  const tiles: TerrainTile[] = [];
  room.tiles.forEach((row, y) => {
    [...row].forEach((tile, x) => { if (CAPTIONED_TILES.includes(tile)) tiles.push({ x, y }); });
  });
  return tiles;
}

/** Which feature a tile belongs to, for the skin lookup. */
const TILE_FEATURE: Record<string, TerrainFeatureId> = {
  B: 'breakable_walls', ':': 'rubble', '+': 'conduits', '~': 'hazard_floor',
  '*': 'canisters', o: 'pits', '^': 'vents', '-': 'cover', '=': 'bridges', '>': 'bridges',
};

/**
 * The HUD line for whatever the player is standing beside.
 *
 * `skins` is the world's own naming of its terrain (WorldRecipe.terrainSkins). The default from
 * the registry is always present, so a world that writes nothing — or writes something the
 * prose linter rejects — degrades to today's text rather than to nothing.
 */
export function terrainCaption(
  room: RoomSpec, tiles: TerrainTile[], state: TerrainState | undefined, player: { x: number; y: number },
  skins: readonly TerrainSkin[] = [],
): string | null {
  let nearest: TerrainTile | undefined;
  let distance = TILE_SIZE * 1.45;
  for (const tile of tiles) {
    const point = tileToWorld(tile.x, tile.y);
    const d = Math.hypot(point.x - player.x, point.y - player.y);
    if (d < distance) { distance = d; nearest = tile; }
  }
  if (!nearest) return null;
  const type = terrainTileAt(room, nearest.x, nearest.y, state?.brokenWalls);
  const feature = TILE_FEATURE[type];
  const skinned = feature ? skins.find((skin) => skin.featureId === feature)?.caption : undefined;
  if (skinned) return skinned;
  switch (type) {
    case 'B': return TERRAIN_CAPTION.breakable_walls;
    case ':': return TERRAIN_CAPTION.rubble;
    case '+': return TERRAIN_CAPTION.conduits;
    case '~': return TERRAIN_CAPTION.hazard_floor;
    case '*': return TERRAIN_CAPTION.canisters;
    case 'o': return TERRAIN_CAPTION.pits;
    case '^': return TERRAIN_CAPTION.vents;
    case '-': return TERRAIN_CAPTION.cover;
    case '>':
    case '=': return TERRAIN_CAPTION.bridges;
    default: return null;
  }
}

/**
 * Terrain tiles, in the same solid/walkable language as the walls:
 *  - `B` (solid until broken) is a raised block: light top, dark front face, cast shadow,
 *    near-black outline, plus amber fracture marks that say "this one breaks".
 *  - `=` `>` `:` `+` are walkable, so they stay at floor level: no top face, no front face,
 *    no cast shadow, and a value close to the floor's.
 */
export function drawTerrain(
  g: Phaser.GameObjects.Graphics, room: RoomSpec, tiles: TerrainTile[], state: TerrainState | undefined,
  palette: Palette, timeMs: number,
): void {
  g.clear();
  const accent = hexInt(palette.accent);
  const solid = solidColors(palette);
  const deck = mix(palette.floor, palette.text, 0.16);
  const deckLine = mix(palette.floor, '#000000', 0.45);
  const pebble = mix(palette.floor, palette.text, 0.3);
  const T = TILE_SIZE;
  for (const tile of tiles) {
    const x = tile.x * T;
    const y = tile.y * T;
    const type = terrainTileAt(room, tile.x, tile.y, state?.brokenWalls);
    if (type === 'B') {
      const damaged = (state?.wallDamage[terrainTileKey(tile.x, tile.y)] ?? 0) > 0;
      const below = room.tiles[tile.y + 1]?.[tile.x] ?? ' ';
      const openBelow = below !== '#' && below !== ' ';
      if (openBelow) g.fillStyle(0x000000, 0.3).fillRect(x, y + T, T, 7);
      g.fillStyle(solid.cap, 1).fillRect(x, y, T, T);
      g.fillStyle(solid.capHi, 0.8).fillRect(x, y, T, 2.5);
      if (openBelow) {
        g.fillStyle(solid.face, 1).fillRect(x, y + T * 0.42, T, T * 0.58);
        g.fillStyle(solid.faceLow, 1).fillRect(x, y + T - 6, T, 6);
      }
      g.lineStyle(1.5, solid.outline, 1).strokeRect(x, y, T, T);
      g.lineStyle(1.5, 0xf2bb71, 0.9).strokeRect(x + 3, y + 3, T - 6, T - 6);
      g.lineStyle(damaged ? 3 : 1.5, solid.outline, 1)
        .lineBetween(x + 17, y + 2, x + 10, y + 13)
        .lineBetween(x + 10, y + 13, x + 21, y + 19)
        .lineBetween(x + 21, y + 19, x + 14, y + 30);
      if (damaged) g.lineBetween(x + 10, y + 13, x + 2, y + 19).lineBetween(x + 21, y + 19, x + 30, y + 13);
    } else if (type === '-') {
      // Half a wall, and the silhouette has to say so: it occupies the lower two thirds of the
      // tile with a lit top edge, so you read "I can walk over that, my bolts cannot".
      const chipped = (state?.coverDamage?.[terrainTileKey(tile.x, tile.y)] ?? 0) > 0;
      g.fillStyle(0x000000, 0.28).fillRect(x + 1, y + T - 5, T - 2, 6);
      g.fillStyle(solid.face, 1).fillRect(x + 1, y + T * 0.42, T - 2, T * 0.5);
      g.fillStyle(solid.faceLow, 1).fillRect(x + 1, y + T - 8, T - 2, 5);
      g.fillStyle(solid.capHi, 0.95).fillRect(x + 1, y + T * 0.38, T - 2, 4);
      g.lineStyle(1.25, solid.outline, 0.9).strokeRect(x + 1, y + T * 0.38, T - 2, T * 0.54);
      g.lineStyle(1, deckLine, 0.7);
      for (let i = 8; i < T - 4; i += 9) g.lineBetween(x + i, y + T * 0.42, x + i, y + T - 4);
      if (chipped) {
        g.lineStyle(2, solid.outline, 1)
          .lineBetween(x + 9, y + T * 0.4, x + 14, y + T * 0.72)
          .lineBetween(x + 20, y + T * 0.44, x + 17, y + T * 0.8);
      }
    } else if (type === '^') {
      // Flush grille while idle. The 500 ms charge flickers at 9 Hz — a rate no ambient
      // dressing uses, so it reads as mechanism rather than decoration — and the 300 ms firing
      // window is a full-tile column. State is a pure function of sim time, so this needs no
      // snapshot: every client draws the same beat as the host.
      const phase = ventState(timeMs, tile.x, tile.y);
      const danger = hexInt(palette.hazard);
      g.fillStyle(deck, 1).fillRect(x + 2, y + 2, T - 4, T - 4);
      g.lineStyle(1, deckLine, 0.85);
      for (let i = 7; i < T - 4; i += 6) g.lineBetween(x + 4, y + i, x + T - 4, y + i);
      g.lineStyle(1, deckLine, 0.9).strokeRect(x + 2, y + 2, T - 4, T - 4);
      if (phase === 'charging') {
        const charge = ventChargeProgress(timeMs, tile.x, tile.y);
        const flicker = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((timeMs / 1000) * 9 * Math.PI * 2));
        g.fillStyle(danger, 0.12 + 0.3 * charge * flicker).fillRect(x + 2, y + 2, T - 4, T - 4);
        g.lineStyle(2, danger, 0.5 + 0.5 * flicker).strokeRect(x + 3, y + 3, T - 6, T - 6);
        for (let i = 0; i < 3; i++) {
          const rise = ((timeMs / 5 + i * 90) % 100) / 100;
          g.fillStyle(danger, 0.4 * (1 - rise)).fillRect(x + 7 + i * 8, y + T - 6 - rise * 10, 2, 4);
        }
      } else if (phase === 'firing') {
        g.fillStyle(danger, 0.85).fillRect(x + 1, y + 1, T - 2, T - 2);
        g.fillStyle(0xffffff, 0.55).fillRect(x + 5, y + 1, T - 10, T - 2);
        g.lineStyle(2, danger, 1).strokeRect(x, y, T, T);
      }
    } else if (type === 'o') {
      // A hole, so it is drawn as an absence: black interior, a lit inner rim, and a shadow
      // under the north edge. Nothing here is raised — the silhouette must read as "down".
      const open = (dx: number, dy: number) => (room.tiles[tile.y + dy]?.[tile.x + dx] ?? ' ') !== 'o';
      g.fillStyle(0x05070c, 1).fillRect(x, y, T, T);
      if (open(0, -1)) g.fillStyle(0x000000, 0.55).fillRect(x, y, T, 6);
      g.lineStyle(3, accent, 0.35);
      if (open(0, -1)) g.lineBetween(x, y + 1.5, x + T, y + 1.5);
      if (open(0, 1)) g.lineBetween(x, y + T - 1.5, x + T, y + T - 1.5);
      if (open(-1, 0)) g.lineBetween(x + 1.5, y, x + 1.5, y + T);
      if (open(1, 0)) g.lineBetween(x + T - 1.5, y, x + T - 1.5, y + T);
      // Slow motes falling in, so a still frame still reads as depth rather than as a black tile.
      for (let i = 0; i < 3; i++) {
        const seed = (tile.x * 7 + tile.y * 13 + i * 29) % 23;
        const fall = ((timeMs / 22 + seed * 40) % (T * 1.6)) / 1.6;
        g.fillStyle(accent, 0.22).fillRect(x + 5 + seed % (T - 12), y + 4 + fall * 0.6, 1.5, 3);
      }
    } else if (type === '*') {
      // Solid, so it speaks the same language as 'B': cast shadow, lit cap, dark front face.
      // What makes it a canister is the hazard chevron, and once armed the whole tile flashes,
      // accelerating from about 4 Hz to 12 Hz as the fuse runs out (R3: the tell is the tile).
      const fuseMs = state?.canisters?.[terrainTileKey(tile.x, tile.y)]?.fuseMs;
      const danger = hexInt(palette.hazard);
      g.fillStyle(0x000000, 0.3).fillRect(x + 3, y + T - 4, T - 6, 7);
      g.fillStyle(solid.face, 1).fillRect(x + 5, y + T * 0.45, T - 10, T * 0.5);
      g.fillStyle(solid.faceLow, 1).fillRect(x + 5, y + T - 7, T - 10, 5);
      g.fillStyle(solid.cap, 1).fillRect(x + 5, y + 5, T - 10, T * 0.45);
      g.fillStyle(solid.capHi, 0.85).fillRect(x + 5, y + 5, T - 10, 2.5);
      g.lineStyle(1.5, solid.outline, 1).strokeRect(x + 5, y + 5, T - 10, T - 12);
      g.lineStyle(2, danger, 0.95)
        .lineBetween(x + 9, y + 19, x + 16, y + 13)
        .lineBetween(x + 16, y + 13, x + 23, y + 19);
      if (fuseMs !== undefined) {
        const urgency = 4 + 8 * Math.min(1, Math.max(0, 1 - fuseMs / 420));
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((timeMs / 1000) * urgency * Math.PI * 2));
        g.fillStyle(danger, pulse * 0.4).fillRect(x, y, T, T);
        g.lineStyle(3, danger, pulse).strokeRect(x + 3, y + 3, T - 6, T - 6);
      }
    } else if (type === ':') {
      for (let i = 0; i < 8; i++) {
        const ox = (i * 13 + tile.x * 7) % 25 + 2;
        const oy = (i * 7 + tile.y * 11) % 25 + 2;
        g.fillStyle(pebble, 0.55).fillRect(x + ox, y + oy, 3 + i % 3, 3);
        g.fillStyle(0x000000, 0.35).fillRect(x + ox, y + oy + 3, 3 + i % 3, 1);
      }
    } else if (type === '+') {
      g.fillStyle(accent, 0.13).fillRect(x, y, T, T);
      g.lineStyle(1, accent, 0.75).strokeRect(x + 3, y + 3, T - 6, T - 6);
      const alpha = 0.45 + Math.sin(timeMs / 160 + tile.x + tile.y) * 0.25;
      g.lineStyle(2, accent, alpha);
      for (const offset of [10, 19]) {
        g.lineBetween(x + 10, y + offset + 3, x + 16, y + offset - 3)
          .lineBetween(x + 16, y + offset - 3, x + 22, y + offset + 3);
      }
    } else if (type === '=' || type === '>') {
      // A crossing through a wall run: a flat deck at floor value with low side rails.
      const vertical = ['=', '>'].includes(room.tiles[tile.y - 1]?.[tile.x] ?? '') ||
        ['=', '>'].includes(room.tiles[tile.y + 1]?.[tile.x] ?? '');
      g.fillStyle(deck, 1).fillRect(x, y, T, T);
      g.lineStyle(1, deckLine, 0.8);
      for (let i = 4; i < T; i += type === '>' ? 5 : 8) {
        if (vertical) g.lineBetween(x + 4, y + i, x + T - 4, y + i);
        else g.lineBetween(x + i, y + 4, x + i, y + T - 4);
      }
      g.fillStyle(accent, 0.75);
      if (vertical) g.fillRect(x + 1, y, 2, T).fillRect(x + T - 3, y, 2, T);
      else g.fillRect(x, y + 1, T, 2).fillRect(x, y + T - 3, T, 2);
    }
  }
}
