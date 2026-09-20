/**
 * Game feel: the reaction layer, and the one switch that turns it down.
 *
 * `fx.ts` draws what the *attacker* does. This module holds what the *target* and the *camera*
 * do about it: the white flash on a struck hostile, the flinch it takes, how big the impact
 * burst should be for the size of the blow, and how hard the camera nods when you connect.
 * Vlambeer's "The Art of Screenshake" (INDIGO 2013) spends most of its runtime on exactly this
 * half of a hit, and it was the half this game did not have.
 *
 * Two rules hold everything here together.
 *
 * 1. **Nothing in this file is simulation.** Every value is a render offset or an alpha. Two
 *    clients watching the same snapshot may disagree about every number here and still agree
 *    perfectly about the world, which is why the whole reaction layer is safe in co-op.
 * 2. **Reduced motion is honoured on the canvas, not only in CSS.** The stylesheets already
 *    respect `prefers-reduced-motion`; the canvas shook regardless. When motion is reduced,
 *    shake and camera flash go to zero and the flinch stops, but *nothing informational is
 *    removed* — damage numbers, telegraphs, health bars and the impact burst all stay. Shake
 *    carries no information; those do.
 *
 * The pure functions are exported so they can be tested without a browser or a Phaser scene.
 */

/** Where the player's override lives, next to `relay.audio.muted`. */
export const MOTION_STORAGE_KEY = 'relay.motion.reduced';

/** The reaction layer's timings and sizes, in one place. */
export const FEEL = {
  /**
   * Hit-stop: how long a struck hostile is drawn at the spot it was struck while the simulation
   * carries on without it. Shipped fighting games scale hitlag with damage and cap it (Smash
   * Ultimate: `floor(damage * 0.65 + 6)` frames, capped at 30); action games sit at 2-5 frames
   * for a light hit. 45 ms is three frames at 60 Hz, which is the low end of that band, chosen
   * because ours is render-only and must never look like lag.
   */
  hitStopMs: 45,
  /** A struck hostile flashes white for this long. Nijman's flash is 1-3 frames; 70 ms reads at any frame rate. */
  hitFlashMs: 70,
  /** Peak alpha of that flash at full motion. */
  hitFlashAlpha: 0.85,
  /** How far a hostile is shoved along the blow, before easing back. Nijman: "a few pixels". */
  flinchPx: 7,
  /** How long the flinch takes to settle, hit-stop included. Short enough that it never fights the snapshot. */
  flinchMs: 150,
  /** Camera nod when YOU land a hit: a scratch. */
  contactShakeMinIntensity: 0.0015,
  /** Camera nod when you land a blow worth a quarter of the target. */
  contactShakeMaxIntensity: 0.006,
  /** Duration of that nod. */
  contactShakeMs: 70,
  /** A blow worth this share of the target's health is "as big as it gets" for feel purposes. */
  bigHitShare: 0.25,
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Pure feel maths
// ---------------------------------------------------------------------------

/** The share of the target's maximum health a blow took, in [0, 1]. Guards a zero or absent maxHp. */
export function damageShare(amount: number, maxHp: number): number {
  if (!(maxHp > 0) || !(amount > 0)) return 0;
  return clamp01(amount / maxHp);
}

/**
 * Multiplier for `fx.drawImpact`'s `strength`. Every hit used to draw at exactly 1, so a scratch
 * and a quarter of a boss looked identical. Scales 0.85 -> 1.9 and never further, so a huge blow
 * cannot swallow the room.
 */
export function impactStrength(share: number): number {
  return 0.85 + 1.05 * clamp01(share / FEEL.bigHitShare);
}

/**
 * Alpha of the white flash on a struck hostile, `elapsedMs` after the hit. Front-loaded: full for
 * the first third, then out. Returns 0 once the flash is over, so the caller can skip the draw.
 */
export function hitFlashAlpha(elapsedMs: number, motion: number = 1): number {
  if (elapsedMs < 0 || elapsedMs >= FEEL.hitFlashMs) return 0;
  const t = elapsedMs / FEEL.hitFlashMs;
  const shape = t < 0.34 ? 1 : 1 - (t - 0.34) / 0.66;
  // Reduced motion keeps a quieter flash rather than none: it is the clearest "that connected"
  // signal in the game and it does not move the screen.
  const peak = FEEL.hitFlashAlpha * (0.35 + 0.65 * clamp01(motion));
  return peak * clamp01(shape);
}

/**
 * How far along the blow a struck hostile is displaced, `elapsedMs` after the hit. Out fast,
 * back with an ease so it settles rather than snapping. Never applied to the simulation.
 */
export function flinchDistance(elapsedMs: number, share: number, motion: number = 1): number {
  if (elapsedMs < 0 || elapsedMs >= FEEL.flinchMs) return 0;
  const t = elapsedMs / FEEL.flinchMs;
  // Rise over the first fifth, ease back over the rest.
  const shape = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
  const size = FEEL.flinchPx * (0.55 + 0.45 * clamp01(share / FEEL.bigHitShare));
  return size * shape * shape * clamp01(motion);
}

/**
 * Camera intensity for a hit the local operative dealt. 0 when motion is reduced.
 *
 * Squared rather than linear, after Squirrel Eiserloh's trauma model (GDC 2016, "Juicing Your
 * Cameras With Math"): shake driven by `trauma^2` decays the way an impact reads, where a linear
 * ramp feels like a rumble that will not stop.
 */
export function contactShakeIntensity(share: number, motion: number = 1): number {
  const m = clamp01(motion);
  if (m <= 0) return 0;
  const trauma = clamp01(share / FEEL.bigHitShare);
  const lerp = trauma * trauma;
  return (FEEL.contactShakeMinIntensity + (FEEL.contactShakeMaxIntensity - FEEL.contactShakeMinIntensity) * lerp) * m;
}

/**
 * How much of the hit-stop freeze is still in force, 1 -> 0. While this is above 0 the struck
 * hostile is drawn where it was struck rather than where the snapshot says it is: the frames the
 * eye reads as impact. It is capped at `FEEL.hitStopMs`, it is render-only, and the simulation is
 * never told, so two clients may be mid-freeze at different moments and still agree about the
 * world. Reduced motion keeps hit-stop: it does not move the camera and it is how a player knows
 * the blow connected.
 */
export function hitStopHold(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= FEEL.hitStopMs) return 0;
  const t = elapsedMs / FEEL.hitStopMs;
  // Full hold for two thirds, then release so the hostile slides back rather than teleporting.
  return t < 0.66 ? 1 : 1 - (t - 0.66) / 0.34;
}

