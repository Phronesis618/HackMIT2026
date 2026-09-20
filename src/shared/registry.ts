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

/** Ability IDs. `attack` and `dash` are engine-level; Q/E/R abilities are per class. */
export const ABILITY_IDS = [
  'attack',
  'dash',
  'bastion.q.bulwark',
  'bastion.e.shockwave',
  'bastion.r.aegis_slam',
  'shade.q.blink_strike',
  'shade.e.shroud',
  'shade.r.blade_storm',
  'beacon.q.flare',
  'beacon.e.rally',
  'beacon.r.solar_lance',
  'weaver.q.tether',
  'weaver.e.rewind',
  'weaver.r.collapse',
] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export type ImplementationStatus = 'implemented' | 'partial' | 'planned';

/** Simulation implementation status, consumed by the class and ability UI. */
export const ABILITY_STATUS: Record<AbilityId, ImplementationStatus> = {
  attack: 'implemented',
  dash: 'implemented',
  'bastion.q.bulwark': 'implemented',
  'bastion.e.shockwave': 'implemented',
  'bastion.r.aegis_slam': 'implemented',
  'shade.q.blink_strike': 'implemented',
  'shade.e.shroud': 'implemented',
  'shade.r.blade_storm': 'implemented',
  'beacon.q.flare': 'implemented',
  'beacon.e.rally': 'implemented',
  'beacon.r.solar_lance': 'implemented',
  'weaver.q.tether': 'implemented',
  'weaver.e.rewind': 'implemented',
  'weaver.r.collapse': 'implemented',
};

export const CLASS_ABILITIES: Record<ClassId, { q: AbilityId; e: AbilityId; r: AbilityId }> = {
  bastion: { q: 'bastion.q.bulwark', e: 'bastion.e.shockwave', r: 'bastion.r.aegis_slam' },
  shade: { q: 'shade.q.blink_strike', e: 'shade.e.shroud', r: 'shade.r.blade_storm' },
  beacon: { q: 'beacon.q.flare', e: 'beacon.e.rally', r: 'beacon.r.solar_lance' },
  weaver: { q: 'weaver.q.tether', e: 'weaver.e.rewind', r: 'weaver.r.collapse' },
};

/** Ultimates charge from combat: damage dealt / ULT_CHARGE_PER_DAMAGE + ULT_CHARGE_PER_KILL per kill. */
export const ULT_CHARGE_MAX = 100;
export const ULT_CHARGE_PER_DAMAGE = 0.6; // charge per point of damage dealt
export const ULT_CHARGE_PER_KILL = 15;

export type AbilityKey = 'LMB' | 'Shift' | 'Q' | 'E' | 'R';
/** Symbolic icon ids the UI draws as inline SVG (League-style ability buttons). */
export type AbilityIcon =
  | 'blade'
  | 'twin_blades'
  | 'pulse'
  | 'orb'
  | 'dash'
  | 'shield'
  | 'magnet'
  | 'slam'
  | 'blink'
  | 'shroud'
  | 'storm'
  | 'flare'
  | 'rally'
  | 'lance'
  | 'tether'
  | 'rewind'
  | 'singularity';

export interface AbilityDetail {
  id: AbilityId;
  name: string;
  key: AbilityKey;
  icon: AbilityIcon;
  /** One line, player-facing, describes what actually happens in the simulation. */
  description: string;
  /** Extra numbers players care about. */
  stats: string;
  /** Unlockable abilities cost resources at HQ; ultimates need full charge instead of cooldown. */
  gate: 'always' | 'unlock' | 'ultimate';
}

