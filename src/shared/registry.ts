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
  shade: { name: 'Shade', role: 'Fast skirmisher. Short blinks, precise strikes.', status: 'planned' },
  beacon: { name: 'Beacon', role: 'Ranged support. Marks targets, rallies allies.', status: 'planned' },
  weaver: { name: 'Weaver', role: 'Control. Tethers, slows, reshapes space.', status: 'planned' },
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

/**
 * What the simulation actually does today. Keep this truthful — UI shows it.
 *  - attack: windup -> arc hit resolution -> damage/defeat events (implemented).
 *  - dash: movement burst + cooldown + i-frames (implemented).
 *  - bastion Q/E: directional shield / cone tether (implemented; E must be unlocked).
 *  - other classes: planned (Slice 4).
 */
export const ABILITY_STATUS: Record<AbilityId, ImplementationStatus> = {
  attack: 'implemented',
  dash: 'implemented',
  'bastion.q.bulwark': 'implemented',
  'bastion.e.shockwave': 'implemented',
  'shade.q.blink_strike': 'planned',
  'shade.e.shroud': 'planned',
  'beacon.q.flare': 'planned',
  'beacon.e.rally': 'planned',
  'weaver.q.tether': 'planned',
  'weaver.e.rewind': 'planned',
};

export type AbilitySlot = 'attack' | 'dash' | 'q' | 'e';

export interface AbilityInfo {
  id: AbilityId;
  name: string;
  slot: AbilitySlot;
  classId: ClassId | null; // null = every class
  /** Shards needed to unlock. 0 = available from the start. */
  cost: number;
  cooldownMs: number;
  description: string;
}

/** Authored ability registry: what the simulation implements, what the HQ shop can sell. */
export const ABILITY_INFO: Record<AbilityId, AbilityInfo> = {
  attack: { id: 'attack', name: 'Basic attack', slot: 'attack', classId: null, cost: 0, cooldownMs: 360, description: 'Class weapon strike.' },
  dash: { id: 'dash', name: 'Dash', slot: 'dash', classId: null, cost: 0, cooldownMs: 800, description: 'Short burst with a brief invulnerability window.' },
  'bastion.q.bulwark': {
    id: 'bastion.q.bulwark',
    name: 'Bulwark',
    slot: 'q',
    classId: 'bastion',
    cost: 0,
    cooldownMs: 5000,
    description: 'Raise a directional shield for 1.4 s. Blocks enemy strikes coming from the front.',
  },
  'bastion.e.shockwave': {
    id: 'bastion.e.shockwave',
    name: 'Magnetic Tether',
    slot: 'e',
    classId: 'bastion',
    cost: 100,
    cooldownMs: 8000,
    description: 'Pull every enemy in a frontal cone into your reach and stagger them.',
  },
  'shade.q.blink_strike': { id: 'shade.q.blink_strike', name: 'Phase Step', slot: 'q', classId: 'shade', cost: 0, cooldownMs: 4000, description: 'Blink toward the aim point, leaving a decoy.' },
  'shade.e.shroud': { id: 'shade.e.shroud', name: 'Echo', slot: 'e', classId: 'shade', cost: 100, cooldownMs: 7000, description: 'Your next basic attack is repeated once from a nearby offset.' },
  'beacon.q.flare': { id: 'beacon.q.flare', name: 'Repair Field', slot: 'q', classId: 'beacon', cost: 0, cooldownMs: 6000, description: 'A field that repairs you and allies inside it.' },
  'beacon.e.rally': { id: 'beacon.e.rally', name: 'Lifeline', slot: 'e', classId: 'beacon', cost: 100, cooldownMs: 9000, description: 'Protect and repair a nearby ally (self-support in solo).' },
  'weaver.q.tether': { id: 'weaver.q.tether', name: 'Rift Mine', slot: 'q', classId: 'weaver', cost: 0, cooldownMs: 5000, description: 'Place a delayed mine at the aim point.' },
  'weaver.e.rewind': { id: 'weaver.e.rewind', name: 'Singularity', slot: 'e', classId: 'weaver', cost: 100, cooldownMs: 9000, description: 'Pull enemies toward a point, then detonate.' },
};

/** Shards granted once per new profile so the first HQ unlock is reachable in the demo. */
export const STARTING_SHARDS = 100;

/** Enemy archetypes. `guardian` is the room-3 Anchor encounter. */
export const ENEMY_IDS = ['husk', 'sentinel', 'lurker', 'guardian'] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export interface EnemyInfo {
  name: string;
  maxHp: number;
  radius: number;
  speed: number; // world units / s
  aggroRange: number;
  attackRange: number; // extra reach beyond radius sum
  windupMs: number;
  recoverMs: number;
  damage: number;
  shards: number; // reward on defeat
  status: ImplementationStatus;
}

export const ENEMY_INFO: Record<EnemyId, EnemyInfo> = {
  husk: { name: 'Husk', maxHp: 30, radius: 14, speed: 95, aggroRange: 260, attackRange: 18, windupMs: 420, recoverMs: 520, damage: 10, shards: 8, status: 'implemented' },
  sentinel: { name: 'Sentinel', maxHp: 70, radius: 16, speed: 70, aggroRange: 300, attackRange: 26, windupMs: 620, recoverMs: 700, damage: 18, shards: 20, status: 'implemented' },
  lurker: { name: 'Lurker', maxHp: 24, radius: 12, speed: 140, aggroRange: 220, attackRange: 14, windupMs: 260, recoverMs: 420, damage: 8, shards: 10, status: 'implemented' },
  guardian: { name: 'Guardian', maxHp: 240, radius: 28, speed: 60, aggroRange: 400, attackRange: 40, windupMs: 800, recoverMs: 900, damage: 24, shards: 60, status: 'partial' }, // same melee brain, big stats; patterns later
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
