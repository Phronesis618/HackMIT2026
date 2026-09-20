/**
 * SAMPLE / TEST DATA — clearly labelled, never shown to players as real history.
 *
 * Use these to develop the renderer, HUD, memory wall and Chronicle reducer without
 * waiting for live generation or finished combat. Every id carries a `sample-` or
 * `test-` prefix so accidental leakage into a real memory wall is obvious.
 *
 * Owner: Agent A. Agents B/C may add more samples in their own test folders.
 */
import type { Contribution, GameEvent, GameSnapshot, PlayerIdentity } from './contracts';
import { tileToWorld } from './conventions';

export const SAMPLE_WORLD_ID = 'sample-world-vantage-spire';
export const SAMPLE_WORLD_TITLE = 'Vantage Spire (sample)';

export const samplePlayers: PlayerIdentity[] = [
  { id: 'sample-player-local', displayName: 'Test Operative', classId: 'bastion' },
  { id: 'sample-player-remote', displayName: 'Test Ally', classId: 'shade' },
];

export const sampleContributions: Contribution[] = [
  {
    id: 'sample-contrib-1',
    playerId: 'sample-player-local',
    playerName: 'Test Operative',
    text: 'a transit station frozen mid-evacuation, luggage still on the platforms',
    submittedAt: 1_758_300_000_000,
  },
  {
    id: 'sample-contrib-2',
    playerId: 'sample-player-remote',
    playerName: 'Test Ally',
    text: 'cables hanging like vines, humming with leftover charge',
    submittedAt: 1_758_300_005_000,
  },
];

/** One frame of expedition state in room 0 of the fixture world (see fixtures/worlds). */
export const sampleSnapshot: GameSnapshot = {
  tick: 600,
  timeMs: 10_000,
  phase: 'expedition',
  worldId: SAMPLE_WORLD_ID,
  roomIndex: 0,
  roomId: 'vantage-spire-room-0',
  players: [
    {
      id: 'sample-player-local',
      displayName: 'Test Operative',
      classId: 'bastion',
      skills: [],
      ...tileToWorld(4, 6),
      vx: 120,
      vy: 0,
      facing: 0,
      hp: 82,
      maxHp: 100,
      state: 'moving',
      dashCooldownMs: 0,
      attackCooldownMs: 0,
      invulnerableMs: 0,
    },
    {
      id: 'sample-player-remote',
      displayName: 'Test Ally',
      classId: 'shade',
      skills: [],
      ...tileToWorld(6, 8),
      vx: 0,
      vy: 0,
      facing: Math.PI / 2,
      hp: 100,
      maxHp: 100,
      state: 'idle',
      dashCooldownMs: 420,
      attackCooldownMs: 0,
      invulnerableMs: 0,
    },
  ],
  enemies: [
    { id: 'sample-enemy-1', enemyId: 'husk', ...tileToWorld(15, 4), facing: Math.PI, hp: 30, maxHp: 30, state: 'idle' },
    { id: 'sample-enemy-2', enemyId: 'husk', ...tileToWorld(17, 9), facing: Math.PI, hp: 12, maxHp: 30, state: 'hit' },
  ],
  anchor: null,
};

/** Ordered, id-unique test events covering the Chronicle's inputs. */
export const sampleEvents: GameEvent[] = [
  {
    id: 'meta:1',
    type: 'contribution_submitted',
    tick: 0,
    timeMs: 0,
    contributionId: 'sample-contrib-1',
    playerId: 'sample-player-local',
  },
  {
    id: 'meta:2',
    type: 'world_prepared',
    tick: 0,
    timeMs: 0,
    worldId: SAMPLE_WORLD_ID,
    worldTitle: SAMPLE_WORLD_TITLE,
    source: 'fixture',
    playerIds: ['sample-player-local', 'sample-player-remote'],
  },
  {
    id: '1:0',
    type: 'room_entered',
    tick: 1,
    timeMs: 16.67,
    worldId: SAMPLE_WORLD_ID,
    roomIndex: 0,
    roomId: 'vantage-spire-room-0',
    roomName: 'Threshold Concourse',
    playerIds: ['sample-player-local', 'sample-player-remote'],
  },
  { id: '120:0', type: 'player_dashed', tick: 120, timeMs: 2000, playerId: 'sample-player-local', ...tileToWorld(3, 6), facing: 0 },
  {
    id: '240:0',
    type: 'player_attacked',
    tick: 240,
    timeMs: 4000,
    playerId: 'sample-player-local',
    ...tileToWorld(14, 4),
    facing: 0,
    hitEnemyIds: ['sample-enemy-1'],
  },
  { id: '240:1', type: 'enemy_damaged', tick: 240, timeMs: 4000, enemyId: 'sample-enemy-1', byPlayerId: 'sample-player-local', amount: 18, remainingHp: 12 },
  { id: '300:0', type: 'player_damaged', tick: 300, timeMs: 5000, playerId: 'sample-player-local', amount: 18, remainingHp: 82, sourceEnemyId: 'sample-enemy-1' },
  { id: '420:0', type: 'enemy_defeated', tick: 420, timeMs: 7000, enemyId: 'sample-enemy-1', byPlayerId: 'sample-player-local' },
];
