/**
 * Pure presentation models for the floors UI (agent F3): minimap grid, biome header and
 * the biome choice cards. No React, no session: everything here takes data and returns data.
 *
 * Minimap rule (FLOORS.md §11.5): the map is built from `FloorRunState.map` ONLY. The plan
 * is never read, so nothing the sim has not revealed can leak into the HUD.
 */
import type { GameSnapshot, PreparedWorld } from '../../shared/contracts';
import { BIOME_TIER_COUNT, SIDE_DELTA, type BiomeBrief, type DoorSide, type FloorMapRoom, type FloorRunState, type RoomKind } from '../../shared/floors';
import { ENEMY_INFO, type MotifId } from '../../shared/registry';
import type { UiBiomeChoice, UiBiomeOption, UiFloor } from '../../shared/ui';

// ---- minimap ---------------------------------------------------------------------

export type MinimapCellState = 'current' | 'visited' | 'seen';

export interface MinimapCell {
  roomId: string;
  /** Grid position relative to the revealed bounding box (0-based). */
  col: number;
  row: number;
  state: MinimapCellState;
  /** Null while the sim hides it. Combat and entrance rooms carry no icon. */
  kind: RoomKind | null;
  icon: MinimapIcon | null;
  cleared: boolean;
}

export type MinimapIcon = 'exit' | 'treasure' | 'rest' | 'lore' | 'elite' | 'shop' | 'entrance';

export interface MinimapLink {
  from: { col: number; row: number };
  to: { col: number; row: number };
  /** False when the far room is not on the map yet: drawn as a short stub into the fog. */
  known: boolean;
  side: DoorSide;
}

export interface MinimapModel {
  cols: number;
  rows: number;
  cells: MinimapCell[];
  links: MinimapLink[];
  visitedCount: number;
  seenCount: number;
}

const ICONS: Partial<Record<RoomKind, MinimapIcon>> = {
  exit: 'exit', treasure: 'treasure', rest: 'rest', lore: 'lore', elite: 'elite', shop: 'shop', entrance: 'entrance',
};

/** Rooms the sim has revealed, normalised to their bounding box. Everything else is fog. */
export function buildMinimap(floor: Pick<FloorRunState, 'map' | 'roomId'>): MinimapModel {
  const rooms = floor.map;
  if (rooms.length === 0) return { cols: 1, rows: 1, cells: [], links: [], visitedCount: 0, seenCount: 0 };
  const minX = Math.min(...rooms.map((room) => room.cell.x));
  const minY = Math.min(...rooms.map((room) => room.cell.y));
  const maxX = Math.max(...rooms.map((room) => room.cell.x));
  const maxY = Math.max(...rooms.map((room) => room.cell.y));
  const byCell = new Map<string, FloorMapRoom>(rooms.map((room) => [`${room.cell.x},${room.cell.y}`, room]));
  const cells: MinimapCell[] = rooms.map((room) => ({
    roomId: room.roomId,
    col: room.cell.x - minX,
    row: room.cell.y - minY,
    state: room.roomId === floor.roomId ? 'current' : room.state,
    kind: room.kind,
    icon: room.kind ? ICONS[room.kind] ?? null : null,
    cleared: room.cleared,
  }));
  const links: MinimapLink[] = [];
  for (const room of rooms) {
    // Only visited rooms show their doors: a `seen` outline must not give away its other exits.
    if (room.state !== 'visited') continue;
    for (const side of room.doors) {
      const delta = SIDE_DELTA[side];
      const other = byCell.get(`${room.cell.x + delta.dx},${room.cell.y + delta.dy}`);
      // draw each known link once (from the visited side; if both are visited, from the n/w one)
      if (other?.state === 'visited' && (side === 'n' || side === 'w')) continue;
      links.push({
        from: { col: room.cell.x - minX, row: room.cell.y - minY },
        to: { col: room.cell.x - minX + delta.dx, row: room.cell.y - minY + delta.dy },
        known: other !== undefined,
        side,
      });
    }
  }
  return {
    cols: maxX - minX + 1,
    rows: maxY - minY + 1,
    cells,
    links,
    visitedCount: rooms.filter((room) => room.state === 'visited').length,
    seenCount: rooms.filter((room) => room.state === 'seen').length,
  };
}

/** Cell pitch (px) that fits `cols × rows` into a square of `size` px, clamped for legibility. */
export function minimapPitch(model: Pick<MinimapModel, 'cols' | 'rows'>, size: number, maxPitch = 30): number {
  // +1: half a cell of margin on each side for the fog stubs
  return Math.max(8, Math.min(maxPitch, Math.floor(size / (Math.max(model.cols, model.rows) + 1))));
}

