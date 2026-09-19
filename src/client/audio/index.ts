/**
 * Audio port — Agent C. The controller maps GameEvents to cue ids and calls `play`.
 * Foundation ships a silent implementation so nothing depends on audio assets.
 * Use original or properly licensed sounds only; keep files in design/audio/.
 */
import type { GameEvent } from '../../shared/contracts';

export const AUDIO_CUE_IDS = ['ui_confirm', 'portal_open', 'room_enter', 'dash', 'attack', 'hit', 'enemy_down', 'memory_saved'] as const;
export type AudioCueId = (typeof AUDIO_CUE_IDS)[number];

export interface AudioPort {
  play(cue: AudioCueId): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

export function createSilentAudio(): AudioPort {
  let muted = false;
  return {
    play: () => {},
    setMuted: (m) => {
      muted = m;
    },
    isMuted: () => muted,
  };
}

/** Event -> cue mapping. Returns null for events with no sound. */
export function cueForEvent(event: GameEvent): AudioCueId | null {
  switch (event.type) {
    case 'world_prepared':
      return 'portal_open';
    case 'room_entered':
      return 'room_enter';
    case 'player_dashed':
      return 'dash';
    case 'player_attacked':
      return 'attack';
    case 'enemy_damaged':
    case 'player_damaged':
      return 'hit';
    case 'enemy_defeated':
      return 'enemy_down';
    default:
      return null;
  }
}
