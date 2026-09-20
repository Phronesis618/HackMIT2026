/**
 * The Training Range — a built-in room reachable from headquarters where operatives can
 * watch how each enemy attacks and try every ability (all unlocked here) without a run.
 *
 * Rules (enforced in simulation.ts while phase === 'training'):
 *  - one of each enemy stands in its own pen and only wakes when a player comes close
 *  - defeated enemies respawn after a short delay
 *  - players cannot be downed; health regenerates between hits
 *  - the 'X' tile in the bottom-left corner returns to headquarters
 */
import { type ArtRecipe, type RoomSpec, RoomSpecSchema } from '../shared/contracts';
import type { EnemyId } from '../shared/registry';

export const TRAINING_ROOM_ID = 'training-range';
export const TRAINING_WAKE_RANGE = 190; // enemies further than this from every player stay idle
export const TRAINING_RESPAWN_MS = 3000;
export const TRAINING_REGEN_PER_TICK = 0.45; // ~27 hp/s once the hit invulnerability ends

export const trainingRoom: RoomSpec = RoomSpecSchema.parse({
  id: TRAINING_ROOM_ID,
  index: 0,
  name: 'Training Range',
  description: 'Eight practice pens. Walk up to a target to wake it; targets respawn. You cannot be downed here.',
  width: 38,
  height: 18,
  tiles: [
    '######################################',
    '#....................................#',
    '#.........#......#......#......#.....#',
    '#.........#......#......#......#.....#',
    '#.........#......#......#......#.....#',
    '#.........#......#......#......#.....#',
    '#....................................#',
    '#....................................#',
    '#..P.................................#',
    '#....................................#',
    '#....................................#',
    '#.........#......#......#......#.....#',
    '#.........#......#......#......#.....#',
    '#.........#......#......#......#.....#',
    '#.........#......#......#......#.....#',
    '#....................................#',
    '#X...................................#',
    '######################################',
  ],
  props: [
    { id: 'tr-console', propId: 'terminal', x: 3, y: 1 },
    { id: 'tr-lantern-a', propId: 'lantern', x: 6, y: 1 },
    { id: 'tr-lantern-b', propId: 'lantern', x: 16, y: 1 },
    { id: 'tr-lantern-c', propId: 'lantern', x: 23, y: 1 },
    { id: 'tr-lantern-d', propId: 'lantern', x: 30, y: 1 },
    { id: 'tr-lantern-e', propId: 'lantern', x: 6, y: 16 },
    { id: 'tr-lantern-f', propId: 'lantern', x: 16, y: 16 },
    { id: 'tr-lantern-g', propId: 'lantern', x: 23, y: 16 },
    { id: 'tr-lantern-h', propId: 'lantern', x: 30, y: 16 },
    { id: 'tr-crate-a', propId: 'crate', x: 6, y: 15 },
    { id: 'tr-crate-b', propId: 'crate', x: 7, y: 15 },
  ],
  encounters: [
    { id: 'tr-husk', enemyId: 'husk', x: 13, y: 3, count: 1 },
    { id: 'tr-sentinel', enemyId: 'sentinel', x: 20, y: 3, count: 1 },
    { id: 'tr-lurker', enemyId: 'lurker', x: 27, y: 3, count: 1 },
    { id: 'tr-spewer', enemyId: 'spewer', x: 34, y: 3, count: 1 },
    { id: 'tr-swarmling', enemyId: 'swarmling', x: 13, y: 13, count: 1 },
    { id: 'tr-warden', enemyId: 'warden', x: 20, y: 13, count: 1 },
    { id: 'tr-channeler', enemyId: 'channeler', x: 27, y: 13, count: 1 },
    { id: 'tr-guardian', enemyId: 'guardian', x: 34, y: 13, count: 1 },
  ],
  exits: [{ x: 1, y: 16, toRoomIndex: 0, direction: 'west' }],
  isFinal: false,
  attributions: [],
});

/** Practice-hall look: neutral steel with amber work lights. */
export const trainingArt: ArtRecipe = {
  paletteFamily: 'ink-neon',
  palette: {
    background: '#0b0f14',
    floor: '#1b2530',
    floorAlt: '#20303a',
    wall: '#2a3a48',
    wallEdge: '#ffb347',
    accent: '#ffb347',
    accentSoft: '#7cf5ff',
    glow: '#ffb347',
    hazard: '#ff5c7a',
    text: '#f2f6ff',
  },
  motifIds: ['ruined_machinery', 'lanterns'],
  skyline: 'ruined_machinery',
  fog: 0.1,
  glowIntensity: 0.7,
};

/** Player-facing notes about how each target fights (shown in the training HUD). */
export const ENEMY_LORE: Record<EnemyId, { attack: string; tip: string }> = {
  husk: { attack: 'Melee swing after a short windup.', tip: 'Dash or step out of the wedge while it winds up.' },
  sentinel: { attack: 'Fires a straight volley of bolts along its facing.', tip: 'Strafe sideways as it charges; bolts do not turn.' },
  lurker: { attack: 'Charges straight at you, then scatters a ring of spores.', tip: 'Dash sideways on the windup; step out of the spore ring.' },
  spewer: { attack: 'Spits a spread of three slow bolts.', tip: 'Slip between the bolts; close in while it reloads.' },
  swarmling: { attack: 'Fast, weak melee snaps; attacks often.', tip: 'Kill quickly — wide swings and shockwaves clear them.' },
  warden: { attack: 'Launches one slow homing bolt.', tip: 'Dash at the last moment; the bolt cannot turn that fast.' },
  channeler: { attack: 'Channels a rotating spiral of bolts.', tip: 'Move with the spiral gap or rush it — the channel is long.' },
  guardian: { attack: 'Cycles: 360° burst → bolt volley → bolt ring → sweeping beam.', tip: 'Back off for the burst, sidestep the beam, weave the bolts.' },
};
