/**
 * V2 — the reaction layer's maths, and the switch that turns it down.
 *
 * `src/client/render/feel.ts` is deliberately a leaf with no Phaser and no DOM, so the part of
 * game feel that has a right answer can be checked without a browser. Two things are pinned here:
 * the shapes (a flash that starts bright and ends at nothing, a flinch that returns to zero, an
 * impact that grows with the blow), and the accessibility contract — reduced motion must remove
 * camera motion and must NOT remove the things that carry information.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  contactShakeIntensity, damageShare, FEEL, flinchDistance, hitFlashAlpha, hitStopHold,
  impactStrength, initMotionPreference, isReducedMotion, motionScale, MOTION_STORAGE_KEY,
  onMotionPreferenceChange, resetMotionPreferenceForTest, resolveReducedMotion, setReducedMotion,
  systemPrefersReducedMotion, type MotionStorage,
} from '../../src/client/render/feel';

const storage = (initial: Record<string, string> = {}): MotionStorage & { map: Map<string, string> } => {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe('damageShare', () => {
  it('is the share of the target this blow took', () => {
    expect(damageShare(30, 120)).toBeCloseTo(0.25);
    expect(damageShare(1200, 1200)).toBe(1);
  });

  it('never divides by a missing or zero maxHp, and never goes past 1', () => {
    expect(damageShare(10, 0)).toBe(0);
    expect(damageShare(10, Number.NaN)).toBe(0);
    expect(damageShare(500, 100)).toBe(1);
    expect(damageShare(-5, 100)).toBe(0);
  });
});

describe('impactStrength', () => {
  it('grows with the blow, so a scratch and a quarter of a boss no longer draw the same burst', () => {
    const scratch = impactStrength(damageShare(2, 400));
    const heavy = impactStrength(damageShare(100, 400));
    expect(heavy).toBeGreaterThan(scratch * 1.8);
  });

  it('is bounded, so one huge hit cannot swallow the room', () => {
    expect(impactStrength(0)).toBeCloseTo(0.85);
    expect(impactStrength(1)).toBeCloseTo(1.9);
    expect(impactStrength(50)).toBeCloseTo(1.9);
  });
});

describe('hitFlashAlpha', () => {
  it('is brightest at once and is over by the end of its window', () => {
    expect(hitFlashAlpha(0)).toBeCloseTo(FEEL.hitFlashAlpha);
    expect(hitFlashAlpha(FEEL.hitFlashMs * 0.2)).toBeCloseTo(FEEL.hitFlashAlpha);
    expect(hitFlashAlpha(FEEL.hitFlashMs)).toBe(0);
    expect(hitFlashAlpha(9999)).toBe(0);
    expect(hitFlashAlpha(-1)).toBe(0);
  });

  it('decays once past the hold', () => {
    expect(hitFlashAlpha(FEEL.hitFlashMs * 0.5)).toBeLessThan(hitFlashAlpha(FEEL.hitFlashMs * 0.3));
  });

  it('SURVIVES reduced motion, quieter: it is how you know the blow connected, and it moves nothing', () => {
    const quiet = hitFlashAlpha(0, 0);
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(hitFlashAlpha(0, 1));
  });
});

describe('flinchDistance', () => {
  it('starts at nothing, peaks early and returns to exactly zero', () => {
    expect(flinchDistance(0, 0.25)).toBe(0);
    expect(flinchDistance(FEEL.flinchMs * 0.2, 0.25)).toBeGreaterThan(0);
    expect(flinchDistance(FEEL.flinchMs, 0.25)).toBe(0);
    expect(flinchDistance(FEEL.flinchMs + 1, 0.25)).toBe(0);
  });

  it('never exceeds the stated few pixels, however big the blow', () => {
    for (let ms = 0; ms <= FEEL.flinchMs; ms += 3) {
      expect(flinchDistance(ms, 10)).toBeLessThanOrEqual(FEEL.flinchPx);
    }
  });

  it('is bigger for a bigger blow', () => {
    const at = FEEL.flinchMs * 0.2;
    expect(flinchDistance(at, 0.25)).toBeGreaterThan(flinchDistance(at, 0.01));
  });

  it('is zero under reduced motion: it is movement, and it carries no information', () => {
    expect(flinchDistance(FEEL.flinchMs * 0.2, 0.25, 0)).toBe(0);
  });
});

describe('hitStopHold', () => {
  it('holds fully, then releases rather than teleporting', () => {
    expect(hitStopHold(0)).toBe(1);
    expect(hitStopHold(FEEL.hitStopMs * 0.5)).toBe(1);
    expect(hitStopHold(FEEL.hitStopMs * 0.85)).toBeGreaterThan(0);
    expect(hitStopHold(FEEL.hitStopMs * 0.85)).toBeLessThan(1);
    expect(hitStopHold(FEEL.hitStopMs)).toBe(0);
  });

  it('is short enough that it can never read as lag', () => {
    // Three frames at 60 Hz. Shipped hitlag caps sit at 20-30 frames; ours is render-only.
    expect(FEEL.hitStopMs).toBeLessThanOrEqual(1000 / 60 * 4);
  });
});

describe('contactShakeIntensity', () => {
  it('is zero under reduced motion, at any size of blow', () => {
    expect(contactShakeIntensity(1, 0)).toBe(0);
    expect(contactShakeIntensity(0.01, 0)).toBe(0);
  });

  it('grows with the blow and stays inside its stated band', () => {
    expect(contactShakeIntensity(0)).toBeCloseTo(FEEL.contactShakeMinIntensity);
    expect(contactShakeIntensity(1)).toBeCloseTo(FEEL.contactShakeMaxIntensity);
    expect(contactShakeIntensity(0.5)).toBeGreaterThan(contactShakeIntensity(0.1));
  });

  it('never shakes harder than the camera already did for taking a hit', () => {
    // The existing player_damaged shake is 0.004; landing a hit must not out-shout being hit.
    expect(contactShakeIntensity(1)).toBeLessThanOrEqual(0.006);
  });
});

describe('the motion preference', () => {
  beforeEach(() => resetMotionPreferenceForTest());

  it('takes the browser preference when the player has not answered', () => {
    expect(resolveReducedMotion(storage(), true)).toBe(true);
    expect(resolveReducedMotion(storage(), false)).toBe(false);
    expect(resolveReducedMotion(null, true)).toBe(true);
  });

  it('lets a stored answer override the browser, in both directions', () => {
    expect(resolveReducedMotion(storage({ [MOTION_STORAGE_KEY]: 'false' }), true)).toBe(false);
    expect(resolveReducedMotion(storage({ [MOTION_STORAGE_KEY]: 'true' }), false)).toBe(true);
  });

  it('ignores a stored value that is not an answer', () => {
    expect(resolveReducedMotion(storage({ [MOTION_STORAGE_KEY]: 'sometimes' }), true)).toBe(true);
  });

  it('survives storage that throws, which is what private mode does', () => {
    const hostile: MotionStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(() => resolveReducedMotion(hostile, true)).not.toThrow();
    expect(resolveReducedMotion(hostile, true)).toBe(true);
  });

  it('reads matchMedia safely, including when there is no window at all', () => {
    expect(systemPrefersReducedMotion(undefined)).toBe(false);
    expect(systemPrefersReducedMotion({})).toBe(false);
    expect(systemPrefersReducedMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(systemPrefersReducedMotion({ matchMedia: () => { throw new Error('old browser'); } })).toBe(false);
  });

  it('boots from the browser preference and hands the renderer one multiplier', () => {
    const store = storage();
    initMotionPreference({ localStorage: store, matchMedia: () => ({ matches: true }) } as never);
    expect(isReducedMotion()).toBe(true);
    expect(motionScale()).toBe(0);
    setReducedMotion(false);
    expect(motionScale()).toBe(1);
    expect(store.map.get(MOTION_STORAGE_KEY)).toBe('false');
  });

  it('tells the UI when it changes, so the menu and the canvas cannot disagree', () => {
    initMotionPreference({ localStorage: storage(), matchMedia: () => ({ matches: false }) } as never);
    const seen: boolean[] = [];
    const off = onMotionPreferenceChange((v) => seen.push(v));
    setReducedMotion(true);
    setReducedMotion(false);
    off();
    setReducedMotion(true);
    expect(seen).toEqual([true, false]);
  });
});
