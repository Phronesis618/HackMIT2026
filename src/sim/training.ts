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
  description: 'Practice pens. Walk up to a target to wake it; targets respawn. You cannot be downed here.',
  width: 30,
  height: 16,
  tiles: [
    '##############################',
    '#............................#',
    '#..........#........#........#',
    '#..........#........#........#',
    '#..........#........#........#',
    '#..........#........#........#',
    '#..P.........................#',
    '#............................#',
    '#............................#',
    '#..........#........#........#',
    '#..........#........#........#',
    '#..........#........#........#',
    '#..........#........#........#',
    '#............................#',
    '#X...........................#',
    '##############################',
  ],
  props: [
    { id: 'tr-console', propId: 'terminal', x: 3, y: 1 },
    { id: 'tr-lantern-a', propId: 'lantern', x: 8, y: 1 },
    { id: 'tr-lantern-b', propId: 'lantern', x: 8, y: 14 },
    { id: 'tr-lantern-c', propId: 'lantern', x: 28, y: 1 },
    { id: 'tr-lantern-d', propId: 'lantern', x: 28, y: 14 },
    { id: 'tr-crate-a', propId: 'crate', x: 5, y: 12 },
    { id: 'tr-crate-b', propId: 'crate', x: 6, y: 12 },
  ],
  encounters: [
    { id: 'tr-husk', enemyId: 'husk', x: 15, y: 3, count: 1 },
    { id: 'tr-sentinel', enemyId: 'sentinel', x: 25, y: 3, count: 1 },
    { id: 'tr-lurker', enemyId: 'lurker', x: 15, y: 11, count: 1 },
    { id: 'tr-guardian', enemyId: 'guardian', x: 25, y: 11, count: 1 },
  ],
  exits: [{ x: 1, y: 14, toRoomIndex: 0, direction: 'west' }],
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
  sentinel: { attack: 'Long-range beam along its facing.', tip: 'Beams are blocked by Bulwark; sidestep the line.' },
  lurker: { attack: 'Charges straight at you.', tip: 'Wait for the windup, then dash sideways and punish.' },
  guardian: { attack: 'Alternates a 360° burst and a sweeping beam.', tip: 'Back off for the burst, sidestep the beam.' },
};
