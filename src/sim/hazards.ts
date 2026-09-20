/**
 * Damaging terrain, stepped once per tick for every entity (docs/design/TILES.md T0/T3).
 *
 * Owner: Agent T1. Pure: the caller owns the entity, applies the damage and emits the events;
 * this module only answers "what did the floor do to something standing here this tick?".
 *
 * The rules are deliberately identical for players and enemies (R1). The only asymmetries are
 * the two named scales in shared/terrain.ts: players take `TERRAIN_PLAYER_DAMAGE_SCALE` of the
 * number, elites take `TERRAIN_ELITE_DAMAGE_SCALE`. Dashes are immune to everything here (R2):
 * every floor hazard has exactly one always-available counterplay.
 */
import type { RoomSpec } from '../shared/contracts';
import { TICK_MS, worldToTile } from '../shared/conventions';
import {
  isEliteEnemy, terrainTileAt, TERRAIN_DAMAGE_SOURCE, TERRAIN_ELITE_DAMAGE_SCALE,
  TERRAIN_PLAYER_DAMAGE_SCALE, ventState, ventWindowId,
  type TerrainDamageSource, type TerrainTuning,
} from '../shared/terrain';

/** Per-entity hazard bookkeeping. Runtime only: it is derived from sim state, never sent. */
export interface HazardClock {
  /** Milliseconds stood on the current '~' tile, reset the moment the entity leaves or dashes. */
  hazardMs: number;
  /** Id of the last '^' firing window that hit this entity, so one burst lands once. */
  ventWindow: number;
}

export function createHazardClock(): HazardClock {
  return { hazardMs: 0, ventWindow: -1 };
}

export interface HazardHit {
  source: TerrainDamageSource;
  /** Already scaled for the entity kind; the caller applies it as-is. */
  damage: number;
}

export interface HazardSubject {
  x: number;
  y: number;
  /** Dashing, blinking or otherwise phasing: the floor cannot touch it this tick. */
  immune: boolean;
  kind: 'player' | 'enemy';
  /** Enemy archetype, for the elite resistance. */
  enemyId?: string;
}

function scaleFor(subject: HazardSubject): number {
  if (subject.kind === 'player') return TERRAIN_PLAYER_DAMAGE_SCALE;
  return subject.enemyId !== undefined && isEliteEnemy(subject.enemyId) ? TERRAIN_ELITE_DAMAGE_SCALE : 1;
}

/**
 * Advance one entity's hazard clocks by a tick and return what the floor did to it.
 *
 * `~` accumulates: every `hazardIntervalMs` of standing costs `hazardDamage`, so crossing a band
 * at walking speed costs about two ticks and standing in one is a decision with a beat you can
 * see. `^` is stateless: the tile's phase comes from sim time alone, and an entity takes one hit
 * per firing window however long that window is.
 */
export function stepHazardTiles(
  room: RoomSpec,
  brokenWalls: readonly string[],
  timeMs: number,
  subject: HazardSubject,
  clock: HazardClock,
  tuning: TerrainTuning,
): HazardHit[] {
  const { col, row } = worldToTile(subject.x, subject.y);
  // Widened to string: '^' joins TILE_CHARS with the vent tile, and this stepper predates it.
  const tile: string = terrainTileAt(room, col, row, brokenWalls);
  if (subject.immune) {
    clock.hazardMs = 0;
    return [];
  }
  const hits: HazardHit[] = [];
  const scale = scaleFor(subject);
  if (tile === '~') {
    clock.hazardMs += TICK_MS;
    // `while`, not `if`: a hazard interval shorter than a tick must still land every tick.
    while (clock.hazardMs >= tuning.hazardIntervalMs - 1e-7) {
      clock.hazardMs -= tuning.hazardIntervalMs;
      hits.push({ source: TERRAIN_DAMAGE_SOURCE.hazard, damage: Math.round(tuning.hazardDamage * scale) });
    }
  } else {
    clock.hazardMs = 0;
  }
  if (tile === '^' && ventState(timeMs, col, row, tuning.ventCycleMs) === 'firing') {
    const window = ventWindowId(timeMs, col, row, tuning.ventCycleMs);
    if (clock.ventWindow !== window) {
      clock.ventWindow = window;
      hits.push({ source: TERRAIN_DAMAGE_SOURCE.vent, damage: Math.round(tuning.ventDamage * scale) });
    }
  }
  return hits;
}
