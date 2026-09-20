/**
 * V2 — pitch scatter on the cues that repeat.
 *
 * Every cue used to sound byte-identical every time, so a burst of hits machine-gunned. Nijman's
 * "The Art of Screenshake" lists randomised pitch as one of the cheapest fixes, and a synth gets
 * it for nothing because every oscillator already takes a detune. The rule being pinned here is
 * which cues get it (the fast, repeated ones) and how far it may go (under half a semitone), so
 * a later edit cannot quietly detune a bell.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_CUE_IDS, cueDetuneCents, PITCH_SCATTER_CENTS, SCATTERED_CUES, type AudioCueId,
} from '../../src/client/audio/index';

describe('cueDetuneCents', () => {
  it('leaves every cue that rings out exactly in tune', () => {
    const ringing = AUDIO_CUE_IDS.filter((cue) => !SCATTERED_CUES.has(cue));
    for (const cue of ringing) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) expect(cueDetuneCents(cue, roll)).toBe(0);
    }
    // The ones a player hears ring: the anchor, the portal, a memory saved, a world's bells.
    expect(ringing).toContain('anchor');
    expect(ringing).toContain('portal_open');
    expect(ringing).toContain('memory_saved');
  });

  it('scatters the cues that fire many times a second', () => {
    for (const cue of ['attack', 'hit', 'enemy_shot'] as AudioCueId[]) {
      expect(cueDetuneCents(cue, 0)).toBe(-PITCH_SCATTER_CENTS);
      expect(cueDetuneCents(cue, 0.999999)).toBe(PITCH_SCATTER_CENTS);
      expect(cueDetuneCents(cue, 0.5)).toBe(0);
    }
  });

  it('never moves a sound as far as half a semitone, so it reads as life and not as a wrong note', () => {
    for (const cue of AUDIO_CUE_IDS) {
      for (let i = 0; i <= 100; i++) {
        expect(Math.abs(cueDetuneCents(cue, i / 100))).toBeLessThan(50);
      }
    }
  });

  it('is centred, so a long fight does not drift sharp or flat', () => {
    let total = 0;
    const n = 1001;
    for (let i = 0; i < n; i++) total += cueDetuneCents('hit', i / n);
    expect(Math.abs(total / n)).toBeLessThan(1);
  });

  it('survives a roll outside [0, 1) rather than producing a silent or absurd pitch', () => {
    expect(cueDetuneCents('hit', -1)).toBe(-PITCH_SCATTER_CENTS);
    expect(cueDetuneCents('hit', 2)).toBe(PITCH_SCATTER_CENTS);
    expect(Number.isFinite(cueDetuneCents('hit', Number.NaN))).toBe(true);
  });
});