export const ABILITY_DETAILS: Record<AbilityId, AbilityDetail> = {
  attack: { id: 'attack', name: 'Strike', key: 'LMB', icon: 'blade', description: 'Your class weapon. Hold to attack at the weapon’s cadence.', stats: 'Aim with the mouse.', gate: 'always' },
  dash: { id: 'dash', name: 'Dash', key: 'Shift', icon: 'dash', description: 'Burst in your movement direction. Brief invulnerability.', stats: '150 ms · 0.8 s cooldown', gate: 'always' },
  'bastion.q.bulwark': { id: 'bastion.q.bulwark', name: 'Bulwark', key: 'Q', icon: 'shield', description: 'Raise an energy shield: melee hits are reduced to 20% and beams are blocked.', stats: '2.2 s · 6 s cooldown', gate: 'always' },
  'bastion.e.shockwave': { id: 'bastion.e.shockwave', name: 'Magnetic Shockwave', key: 'E', icon: 'magnet', description: 'Blast every enemy around you: damage, stun and knockback.', stats: '35 dmg · 1.5 s stun · 8 s cooldown', gate: 'unlock' },
  'bastion.r.aegis_slam': { id: 'bastion.r.aegis_slam', name: 'Aegis Slam', key: 'R', icon: 'slam', description: 'Slam the ground: a huge shockwave damages, stuns and hurls every nearby enemy, and raises Bulwark.', stats: '60 dmg · 2 s stun · 170 range · needs full charge', gate: 'ultimate' },
  'shade.q.blink_strike': { id: 'shade.q.blink_strike', name: 'Phase Step', key: 'Q', icon: 'blink', description: 'Blink toward your aim, cutting everything along the path.', stats: '32 dmg · 112 range · 4 s cooldown', gate: 'always' },
  'shade.e.shroud': { id: 'shade.e.shroud', name: 'Shroud', key: 'E', icon: 'shroud', description: 'Vanish: enemies lose you, you move 40% faster, and your next strike hits much harder.', stats: '+18 dmg · 2.2 s · 9 s cooldown', gate: 'unlock' },
  'shade.r.blade_storm': { id: 'shade.r.blade_storm', name: 'Blade Storm', key: 'R', icon: 'storm', description: 'A whirlwind of blades around you: three rapid cuts on every enemy in reach, and you cannot be touched.', stats: '3 × 22 dmg · 120 range · needs full charge', gate: 'ultimate' },
  'beacon.q.flare': { id: 'beacon.q.flare', name: 'Flare', key: 'Q', icon: 'flare', description: 'Detonate a flare at your aim point: damage and MARK enemies so they take 30% more.', stats: '24 dmg · 4 s mark · 5 s cooldown', gate: 'always' },
  'beacon.e.rally': { id: 'beacon.e.rally', name: 'Rally', key: 'E', icon: 'rally', description: 'Repair yourself and nearby allies and quicken everyone’s weapons.', stats: '+35 hp · 4 s haste · 10 s cooldown', gate: 'unlock' },
  'beacon.r.solar_lance': { id: 'beacon.r.solar_lance', name: 'Solar Lance', key: 'R', icon: 'lance', description: 'Fire a piercing lance of light along your aim: every enemy in the line is scorched and marked.', stats: '55 dmg · 420 range · needs full charge', gate: 'ultimate' },
  'weaver.q.tether': { id: 'weaver.q.tether', name: 'Tether', key: 'Q', icon: 'tether', description: 'Hook the enemy you aim at, drag it to you and slow it.', stats: '12 dmg · 3 s slow · 4.5 s cooldown', gate: 'always' },
  'weaver.e.rewind': { id: 'weaver.e.rewind', name: 'Rewind', key: 'E', icon: 'rewind', description: 'Snap back to where you were 3 seconds ago, restoring the health you had then.', stats: '3 s rewind · 10 s cooldown', gate: 'unlock' },
  'weaver.r.collapse': { id: 'weaver.r.collapse', name: 'Collapse', key: 'R', icon: 'singularity', description: 'Open a singularity at your aim point: enemies are dragged in, crushed and stunned.', stats: '45 dmg · 200 pull · 1.2 s stun · needs full charge', gate: 'ultimate' },
};