// ---------------------------------------------------------------------------
// The motion preference
// ---------------------------------------------------------------------------

export interface MotionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Resolve the starting preference: a stored answer wins, because the player gave it deliberately;
 * otherwise the browser's `prefers-reduced-motion`. Both are optional and either may throw
 * (private mode, old browsers), so both are guarded.
 */
export function resolveReducedMotion(storage: MotionStorage | null, systemPrefersReduced: boolean): boolean {
  try {
    const stored = storage?.getItem(MOTION_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    /* Storage is optional. */
  }
  return systemPrefersReduced;
}

/** True when the browser says the player asked the OS for less motion. Safe on any window. */
export function systemPrefersReducedMotion(win: { matchMedia?: (q: string) => { matches: boolean } } | undefined): boolean {
  try {
    return win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

let reduced = false;
let storageRef: MotionStorage | null = null;
const listeners = new Set<(value: boolean) => void>();

/** Called once at boot, from `main.tsx`. Idempotent. */
export function initMotionPreference(win: (Window & typeof globalThis) | undefined): void {
  let storage: MotionStorage | null = null;
  try {
    storage = win?.localStorage ?? null;
  } catch {
    storage = null;
  }
  storageRef = storage;
  reduced = resolveReducedMotion(storage, systemPrefersReducedMotion(win));
}

export function isReducedMotion(): boolean {
  return reduced;
}

/**
 * The single number every shake, flash and flinch is multiplied by: 1 normally, 0 when the player
 * asked for less motion. One multiplier rather than a branch per call site means a new effect
 * cannot forget the setting by being written in the wrong style.
 */
export function motionScale(): number {
  return reduced ? 0 : 1;
}

export function setReducedMotion(value: boolean): void {
  reduced = value;
  try {
    storageRef?.setItem(MOTION_STORAGE_KEY, String(value));
  } catch {
    /* Storage is optional. */
  }
  for (const listener of listeners) listener(value);
}

/** Subscribe to the setting so UI reflecting it stays in step. Returns an unsubscribe. */
export function onMotionPreferenceChange(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the module's state between cases. */
export function resetMotionPreferenceForTest(): void {
  reduced = false;
  storageRef = null;
  listeners.clear();
}