// ---- biome text --------------------------------------------------------------------

const MOTIF_WORDS: Record<MotifId, string> = {
  spires: 'spires',
  arches: 'arches',
  cables: 'cable runs',
  crystals: 'crystal growth',
  roots: 'root masses',
  monoliths: 'monoliths',
  lanterns: 'lantern halls',
  ruined_machinery: 'wrecked machinery',
};

/** Layout personality in plain words, from the brief's linearity and branchiness. */
export function describeLayout(layout: BiomeBrief['layout']): string {
  const shape = layout.linearity >= 0.66 ? 'Long and direct' : layout.linearity <= 0.34 ? 'Wide and branching' : 'Winding';
  const sides = layout.branchiness >= 0.66 ? 'Many dead ends.' : layout.branchiness <= 0.34 ? 'Few side rooms.' : 'Some side rooms.';
  return `${shape}. ${sides}`;
}

export function biomeOption(world: PreparedWorld, biomeId: string): UiBiomeOption | null {
  const floors = world.floors;
  const brief = floors?.briefs.find((candidate) => candidate.id === biomeId);
  const node = floors?.route.graph.nodes.find((candidate) => candidate.biomeId === biomeId);
  if (!brief || !node) return null;
  return {
    biomeId,
    name: brief.name,
    tagline: brief.tagline,
    depth: node.tier + 1,
    depthCount: BIOME_TIER_COUNT,
    roomCount: node.roomBudget,
    layout: describeLayout(brief.layout),
    enemies: brief.enemyPool.filter((id) => id !== 'guardian').map((id) => ENEMY_INFO[id].name),
    motifs: brief.motifIds.map((id) => MOTIF_WORDS[id]),
    hazards: brief.hazards,
  };
}

/** Everything React needs about a floors run, or null for legacy worlds / outside a run. */
export function floorUiFrom(
  snapshot: Pick<GameSnapshot, 'floor' | 'players'>,
  world: PreparedWorld | null,
  local: { playerId: string; isHost: boolean; solo: boolean },
): UiFloor | null {
  const run = snapshot.floor;
  if (!run || !world?.floors) return null;
  const briefName = (id: string): string => world.floors?.briefs.find((brief) => brief.id === id)?.name ?? id;
  const brief = world.floors.briefs.find((candidate) => candidate.id === run.biomeId);
  const roomCount = world.floors.route.graph.nodes.find((node) => node.biomeId === run.biomeId)?.roomBudget ?? run.map.length;
  let choice: UiBiomeChoice | null = null;
  if (run.biomeChoice && !run.biomeChoice.chosenBiomeId) {
    const state = run.biomeChoice;
    const options = state.options.map((id) => biomeOption(world, id)).filter((option): option is UiBiomeOption => option !== null);
    const nameOf = (playerId: string): string => snapshot.players.find((player) => player.id === playerId)?.displayName ?? playerId;
    if (options.length > 0) {
      choice = {
        options,
        confirmOnly: options.length === 1,
        votes: Object.entries(state.votes).map(([playerId, biomeId]) => ({ playerId, displayName: nameOf(playerId), biomeId })),
        hostPlayerId: state.hostPlayerId,
        hostName: state.hostPlayerId ? nameOf(state.hostPlayerId) : null,
        canPick: local.solo || local.isHost || state.hostPlayerId === local.playerId,
      };
    }
  }
  return {
    run,
    biomeName: brief?.name ?? run.biomeId,
    biomeTagline: brief?.tagline ?? '',
    pathNames: run.path.map(briefName),
    depth: run.tier + 1,
    depthCount: BIOME_TIER_COUNT,
    roomCount,
    roomsVisited: Math.min(roomCount, run.map.filter((entry) => entry.state === 'visited').length),
    choice,
  };
}

/** Cheap change key so the store is only written when something the UI shows has changed. */
export function floorUiKey(snapshot: Pick<GameSnapshot, 'floor' | 'players'>): string {
  const run = snapshot.floor;
  if (!run) return '';
  const cleared = run.map.reduce((count, room) => count + (room.cleared ? 1 : 0), 0);
  const visited = run.map.reduce((count, room) => count + (room.state === 'visited' ? 1 : 0), 0);
  const choice = run.biomeChoice ? `${run.biomeChoice.options.join(',')}|${JSON.stringify(run.biomeChoice.votes)}|${run.biomeChoice.chosenBiomeId ?? ''}|${run.biomeChoice.hostPlayerId ?? ''}` : '';
  return `${run.biomeId}|${run.roomId}|${run.tier}|${run.doorsLocked}|${run.map.length}|${visited}|${cleared}|${choice}|${snapshot.players.length}`;
}
