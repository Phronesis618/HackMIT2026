/**
 * Audio port — Agent C. The controller maps GameEvents to cue ids and calls `play`.
 * Original procedural cues are defined in design/audio/cues.json.
 */
import type { GameEvent } from '../../shared/contracts';
import cues from '../../../design/audio/cues.json';

export const AUDIO_CUE_IDS = ['ui_confirm', 'portal_open', 'room_enter', 'dash', 'attack', 'hit', 'enemy_down', 'memory_saved'] as const;
export type AudioCueId = (typeof AUDIO_CUE_IDS)[number];

export interface AudioPort {
  play(cue: AudioCueId): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  dispose?(): void;
}

export function createBrowserAudio(): AudioPort {
  if (typeof AudioContext === 'undefined') return createSilentAudio();
  let context: AudioContext | null = null;
  let muted = false;
  let disposed = false;
  let voices = 0;
  const lastPlayed = new Map<AudioCueId, number>();
  try {
    muted = localStorage.getItem('relay.audio.muted') === 'true';
  } catch {
    /* Storage is optional. */
  }
  const unlock = (): void => {
    if (disposed) return;
    context ??= new AudioContext();
    void context.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  return {
    play(cue) {
      if (disposed || muted || !context || context.state !== 'running' || voices >= 12) return;
      const now = context.currentTime;
      if (now - (lastPlayed.get(cue) ?? -1) < 0.07) return;
      lastPlayed.set(cue, now);
      const profile = cues[cue];
      const duration = profile.durationMs / 1000;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      profile.frequencies.forEach((frequency, index) => {
        oscillator.frequency.exponentialRampToValueAtTime(frequency, now + duration * index / profile.frequencies.length);
      });
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.055, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      voices++;
      oscillator.onended = () => {
        voices--;
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + duration);
    },
    setMuted(value) {
      muted = value;
      try {
        localStorage.setItem('relay.audio.muted', String(value));
      } catch {
        /* Storage is optional. */
      }
    },
    isMuted: () => muted,
    dispose() {
      disposed = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void context?.close().catch(() => {});
    },
  };
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
    case 'ability_used':
      return 'attack';
    case 'ability_unlocked':
    case 'player_revived':
    case 'room_cleared':
      return 'ui_confirm';
    case 'enemy_damaged':
    case 'player_damaged':
      return 'hit';
    case 'enemy_defeated':
      return 'enemy_down';
    default:
      return null;
  }
}