export const CLASS_THEME: Record<ClassId, { title: string; weapon: string; primary: string; secondary: string }> = {
  bastion: { title: 'Bastion', weapon: 'Arc-blade and tower shield', primary: '#7cf5ff', secondary: '#ffcf8a' },
  shade: { title: 'Shade', weapon: 'Twin phase blades', primary: '#b48cff', secondary: '#ff6bd6' },
  beacon: { title: 'Beacon', weapon: 'Lantern staff', primary: '#ffcf8a', secondary: '#fff3c4' },
  weaver: { title: 'Weaver', weapon: 'Plasma loom', primary: '#5ef0b0', secondary: '#7cf5ff' },
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
 *  '~' hazard floor
 *  'B' breakable wall (solid until destroyed, then rubble)
 *  '=' walkable bridge through a wall run; '>' adjoining ramp
 *  ':' slowing rubble; '+' conductive speed floor
 *  'P' player spawn (exactly one per room; walkable)
 *  'X' exit (walkable; must have a matching RoomSpec.exits entry)
 *  'A' anchor site (walkable; exactly one in the final room)
 */
export const TILE_CHARS = ['#', '.', ' ', '~', 'P', 'X', 'A', 'B', '=', '>', ':', '+'] as const;
export type TileChar = (typeof TILE_CHARS)[number];

export const SOLID_TILES: ReadonlySet<string> = new Set(['#', ' ', 'B']);
export const WALKABLE_TILES: ReadonlySet<string> = new Set(['.', '~', 'P', 'X', 'A', '=', '>', ':', '+']);
export const TERRAIN_FEATURE_IDS = ['breakable_walls', 'bridges', 'rubble', 'conduits'] as const;
export type TerrainFeatureId = (typeof TERRAIN_FEATURE_IDS)[number];
export const TERRAIN_LAYOUT_IDS = ['scattered', 'barricades', 'crossroads'] as const;
export const TERRAIN_DENSITIES = ['sparse', 'balanced', 'dense'] as const;
export const BREAKABLE_WALL_HP = 36;
export const TERRAIN_FEATURE_INFO: Record<TerrainFeatureId, string> = {
  breakable_walls: 'B: destructible bulkheads, 36 HP; break into slowing rubble to open a route.',
  bridges: '=: a walkable crossing through a wall run, with > ramps on both sides; no jumping other walls.',
  rubble: ':: debris patches slow walking to 65%; dashes retain their normal speed.',
  conduits: '+: conductive floor lanes boost walking to 125%; dashes retain their normal speed.',
};

/**
 * World attunements: the skill-tree branch a world grows for itself. The model picks a
 * mechanical effect from this closed set and writes the in-world name/description; the
 * effect ids are what a future simulation pass will implement, so they must stay stable.
 */
export const ATTUNEMENT_EFFECT_IDS = [
  'hazard_ward', 'bolt_ward', 'melee_ward', 'relic_mend', 'remains_charge',
  'clear_surge', 'first_strike', 'guardian_bane', 'dash_echo', 'anchor_grace',
] as const;
export type AttunementEffectId = (typeof ATTUNEMENT_EFFECT_IDS)[number];

export const ATTUNEMENT_EFFECT_INFO: Record<AttunementEffectId, { summary: string; status: ImplementationStatus }> = {
  hazard_ward: { summary: 'Hazard floor and area-denial bolts deal 40% less.', status: 'planned' },
  bolt_ward: { summary: 'Enemy projectiles deal 25% less.', status: 'planned' },
  melee_ward: { summary: 'Melee and charge hits deal 25% less.', status: 'planned' },
  relic_mend: { summary: 'Reading a relic restores 25 Integrity.', status: 'planned' },
  remains_charge: { summary: 'Recovering remains adds 40% ultimate charge.', status: 'planned' },
  clear_surge: { summary: 'Clearing a room grants 4 s of haste.', status: 'planned' },
  first_strike: { summary: 'Your first hit on an untouched enemy deals double.', status: 'planned' },
  guardian_bane: { summary: 'The Guardian takes 20% more from you.', status: 'planned' },
  dash_echo: { summary: 'Dashing leaves a short trail that burns enemies.', status: 'planned' },
  anchor_grace: { summary: 'The Anchor plants in half the time.', status: 'planned' },
};

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
