/**
 * RELAY content registry — the closed set of IDs that cross agent boundaries.
 *
 * Owner: Agent A (shared contracts). Changing this file is an interface change.
 *  - Agent B (generation) may only emit IDs listed here. Unknown IDs fail validation.
 *  - Agent C (presentation) renders every ID listed here and must not rename them.
 *  - Adding an ID = one small PR to A that adds it here, adds a renderer case, and
 *    (if gameplay-relevant) adds simulation behaviour.
 *
 * Status tags are honest: "planned" means the engine does NOT implement it yet.
 */

export const CLASS_IDS = ['bastion', 'shade', 'beacon', 'weaver'] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const CLASS_INFO: Record<ClassId, { name: string; role: string; status: ImplementationStatus }> = {
  bastion: { name: 'Bastion', role: 'Frontline guard. Wide sweeps, holds ground.', status: 'implemented' },
  shade: { name: 'Shade', role: 'Fast skirmisher. Short blinks, precise strikes.', status: 'implemented' },
  beacon: { name: 'Beacon', role: 'Ranged support. Marks targets, rallies allies.', status: 'implemented' },
  weaver: { name: 'Weaver', role: 'Control. Tethers, slows, reshapes space.', status: 'implemented' },
};

/** Ability IDs. `attack` and `dash` are engine-level; Q/E abilities are per class. */
export const ABILITY_IDS = [
  'attack',
  'dash',
  'bastion.q.bulwark',
  'bastion.e.shockwave',
  'shade.q.blink_strike',
  'shade.e.shroud',
  'beacon.q.flare',
  'beacon.e.rally',
  'weaver.q.tether',
  'weaver.e.rewind',
] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export type ImplementationStatus = 'implemented' | 'partial' | 'planned';

/** Simulation implementation status, consumed by the class and ability UI. */
export const ABILITY_STATUS: Record<AbilityId, ImplementationStatus> = {
  attack: 'implemented',
  dash: 'implemented',
  'bastion.q.bulwark': 'implemented',
  'bastion.e.shockwave': 'implemented',
  'shade.q.blink_strike': 'implemented',
  'shade.e.shroud': 'implemented',
  'beacon.q.flare': 'implemented',
  'beacon.e.rally': 'implemented',
  'weaver.q.tether': 'implemented',
  'weaver.e.rewind': 'implemented',
};

export const CLASS_ABILITIES: Record<ClassId, { q: AbilityId; e: AbilityId }> = {
  bastion: { q: 'bastion.q.bulwark', e: 'bastion.e.shockwave' },
  shade: { q: 'shade.q.blink_strike', e: 'shade.e.shroud' },
  beacon: { q: 'beacon.q.flare', e: 'beacon.e.rally' },
  weaver: { q: 'weaver.q.tether', e: 'weaver.e.rewind' },
};

/** Enemy archetypes. `guardian` is the room-3 Anchor encounter. */
export const ENEMY_IDS = ['husk', 'sentinel', 'lurker', 'guardian', 'spewer', 'swarmling', 'warden', 'channeler'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export const ENEMY_INFO: Record<EnemyId, { name: string; maxHp: number; radius: number; status: ImplementationStatus }> = {
  husk: { name: 'Husk', maxHp: 30, radius: 14, status: 'implemented' },
  sentinel: { name: 'Sentinel', maxHp: 60, radius: 16, status: 'implemented' },
  lurker: { name: 'Lurker', maxHp: 24, radius: 12, status: 'implemented' },
  guardian: { name: 'Guardian', maxHp: 240, radius: 28, status: 'implemented' },
  spewer: { name: 'Spewer', maxHp: 40, radius: 15, status: 'implemented' },
  swarmling: { name: 'Swarmling', maxHp: 14, radius: 10, status: 'implemented' },
  warden: { name: 'Warden', maxHp: 70, radius: 18, status: 'implemented' },
  channeler: { name: 'Channeler', maxHp: 45, radius: 14, status: 'implemented' },
};

/**
 * Motifs are the recognizable STRUCTURAL/visual identities a theme is built from.
 * A theme must differ in motifs, props and encounters — not only palette.
 */
export const MOTIF_IDS = [
  'spires',
  'arches',
  'cables',
  'crystals',
  'roots',
  'monoliths',
  'lanterns',
  'ruined_machinery',
] as const;
export type MotifId = (typeof MOTIF_IDS)[number];

/** Placeable props. Each has a renderer case (Agent C) and a footprint in tiles. */
export const PROP_IDS = [
  'pillar',
  'crate',
  'terminal',
  'lantern',
  'crystal_cluster',
  'root_mass',
  'cable_bundle',
  'monolith_shard',
  'anchor_pedestal',
] as const;
export type PropId = (typeof PROP_IDS)[number];

export const PROP_INFO: Record<PropId, { blocksMovement: boolean; footprint: { w: number; h: number } }> = {
  pillar: { blocksMovement: true, footprint: { w: 1, h: 1 } },
  crate: { blocksMovement: true, footprint: { w: 1, h: 1 } },
  terminal: { blocksMovement: true, footprint: { w: 1, h: 1 } },
  lantern: { blocksMovement: false, footprint: { w: 1, h: 1 } },
  crystal_cluster: { blocksMovement: true, footprint: { w: 1, h: 1 } },
  root_mass: { blocksMovement: true, footprint: { w: 2, h: 1 } },
  cable_bundle: { blocksMovement: false, footprint: { w: 1, h: 1 } },
  monolith_shard: { blocksMovement: true, footprint: { w: 1, h: 2 } },
  anchor_pedestal: { blocksMovement: false, footprint: { w: 1, h: 1 } },
};

/**
 * Tile characters used in RoomSpec.tiles rows.
 *  '#' wall (solid)   '.' floor   ' ' void (outside the room, solid)
 *  '~' hazard floor (renders as hazard; NO damage yet — planned)
 *  'P' player spawn (exactly one per room; walkable)
 *  'X' exit (walkable; must have a matching RoomSpec.exits entry)
 *  'A' anchor site (walkable; exactly one in the final room)
 */
export const TILE_CHARS = ['#', '.', ' ', '~', 'P', 'X', 'A'] as const;
export type TileChar = (typeof TILE_CHARS)[number];

export const SOLID_TILES: ReadonlySet<string> = new Set(['#', ' ']);
export const WALKABLE_TILES: ReadonlySet<string> = new Set(['.', '~', 'P', 'X', 'A']);

export function isClassId(value: string): value is ClassId {
  return (CLASS_IDS as readonly string[]).includes(value);
}
export function isEnemyId(value: string): value is EnemyId {
  return (ENEMY_IDS as readonly string[]).includes(value);
}
export function isMotifId(value: string): value is MotifId {
  return (MOTIF_IDS as readonly string[]).includes(value);
}
export function isPropId(value: string): value is PropId {
  return (PROP_IDS as readonly string[]).includes(value);
}
